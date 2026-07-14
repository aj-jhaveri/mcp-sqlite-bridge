import { describe, it, expect, beforeAll } from "vitest";

// Set isolated database path to in-memory BEFORE importing the server
process.env.DB_PATH = ":memory:";

import { server, db } from "../server.js";

describe("MCP SQLite Bridge Server", () => {
    // Helper to call tools programmatically
    const callTool = async (name: string, args: Record<string, any>) => {
        const handler = (server.server as any)._requestHandlers.get("tools/call");
        if (!handler) throw new Error("tools/call handler not found");
        return await handler({
            method: "tools/call",
            params: {
                name,
                arguments: args,
            },
        }, {
            signal: new AbortController().signal,
        });
    };

    beforeAll(() => {
        // Wait a small moment to ensure DB serialization & seeding finishes
        return new Promise((resolve) => setTimeout(resolve, 200));
    });

    describe("Input Validation (Zod)", () => {
        it("should reject malformed input for add_database_record", async () => {
            const result = await callTool("add_database_record", {
                category: 123, // should be string
                key_name: "Test Job",
                // status is missing (Required)
            });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Input validation error");
            expect(result.content[0].text).toContain("Field 'category': expected string, received number");
            expect(result.content[0].text).toContain("Field 'status': expected string, received undefined");
        });

        it("should reject malformed input for update_database_record", async () => {
            const result = await callTool("update_database_record", {
                id: "not-a-number", // should be integer number
                status: 123, // should be string
            });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Input validation error");
            expect(result.content[0].text).toContain("Field 'id': expected number, received string");
            expect(result.content[0].text).toContain("Field 'status': expected string, received number");
        });

        it("should reject update_database_record with zero update fields", async () => {
            const result = await callTool("update_database_record", {
                id: 1,
            });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Error: At least one update field");
        });

        it("should verify the Zod error formatter regex matches the SDK's actual error string structure", async () => {
            // NOTE: This test guards the regex used in the global error handler. If the SDK updates its error prefix
            // format, this test will fail, alerting maintainers to update the regex in server.ts.
            const result = await callTool("add_database_record", {
                category: 123, // wrong type to trigger validation error
            });

            expect(result.isError).toBe(true);
            const errorMessage = result.content[0].text;
            
            // Confirm the formatting succeeded and contains clean strings instead of the raw JSON array of issues
            expect(errorMessage).toContain("Input validation error: Field 'category'");
            expect(errorMessage).not.toContain('"code"');
            expect(errorMessage).not.toContain('"expected"');
        });
    });

    describe("CRUD operations", () => {
        it("should query initial records successfully", async () => {
            const result = await callTool("query_data_source", {
                category: "headcount",
            });

            expect(result.isError).toBeUndefined();
            const rows = JSON.parse(result.content[0].text);
            expect(Array.isArray(rows)).toBe(true);
            expect(rows.length).toBeGreaterThan(0);
            expect(rows[0]).toHaveProperty("key_name");
            expect(rows[0]).toHaveProperty("status");
        });

        it("should add a new record successfully and retrieve it", async () => {
            // Add a record
            const addResult = await callTool("add_database_record", {
                category: "engineering_delivery",
                key_name: "Vitest Integration Tests",
                status: "In Progress",
                detail_one: "Running in memory",
            });

            expect(addResult.isError).toBeUndefined();
            expect(addResult.content[0].text).toContain("Successfully inserted record. Row ID: ");

            // Query category to verify it is there
            const queryResult = await callTool("query_data_source", {
                category: "engineering_delivery",
            });
            const rows = JSON.parse(queryResult.content[0].text);
            const insertedRow = rows.find((r: any) => r.key_name === "Vitest Integration Tests");
            expect(insertedRow).toBeDefined();
            expect(insertedRow.status).toBe("In Progress");
            expect(insertedRow.detail_one).toBe("Running in memory");
        });

        it("should update an existing record successfully", async () => {
            // Seed a clean record to update to avoid hardcoding ID assumptions
            const addResult = await callTool("add_database_record", {
                category: "internal_metrics",
                key_name: "Test Update Metric",
                status: "Pending",
            });
            const match = addResult.content[0].text.match(/Row ID: (\d+)/);
            if (!match) throw new Error("Could not extract inserted row ID");
            const newId = parseInt(match[1], 10);

            // Update it
            const updateResult = await callTool("update_database_record", {
                id: newId,
                status: "Active",
                detail_one: "Updated detail",
            });

            expect(updateResult.isError).toBeUndefined();
            expect(updateResult.content[0].text).toContain(`Successfully updated record with ID: ${newId}`);

            // Query category to verify updates took place
            const queryResult = await callTool("query_data_source", {
                category: "internal_metrics",
            });
            const rows = JSON.parse(queryResult.content[0].text);
            const updatedRow = rows.find((r: any) => r.key_name === "Test Update Metric");
            expect(updatedRow).toBeDefined();
            expect(updatedRow.status).toBe("Active");
            expect(updatedRow.detail_one).toBe("Updated detail");
        });
    });

    describe("Database Error Handling Paths", () => {
        it("should return a graceful error response on database failures", async () => {
            // NOTE: This test closes the db connection and does not reopen it. It must remain
            // the LAST test in this file — any test added after this point will fail due to the
            // closed connection.
            db.close((closeErr) => {
                if (closeErr) console.error("Error closing database in test:", closeErr.message);
            });

            // Call tool
            const result = await callTool("query_data_source", {
                category: "headcount",
            });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Database error querying data source");
        });
    });
});
