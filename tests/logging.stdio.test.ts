import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    normaliseCorrelationId,
    runWithCorrelationId,
    getCorrelationId,
} from "../src/logging/context.js";
import { redactSecrets } from "../src/logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, "..", "dist", "server.js");

/**
 * STDOUT PURITY UNDER THE STDIO TRANSPORT.
 *
 * This is the invariant that makes structured logging safe here. An MCP client
 * launching this process owns its stdout: that stream IS the JSON-RPC message
 * channel. A single stray log line corrupts it, and the client reports only
 * "Connection closed" - identical to every other startup failure, which makes
 * the real cause invisible.
 *
 * The logger is pinned to pino.destination(2). This test is what stops a future
 * logger.info() default, or a stray console.log, from silently breaking every
 * stdio client.
 */
describe("stdio transport: stdout carries only protocol messages", () => {
    it("emits no non-JSON-RPC bytes on stdout during a full handshake", async () => {
        const child = spawn(process.execPath, [SERVER_JS], {
            env: { ...process.env, STDIO: "true", DB_PATH: ":memory:", LOG_LEVEL: "debug" },
            stdio: "pipe",
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
        child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });

        // A real initialize, followed by a tool call, so seeding and query
        // logging both have a chance to contaminate the stream.
        const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
        send({
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "stdout-purity-test", version: "1.0.0" },
            },
        });
        await new Promise((r) => setTimeout(r, 1200));
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        await new Promise((r) => setTimeout(r, 1200));

        child.kill();

        const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        expect(lines.length).toBeGreaterThan(0);

        for (const line of lines) {
            const parsed = JSON.parse(line);
            expect(parsed.jsonrpc).toBe("2.0");
        }

        // The logs did happen - they went to the right stream.
        expect(stderr).toContain("Seeding SQLite database");
        expect(stdout).not.toContain("Seeding SQLite database");
    }, 20000);
});

describe("redactSecrets", () => {
    it("strips credentials from connection URLs", () => {
        expect(redactSecrets("failed: postgres://user:hunter2@db:5432/x"))
            .toBe("failed: postgres://[REDACTED]@db:5432/x");
        expect(redactSecrets("redis://admin:s3cret@cache:6379"))
            .toBe("redis://[REDACTED]@cache:6379");
    });

    it("strips bare secret parameters", () => {
        expect(redactSecrets("GET /x?apikey=abc123&z=1")).toContain("apikey=[REDACTED]");
        expect(redactSecrets("token=deadbeef")).toBe("token=[REDACTED]");
    });

    it("leaves ordinary text alone", () => {
        expect(redactSecrets("Record with ID 7 not found")).toBe("Record with ID 7 not found");
    });
});

describe("correlation context", () => {
    it("caps and sanitises an inbound id", () => {
        expect(normaliseCorrelationId("a".repeat(200))).toHaveLength(64);
        expect(normaliseCorrelationId('x\n{"level":50}')).toBe("xlevel50");
        expect(normaliseCorrelationId("!!!")).toBeUndefined();
    });

    it("exposes the id inside a scope and nothing outside one", () => {
        expect(getCorrelationId()).toBeUndefined();
        expect(runWithCorrelationId("abc-1", () => getCorrelationId())).toBe("abc-1");
        expect(getCorrelationId()).toBeUndefined();
    });
});
