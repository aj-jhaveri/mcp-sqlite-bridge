import pino from "pino";
import { getCorrelationId } from "./context.js";

/**
 * Strips credentials out of anything resembling a connection URL, plus bare
 * `password=`/`token=`/`apikey=` parameters. A last line of defence before an
 * arbitrary error message reaches the log pipeline.
 */
export function redactSecrets(input: string): string {
    return input
        .replace(/(rediss?|https?|postgres(?:ql)?):\/\/[^:/@\s]*:[^@\s]*@/gi, "$1://[REDACTED]@")
        .replace(/\b(password|token|apikey|api_key|secret)=([^&\s]+)/gi, "$1=[REDACTED]");
}

/**
 * Structured logger, pinned to STDERR.
 *
 * This is not a style preference, it is a correctness requirement. Under the
 * stdio transport an MCP client owns this process's STDOUT: it is the JSON-RPC
 * message channel. Anything written there that is not a protocol message
 * corrupts the stream, and the client reports only "Connection closed" - the
 * same message it gives for every other startup failure, which makes the real
 * cause invisible.
 *
 * The console.error calls this replaces were accidentally correct for that
 * reason. pino.destination(2) makes it deliberate, so a future logger.info()
 * cannot quietly break the stdio transport.
 */
export const logger = pino(
    {
        level: process.env.LOG_LEVEL ?? "info",
        base: { service: "mcp-sqlite-bridge" },
        // Tags every line with the active correlation ID without any call site
        // passing it. Under the HTTP transport this ties a tool call back to
        // the request that made it.
        mixin() {
            const correlationId = getCorrelationId();
            return correlationId ? { correlationId } : {};
        },
        redact: {
            paths: [
                "DB_PATH",
                "*.DB_PATH",
                "password",
                "*.password",
                "apiKey",
                "*.apiKey",
                "authorization",
                "*.authorization",
                "req.headers.authorization",
                "req.headers.cookie",
            ],
            censor: "[REDACTED]",
        },
        formatters: {
            log(object) {
                for (const key of ["errMessage", "msg", "reason"] as const) {
                    const value = (object as Record<string, unknown>)[key];
                    if (typeof value === "string") {
                        (object as Record<string, unknown>)[key] = redactSecrets(value);
                    }
                }
                return object;
            },
        },
    },
    pino.destination(2)
);
