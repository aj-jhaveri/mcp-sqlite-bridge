#!/usr/bin/env node
/**
 * A real MCP client.
 *
 * The web demo on slakedesign.com hand-writes JSON-RPC envelopes and posts them at
 * the legacy /api/mcp endpoint. That is not an MCP client — it never performs the
 * initialize handshake, never negotiates capabilities, and would not work against
 * any other MCP server. This is the genuine article: the official SDK client,
 * speaking the protocol, over either supported transport.
 *
 * Usage:
 *   npm run client                       # stdio - spawns dist/server.js as a subprocess
 *   npm run client -- --http             # Streamable HTTP against http://localhost:3000/mcp
 *   npm run client -- --http --url <url> # Streamable HTTP against a remote server
 *   npm run client -- --category headcount
 *
 * stdio mode requires a build first (`npm run build`); it launches the compiled
 * server the same way Claude Desktop would.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ClientOptions {
    /** Use the Streamable HTTP transport instead of stdio. */
    http?: boolean;
    /** Endpoint for HTTP mode. */
    url?: string;
    /** Category argument passed to query_data_source. */
    category?: string;
}

export function parseArgs(argv: string[]): ClientOptions {
    const options: ClientOptions = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--http") {
            options.http = true;
        } else if (arg === "--url") {
            const next = argv[++i];
            if (!next) throw new Error("--url requires a value");
            options.url = next;
            options.http = true;
        } else if (arg === "--category") {
            const next = argv[++i];
            if (!next) throw new Error("--category requires a value");
            options.category = next;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

/**
 * Builds the transport for the selected mode.
 *
 * stdio launches the server as a child process and speaks over its pipes — the
 * same mechanism a desktop MCP client uses. READ_ONLY is left unset deliberately
 * so the client observes the server's real default rather than a relaxed one.
 */
export function createTransport(options: ClientOptions): Transport {
    if (options.http) {
        return new StreamableHTTPClientTransport(
            new URL(options.url ?? "http://localhost:3000/mcp")
        );
    }

    return new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve(__dirname, "..", "server.js")],
        env: { ...process.env, STDIO: "true" } as Record<string, string>,
    });
}

export async function main(options: ClientOptions): Promise<void> {
    const client = new Client({ name: "slake-mcp-client", version: "1.0.0" });
    const transport = createTransport(options);

    const mode = options.http ? `Streamable HTTP (${options.url ?? "http://localhost:3000/mcp"})` : "stdio";
    console.log(`Connecting over ${mode}...`);

    // connect() performs the initialize handshake and capability negotiation.
    await client.connect(transport);

    const serverInfo = client.getServerVersion();
    console.log(`Connected to ${serverInfo?.name} v${serverInfo?.version}\n`);

    const { tools } = await client.listTools();
    console.log(`Tools advertised (${tools.length}):`);
    for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
    }

    const category = options.category ?? "engineering_delivery";
    console.log(`\nCalling query_data_source(category="${category}")...`);
    const result = await client.callTool({
        name: "query_data_source",
        arguments: { category },
    });

    for (const block of result.content as Array<{ type: string; text?: string }>) {
        if (block.type === "text") console.log(block.text);
    }

    // Demonstrate the authorization boundary from a real client's perspective:
    // in read-only mode the mutation tool is not advertised at all, so a
    // well-behaved agent never plans a write.
    const writeAdvertised = tools.some(t => t.name === "add_database_record");
    console.log(`\nWrite tools advertised: ${writeAdvertised}`);

    await client.close();
}

if (process.argv[1] && process.argv[1].endsWith("mcp-client.ts") || process.argv[1]?.endsWith("mcp-client.js")) {
    main(parseArgs(process.argv.slice(2))).catch((err) => {
        console.error(`\nClient failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
