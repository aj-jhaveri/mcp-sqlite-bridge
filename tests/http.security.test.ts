import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
    corsMiddleware,
    createGlobalLimiter,
    createPerIpLimiter,
    parseAllowedOrigins,
    GLOBAL_LIMIT,
    GLOBAL_MESSAGE,
    PER_IP_LIMIT,
    PER_IP_MESSAGE,
} from "../src/middleware/http.security.js";

/**
 * HTTP-layer protections for the public MCP endpoint.
 *
 * This module had zero test coverage: it was imported by exactly one file and
 * asserted on by none, on a repo whose stated premise is that its guardrails
 * are real. CORS and rate limiting are the only things standing between an
 * unauthenticated endpoint and unbounded cost, so they are exactly the code
 * that should not be taken on trust.
 *
 * These mount the middleware on a bare Express app - no MCP server, no SQLite -
 * so they test the middleware rather than the system around it.
 */

const ALLOWED = ["https://slakedesign.com", "https://www.slakedesign.com"];

function appWithLimiter(limiter: express.RequestHandler) {
    const app = express();
    app.use(limiter);
    app.get("/probe", (_req, res) => { res.json({ ok: true }); });
    return app;
}

function appWithCors() {
    const app = express();
    app.use(corsMiddleware(ALLOWED));
    app.get("/probe", (_req, res) => { res.json({ ok: true }); });
    app.post("/probe", (_req, res) => { res.json({ ok: true }); });
    return app;
}

describe("parseAllowedOrigins", () => {
    it("defaults to the production origins when unset", () => {
        expect(parseAllowedOrigins(undefined)).toEqual(ALLOWED);
    });

    it("splits, trims, and strips trailing slashes", () => {
        expect(parseAllowedOrigins(" https://a.com/ , https://b.com ")).toEqual([
            "https://a.com",
            "https://b.com",
        ]);
    });

    it("drops a wildcard rather than honouring it", () => {
        // A wildcard would defeat the allowlist entirely. It must not be
        // possible to disable CORS by setting CORS_ALLOWED_ORIGINS=*.
        expect(parseAllowedOrigins("*")).toEqual([]);
        expect(parseAllowedOrigins("https://a.com,*")).toEqual(["https://a.com"]);
    });

    it("drops empty entries from a trailing comma", () => {
        expect(parseAllowedOrigins("https://a.com,,")).toEqual(["https://a.com"]);
    });
});

describe("corsMiddleware", () => {
    it("echoes an allowed origin", async () => {
        const res = await request(appWithCors()).get("/probe").set("Origin", ALLOWED[0]);
        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED[0]);
    });

    it("accepts an allowed origin with a trailing slash", async () => {
        const res = await request(appWithCors()).get("/probe").set("Origin", ALLOWED[0] + "/");
        expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED[0]);
    });

    it("omits the header for a disallowed origin but still serves the request", async () => {
        // Deliberate: the browser blocks the read, and a non-browser caller was
        // never subject to CORS in the first place. Rejecting server-side would
        // break every non-browser MCP client for no security gain.
        const res = await request(appWithCors()).get("/probe").set("Origin", "https://evil.example");
        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("does not treat a lookalike origin as allowed", async () => {
        for (const origin of [
            "https://slakedesign.com.evil.example",
            "http://slakedesign.com",
            "https://evilslakedesign.com",
        ]) {
            const res = await request(appWithCors()).get("/probe").set("Origin", origin);
            expect(res.headers["access-control-allow-origin"]).toBeUndefined();
        }
    });

    it("rejects a preflight from a disallowed origin with 403", async () => {
        const res = await request(appWithCors()).options("/probe").set("Origin", "https://evil.example");
        expect(res.status).toBe(403);
    });

    it("answers a preflight from an allowed origin with 204 and the method/header allowlist", async () => {
        const res = await request(appWithCors()).options("/probe").set("Origin", ALLOWED[1]);
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-methods"]).toContain("POST");
        expect(res.headers["access-control-allow-headers"]).toContain("Mcp-Session-Id");
    });

    it("passes a request with no Origin header untouched", async () => {
        // curl, uptime monitors, and every non-browser MCP client.
        const res = await request(appWithCors()).post("/probe");
        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("always sets Vary: Origin so caches cannot serve a cross-origin response", async () => {
        const res = await request(appWithCors()).get("/probe").set("Origin", ALLOWED[0]);
        expect(res.headers["vary"]).toContain("Origin");
    });
});

describe("perIpLimiter", () => {
    it("allows traffic up to the limit and returns the documented body once exceeded", async () => {
        // A fresh limiter per test. The exported singleton the server mounts keeps its
        // counter for the life of the process, so exhausting that one here would leave
        // every later request in this file rate limited.
        const app = appWithLimiter(createPerIpLimiter());

        let served = 0;
        for (let i = 0; i < PER_IP_LIMIT; i++) {
            const res = await request(app).get("/probe");
            if (res.status === 200) served += 1;
        }
        expect(served).toBe(PER_IP_LIMIT);

        const limited = await request(app).get("/probe");
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual(PER_IP_MESSAGE);
    }, 30000);

    it("advertises draft-7 standard rate limit headers on a served request", async () => {
        const app = appWithLimiter(createPerIpLimiter());

        const res = await request(app).get("/probe");
        // Asserted on a 200: these headers are present on a 429 too, so sharing an
        // exhausted limiter would have made this pass without observing the case
        // that matters.
        expect(res.status).toBe(200);
        expect(res.headers["ratelimit"] ?? res.headers["ratelimit-limit"]).toBeDefined();
        expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    });
});

describe("globalLimiter", () => {
    it("bounds total traffic and returns the documented body at capacity", async () => {
        // Every request shares one bucket by construction: the key generator is a
        // constant, so this ceiling applies across all callers rather than per address.
        const app = appWithLimiter(createGlobalLimiter());

        let served = 0;
        for (let i = 0; i < GLOBAL_LIMIT; i++) {
            const res = await request(app).get("/probe");
            if (res.status === 200) served += 1;
        }
        expect(served).toBe(GLOBAL_LIMIT);

        const limited = await request(app).get("/probe");
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual(GLOBAL_MESSAGE);
    }, 60000);

    it("sits above the per-IP ceiling, so the per-IP limit stays reachable", () => {
        // If these ever cross, one caller could never reach its own documented limit.
        expect(GLOBAL_LIMIT).toBeGreaterThan(PER_IP_LIMIT);
    });
});
