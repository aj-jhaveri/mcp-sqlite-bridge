import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

/**
 * HTTP-layer protections for the public MCP endpoint.
 *
 * The read-only default means a caller cannot change anything here. It does not mean
 * a caller cannot cost anything: every tools/call reaches SQLite, and the endpoint is
 * unauthenticated by design so that any MCP client can connect. Cost, not mutation, is
 * what these bound.
 */

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version";

/** Origins permitted to drive this server from a browser. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
    return (raw ?? "https://slakedesign.com,https://www.slakedesign.com")
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter((o) => o.length > 0 && o !== "*");
}

/**
 * Explicit-allowlist CORS.
 *
 * Requests with no Origin header — curl, uptime monitors, and every non-browser MCP
 * client — pass through untouched. CORS is enforced by browsers and is not a
 * substitute for authentication; restricting it only stops an arbitrary web page from
 * driving this server using a visitor's browser.
 */
export function corsMiddleware(allowedOrigins: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const origin = req.headers.origin;
        res.setHeader("Vary", "Origin");

        if (!origin) {
            if (req.method === "OPTIONS") {
                res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
                res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
                res.status(204).end();
                return;
            }
            next();
            return;
        }

        const normalized = origin.replace(/\/$/, "");
        if (!allowedOrigins.includes(normalized)) {
            if (req.method === "OPTIONS") {
                res.status(403).json({ error: "Origin not allowed." });
                return;
            }
            // Omit the header rather than rejecting: the browser blocks the read,
            // and a non-browser caller was never subject to this in the first place.
            next();
            return;
        }

        res.setHeader("Access-Control-Allow-Origin", normalized);
        res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
        res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);

        if (req.method === "OPTIONS") {
            res.status(204).end();
            return;
        }
        next();
    };
}

/**
 * Per-IP ceiling. A protocol session is initialize + call, so a single legitimate
 * client interaction costs two requests; 60/minute leaves room for an agent working
 * through several tools while bounding a caller looping the endpoint.
 */
export const perIpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
});

/**
 * Global ceiling across all callers.
 *
 * Per-IP limits answer one flooder; they do nothing about many addresses each staying
 * politely under the individual cap. This is the bound on total cost regardless of
 * source. Single fixed bucket, so the key generator is deliberately constant.
 */
export const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: () => "global",
    validate: false,
    message: { error: "Server is at capacity. Please retry shortly." },
});
