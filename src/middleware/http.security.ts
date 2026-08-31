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
 * Rate limit ceilings.
 *
 * Exported as named constants because these numbers are stated in three places -
 * this middleware, the tests that assert them, and the Security Model section of
 * the README. Three literals drift independently; one constant does not.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const PER_IP_LIMIT = 60;
export const GLOBAL_LIMIT = 300;

export const PER_IP_MESSAGE = { error: "Too many requests. Please slow down." };
export const GLOBAL_MESSAGE = { error: "Server is at capacity. Please retry shortly." };

/**
 * Per-IP ceiling. A protocol session is initialize + call, so a single legitimate
 * client interaction costs two requests; 60/minute leaves room for an agent working
 * through several tools while bounding a caller looping the endpoint.
 *
 * Built by a factory so a test can take a fresh bucket. The exported singleton below
 * is what the server mounts, and its counter is process-wide: a test that exhausts it
 * to prove the ceiling would leave every later request in the same process rate
 * limited, which surfaces later as an order-dependent failure somewhere unrelated.
 */
export function createPerIpLimiter() {
    return rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: PER_IP_LIMIT,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: PER_IP_MESSAGE,
    });
}

/**
 * Global ceiling across all callers.
 *
 * Per-IP limits answer one flooder; they do nothing about many addresses each staying
 * politely under the individual cap. This is the bound on total cost regardless of
 * source. Single fixed bucket, so the key generator is deliberately constant.
 */
export function createGlobalLimiter() {
    return rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: GLOBAL_LIMIT,
        standardHeaders: false,
        legacyHeaders: false,
        keyGenerator: () => "global",
        validate: false,
        message: GLOBAL_MESSAGE,
    });
}

export const perIpLimiter = createPerIpLimiter();
export const globalLimiter = createGlobalLimiter();
