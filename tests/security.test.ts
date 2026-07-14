import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDatabase } from "../src/db/database.js";
import { registerTools } from "../src/tools/index.js";
import { setupErrorFormatting } from "../src/middleware/error-handler.js";

/**
 * Test setup helper using dependency injection to boot isolated server & DB instances.
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

    const config = { dbPath: ":memory:", readOnly };

    registerTools(server, db, config);
    setupErrorFormatting(server);

    const callTool = async (name: string, args: Record<string, any>) => {
        const handler = (server.server as any)._requestHandlers.get("tools/call");
        if (!handler) throw new Error("tools/call handler not found");
        return await handler(
            {
                method: "tools/call",
                params: {
                    name,
                    arguments: args,
                },
            },
            {
                signal: new AbortController().signal,
            }
        );
    };

    const listTools = async () => {
        const handler = (server.server as any)._requestHandlers.get("tools/list");
        if (!handler) throw new Error("tools/list handler not found");
        return await handler(
            {
                method: "tools/list",
            },
            {
                signal: new AbortController().signal,
            }
        );
    };

    return { db, callTool, listTools };
}

describe("MCP SQLite Bridge Security & Isolation Suite", () => {
    describe("READ_ONLY Permission Controls", () => {
        it("should expose only read tools when READ_ONLY is enabled", async () => {
            const { listTools, callTool } = await setupTestEnvironment(true);

            const toolList = await listTools();
            const names = toolList.tools.map((t: any) => t.name);

            expect(names).toContain("query_data_source");
            expect(names).not.toContain("add_database_record");
            expect(names).not.toContain("update_database_record");

            // Attempting to call mutating tools directly should fail (since they are not registered)
            const addResult = await callTool("add_database_record", {
                category: "engineering_delivery",
                key_name: "Forbidden record",
                status: "Open",
            }).catch((err) => err);

            // The SDK's underlying RPC router returns undefined or throws error for unregistered tools
            expect(addResult).toBeDefined();
            // Since original handler won't match, SDK throws an MCP error
            if (addResult && !addResult.isError) {
                // If it resolves, it should be an error status
                expect(addResult.isError).toBe(true);
            }
        });

        it("should expose full CRUD tools when READ_ONLY is disabled", async () => {
            const { listTools } = await setupTestEnvironment(false);

            const toolList = await listTools();
            const names = toolList.tools.map((t: any) => t.name);

            expect(names).toContain("query_data_source");
            expect(names).toContain("add_database_record");
            expect(names).toContain("update_database_record");
        });
    });

    describe("SQL Injection Mitigations", () => {
        it("should handle malicious category parameters safely in read queries", async () => {
            const { callTool, db } = await setupTestEnvironment(false);

            // Attempt SQL Injection payload in query_data_source category parameter
            const result = await callTool("query_data_source", {
                category: "headcount' OR '1'='1",
            });

            expect(result.isError).toBeUndefined();
            const rows = JSON.parse(result.content[0].text);
            // Parameterization means searching for category literally matching the payload, returning empty array
            expect(rows).toEqual([]);

            // Drop table payload attempt
            const dropResult = await callTool("query_data_source", {
                category: "engineering_delivery'; DROP TABLE metrics_and_data;--",
            });

            expect(dropResult.isError).toBeUndefined();

            // Verify table still exists and can query valid records successfully
            const verification = await callTool("query_data_source", {
                category: "headcount",
            });
            expect(verification.isError).toBeUndefined();
            const validRows = JSON.parse(verification.content[0].text);
            expect(validRows.length).toBeGreaterThan(0);
        });

        it("should handle SQL injection payloads safely in insert and update statements", async () => {
            const { callTool } = await setupTestEnvironment(false);

            // Attempt injection during add
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
            const rows = JSON.parse(queryResult.content[0].text);
            const inserted = rows.find((r: any) => r.key_name.includes("DROP TABLE"));
            expect(inserted).toBeDefined();
        });
    });

    describe("Validation Robustness & Formatting", () => {
        it("should capture and format Zod errors into agent-friendly responses", async () => {
            const { callTool } = await setupTestEnvironment(false);

            const result = await callTool("add_database_record", {
                category: 12345, // invalid type
                // status missing
            });

            expect(result.isError).toBe(true);
            const errorMsg = result.content[0].text;
            expect(errorMsg).toContain("Input validation error:");
            expect(errorMsg).toContain("Field 'category': expected string, received number");
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
