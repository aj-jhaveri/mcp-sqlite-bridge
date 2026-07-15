import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { createDatabase } from "../src/db/database.js";
import { SqliteMetricsRepository } from "../src/db/repository.js";
import { registerTools } from "../src/tools/index.js";
import { setupErrorFormatting } from "../src/middleware/error-handler.js";

/**
 * A clean, type-safe mock transport that facilitates in-memory process piping
 * for strict black-box client/server communication testing.
 */
class InMemoryMockTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    constructor(public other?: InMemoryMockTransport) {}

    async start(): Promise<void> {}
    async close(): Promise<void> {
        this.onclose?.();
    }
    async send(message: JSONRPCMessage): Promise<void> {
        // Asynchronously deliver the message to simulate boundary crossings
        setTimeout(() => this.other?.onmessage?.(message), 0);
    }
}

/**
 * Test setup helper using dependency injection to boot isolated server & DB instances.
 * Establishes a true client connection over mock transport to test public API contracts.
 */
async function setupTestEnvironment(readOnly: boolean) {
    const server = new McpServer({
        name: "test-security-server",
        version: "1.0.0",
    });

    const db = await createDatabase({
        dbPath: ":memory:",
        readOnly,
    });
    const repo = new SqliteMetricsRepository(db);
    const config = { dbPath: ":memory:", readOnly };

    // Setup error interceptor BEFORE tool registration
    setupErrorFormatting(server);
    registerTools(server, repo, config);

    const serverTransport = new InMemoryMockTransport();
    const clientTransport = new InMemoryMockTransport();
    serverTransport.other = clientTransport;
    clientTransport.other = serverTransport;

    await server.connect(serverTransport);

    const client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} }
    );
    await client.connect(clientTransport);

    const callTool = async (name: string, args: Record<string, any>) => {
        try {
            const res = await client.callTool({
                name,
                arguments: args,
            });
            // Normalize return to match expected test payload formats
            return {
                content: res.content,
                isError: res.isError ? true : undefined,
            };
        } catch (err: any) {
            // Return raw error structures for unregistered tools or protocol violations
            return {
                content: [{ type: "text" as const, text: err.message }],
                isError: true,
            };
        }
    };

    const listTools = async () => {
        return await client.listTools();
    };

    return { db, callTool, listTools, client, server };
}

describe("MCP SQLite Bridge Security & Isolation Suite", () => {
    describe("READ_ONLY Permission Controls", () => {
        it("should expose only read tools when READ_ONLY is enabled", async () => {
            const { listTools, callTool } = await setupTestEnvironment(true);

            const toolList = await listTools();
            const names = toolList.tools.map((t) => t.name);

            expect(names).toContain("query_data_source");
            expect(names).not.toContain("add_database_record");
            expect(names).not.toContain("update_database_record");

            // Attempting to call mutating tools directly should fail
            const addResult = await callTool("add_database_record", {
                category: "engineering_delivery",
                key_name: "Forbidden record",
                status: "Open",
            });

            expect(addResult.isError).toBe(true);
            expect(addResult.content[0].text).toContain("not found");
        });

        it("should expose full CRUD tools when READ_ONLY is disabled", async () => {
            const { listTools } = await setupTestEnvironment(false);

            const toolList = await listTools();
            const names = toolList.tools.map((t) => t.name);

            expect(names).toContain("query_data_source");
            expect(names).toContain("add_database_record");
            expect(names).toContain("update_database_record");
        });
    });

    describe("SQL Injection & Parameter boundaries", () => {
        it("should reject malicious category parameters at the schema validation boundary", async () => {
            const { callTool } = await setupTestEnvironment(false);

            // Attempt SQL Injection payload in query_data_source category parameter
            const result = await callTool("query_data_source", {
                category: "headcount' OR '1'='1",
            });

            // Strict Zod enums reject it at the boundary, returning a validation error
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Input validation error:");
            expect(result.content[0].text).toContain("expected one of");

            // Drop table payload attempt
            const dropResult = await callTool("query_data_source", {
                category: "engineering_delivery'; DROP TABLE metrics_and_data;--",
            });

            expect(dropResult.isError).toBe(true);
        });

        it("should handle SQL injection payloads safely in generic string insert and update statements", async () => {
            const { callTool } = await setupTestEnvironment(false);

            // Attempt injection during add on the generic string field key_name
            const addResult = await callTool("add_database_record", {
                category: "engineering_delivery",
                key_name: "Malicious Job'); DROP TABLE metrics_and_data;--",
                status: "Sourcing",
            });

            expect(addResult.isError).toBeUndefined();

            // Verify table still exists and data was inserted literally
            const queryResult = await callTool("query_data_source", {
                category: "engineering_delivery",
            });
            expect(queryResult.isError).toBeUndefined();

            const rows = JSON.parse(queryResult.content[0].text);
            const inserted = rows.find((r: any) => r.key_name.includes("DROP TABLE"));
            expect(inserted).toBeDefined();
        });
    });

    describe("Validation Robustness & Formatting", () => {
        it("should capture and format Zod errors into agent-friendly responses", async () => {
            const { callTool } = await setupTestEnvironment(false);

            const result = await callTool("add_database_record", {
                category: 12345, // invalid type (number instead of enum/string)
                // status missing (required field)
            });

            expect(result.isError).toBe(true);
            const errorMsg = result.content[0].text;
            expect(errorMsg).toContain("Input validation error:");
            expect(errorMsg).toContain("Field 'category':");
            expect(errorMsg).toContain("expected one of");
            expect(errorMsg).toContain("Field 'status': expected string, received undefined");
        });
    });

    describe("CRUD operations", () => {
        it("should execute full write-read-update lifecycle", async () => {
            const { callTool } = await setupTestEnvironment(false);

            // 1. Create
            const addResult = await callTool("add_database_record", {
                category: "internal_metrics",
                key_name: "System CPU Load",
                status: "Healthy",
                detail_one: "42% average",
            });
            expect(addResult.isError).toBeUndefined();
            const match = addResult.content[0].text.match(/Row ID: (\d+)/);
            expect(match).not.toBeNull();
            const rowId = parseInt(match![1], 10);

            // 2. Read
            const queryResult = await callTool("query_data_source", {
                category: "internal_metrics",
            });
            const rowsBefore = JSON.parse(queryResult.content[0].text);
            const foundRecord = rowsBefore.find((r: any) => r.key_name === "System CPU Load");
            expect(foundRecord).toBeDefined();
            expect(foundRecord.status).toBe("Healthy");

            // 3. Update
            const updateResult = await callTool("update_database_record", {
                id: rowId,
                status: "Warning",
                detail_one: "89% peak spikes",
            });
            expect(updateResult.isError).toBeUndefined();

            // 4. Read & Verify
            const queryResultAfter = await callTool("query_data_source", {
                category: "internal_metrics",
            });
            const rowsAfter = JSON.parse(queryResultAfter.content[0].text);
            const updatedRecord = rowsAfter.find((r: any) => r.key_name === "System CPU Load");
            expect(updatedRecord.status).toBe("Warning");
            expect(updatedRecord.detail_one).toBe("89% peak spikes");
        });
    });
});
