import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * End-to-end protocol conformance, driven by the real SDK client.
 *
 * Every other test in this repo either calls the tool handlers directly or posts
 * hand-written JSON at the legacy /api/mcp endpoint. Neither exercises the actual
 * MCP protocol, so a server that had stopped being a valid MCP server would still
 * pass them. These tests perform the genuine handshake over both supported
 * transports and assert on what a real client observes.
 *
 * Requires `npm run build` first — CI builds before testing.
 */

const SERVER_JS = path.resolve(__dirname, "..", "dist", "server.js");

function tempDbPath(label: string): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `mcp-${label}-`)), "test.db");
}

describe("MCP protocol conformance — stdio transport", () => {
    let client: Client;

    beforeAll(async () => {
        client = new Client({ name: "conformance-test", version: "1.0.0" });
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [SERVER_JS],
            // READ_ONLY deliberately unset: the client must observe the shipped default.
            env: { ...process.env, STDIO: "true", DB_PATH: tempDbPath("stdio") } as Record<string, string>,
        }));
    }, 30000);

    afterAll(async () => {
        await client?.close();
    });

    it("completes the initialize handshake and reports server identity", () => {
        const info = client.getServerVersion();
        expect(info?.name).toBe("slake-sqlite-tools");
        expect(info?.version).toBe("1.0.0");
    });

    it("advertises the read tool with a usable description", async () => {
        const { tools } = await client.listTools();
        const query = tools.find(t => t.name === "query_data_source");
        expect(query).toBeDefined();
        // An agent routes on this string; `undefined` would make the tool unusable
        // in practice even though it is technically advertised.
        expect(query!.description).toBeTruthy();
        expect(query!.description!.length).toBeGreaterThan(40);
    });

    it("does not advertise mutation tools under the default posture", async () => {
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name);
        expect(names).not.toContain("add_database_record");
        expect(names).not.toContain("update_database_record");
    });

    it("returns real records from a tool call", async () => {
        const result = await client.callTool({
            name: "query_data_source",
            arguments: { category: "engineering_delivery" },
        });
        const text = (result.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === "text").map(b => b.text).join("");
        expect(text).toContain("RAG Pipeline Ingestion");
    });

    it("refuses a write tool that was never advertised", async () => {
        // A hostile client can name a tool it was not offered. The dispatch layer,
        // not the advertised list, is what has to refuse it.
        //
        // MCP surfaces this as an error *result* rather than a transport-level
        // throw, so the call resolves — asserting `.rejects` here would pass a
        // server that happily performed the write.
        const result = await client.callTool({
            name: "add_database_record",
            arguments: { category: "x", key_name: "y", status: "z" },
        });
        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === "text").map(b => b.text).join("");
        expect(text).toContain("not found");
    });
});

describe("MCP protocol conformance — Streamable HTTP transport", () => {
    let child: ChildProcess;
    let client: Client;
    const port = 3899;

    beforeAll(async () => {
        child = spawn(process.execPath, [SERVER_JS], {
            env: { ...process.env, PORT: String(port), DB_PATH: tempDbPath("http") },
            stdio: "pipe",
        });

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
            child.stderr!.on("data", (buf: Buffer) => {
                if (buf.toString().includes("listening on port")) {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });

        client = new Client({ name: "conformance-test-http", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
    }, 40000);

    afterAll(async () => {
        await client?.close();
        child?.kill();
    });

    it("completes the initialize handshake over HTTP", () => {
        expect(client.getServerVersion()?.name).toBe("slake-sqlite-tools");
    });

    it("serves consecutive requests on a stateless transport", async () => {
        // The regression this pins: a single shared transport answered `initialize`
        // and then 500'd on every subsequent request. Two calls in a row is the
        // whole point of the per-request construction.
        const first = await client.listTools();
        const second = await client.listTools();
        expect(first.tools.map(t => t.name)).toEqual(second.tools.map(t => t.name));
    });

    it("exposes the same tool surface as stdio", async () => {
        const { tools } = await client.listTools();
        expect(tools.map(t => t.name)).toEqual(["query_data_source"]);
    });

    it("returns real records over HTTP", async () => {
        const result = await client.callTool({
            name: "query_data_source",
            arguments: { category: "headcount" },
        });
        const text = (result.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === "text").map(b => b.text).join("");
        expect(text).toContain("Full Stack Software Engineer");
    });
});

describe("MCP protocol conformance — explicit write mode", () => {
    let client: Client;

    beforeAll(async () => {
        client = new Client({ name: "conformance-test-rw", version: "1.0.0" });
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [SERVER_JS],
            env: {
                ...process.env,
                STDIO: "true",
                READ_ONLY: "false",
                DB_PATH: tempDbPath("rw"),
            } as Record<string, string>,
        }));
    }, 30000);

    afterAll(async () => {
        await client?.close();
    });

    it("advertises mutation tools only when write access is opted into", async () => {
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name);
        expect(names).toContain("add_database_record");
        expect(names).toContain("update_database_record");
    });
});
