import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load configuration
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "mcp_database.db");

// Validate SQLite database file path is writable/accessible on startup
if (dbPath !== ":memory:") {
    try {
        const resolvedPath = path.resolve(dbPath);
        const dir = path.dirname(resolvedPath);

        // Ensure directory exists
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Check directory write access
        fs.accessSync(dir, fs.constants.W_OK);

        // If file exists, check file write access
        if (fs.existsSync(resolvedPath)) {
            fs.accessSync(resolvedPath, fs.constants.W_OK);
        }
    } catch (error) {
        console.error(`Fatal startup error: SQLite database path '${dbPath}' is not writable/accessible:`, (error as Error).message);
        process.exit(1);
    }
}

// Initialize SQLite database connection
const db = new sqlite3.Database(dbPath);

// Initialize the database schema and seed data
db.serialize(() => {
    // Create the table if it doesn't exist
    db.run(`
        CREATE TABLE IF NOT EXISTS metrics_and_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key_name TEXT NOT NULL,
            status TEXT,
            detail_one TEXT,
            detail_two TEXT
        )
    `, (err) => {
        if (err) {
            console.error("Database schema initialization failed:", err.message);
        }
    });

    // Seed mock data if the table is completely empty
    db.get("SELECT COUNT(*) as count FROM metrics_and_data", (err: Error | null, row: any) => {
        if (err) {
            console.error("Failed to check if database needs seeding:", err.message);
            return;
        }
        if (row && row.count === 0) {
            console.error("Log: Seeding SQLite database with initial records...");
            const stmt = db.prepare(`
                INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
                VALUES (?, ?, ?, ?, ?)
            `);

            // Seed Engineering Delivery
            stmt.run("engineering_delivery", "RAG Pipeline Ingestion", "Validation", "Production Ready", null);
            stmt.run("engineering_delivery", "Graph Search Integration", "Discovery", null, "Q4 2026");

            // Seed Headcount
            stmt.run("headcount", "Full Stack Software Engineer", "Sourcing", "2 Allocations", "ENG-2026-Q3");
            stmt.run("headcount", "Frontend Developer", "Interviewing", "1 Allocation", null);

            // Seed Internal Metrics
            stmt.run("internal_metrics", "API Response Latency", "Optimized", "Under 8s Target", "7.4s Current");
            stmt.run("internal_metrics", "Token Throughput", "Stable", "94% Efficiency", null);

            stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                    console.error("Error finalizing database seeding statements:", finalizeErr.message);
                }
            });
        }
    });
});

const server = new McpServer({
    name: "slake-sqlite-tools",
    version: "1.0.0",
});

/**
 * TOOL 1: Query database records (Read)
 * 
 * Fetches rows matching a given category/domain.
 */
server.tool(
    "query_data_source",
    {
        category: z.string().describe("The data domain to search: internal_metrics, headcount, or engineering_delivery"),
    },
    async ({ category }) => {
        console.error(`Log: Executing SQL query for category: ${category}`);

        return new Promise((resolve) => {
            db.all(
                "SELECT key_name, status, detail_one, detail_two FROM metrics_and_data WHERE category = ?",
                [category],
                (err: Error | null, rows: any[]) => {
                    if (err) {
                        return resolve({
                            content: [
                                {
                                    type: "text",
                                    text: `Database error querying data source: ${err.message}`,
                                },
                            ],
                            isError: true,
                        });
                    }
                    resolve({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(rows, null, 2),
                            },
                        ],
                    });
                }
            );
        });
    }
);

/**
 * TOOL 2: Add new records to the database (Write!)
 * 
 * Inserts a new row into the database with category, key_name, status, and optional details.
 */
server.tool(
    "add_database_record",
    {
        category: z.string().describe("The domain category: internal_metrics, headcount, or engineering_delivery"),
        key_name: z.string().describe("The primary name of the metric, project, or job title"),
        status: z.string().describe("The current status (e.g. Sourcing, In Progress, Stable)"),
        detail_one: z.string().optional().describe("Additional descriptive detail"),
        detail_two: z.string().optional().describe("A second optional detail"),
    },
    async ({ category, key_name, status, detail_one, detail_two }) => {
        console.error(`Log: Writing new record to database...`);

        return new Promise((resolve) => {
            db.run(
                `INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
                 VALUES (?, ?, ?, ?, ?)`,
                [category, key_name, status, detail_one || null, detail_two || null],
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        return resolve({
                            content: [
                                {
                                    type: "text",
                                    text: `Database error adding record: ${err.message}`,
                                },
                            ],
                            isError: true,
                        });
                    }
                    resolve({
                        content: [
                            {
                                type: "text",
                                text: `Successfully inserted record. Row ID: ${this.lastID}`,
                            },
                        ],
                    });
                }
            );
        });
    }
);

/**
 * TOOL 3: Update existing records in the database (Update!)
 * 
 * Mutates an existing database row by its ID. Supports partial updates of all table fields.
 */
server.tool(
    "update_database_record",
    {
        id: z.number().int().describe("The ID of the record to update"),
        category: z.string().optional().describe("The new domain category (e.g. internal_metrics, headcount, or engineering_delivery)"),
        key_name: z.string().optional().describe("The new primary name of the metric, project, or job title"),
        status: z.string().optional().describe("The new status value"),
        detail_one: z.string().optional().describe("Additional descriptive detail (use null or empty string to clear)"),
        detail_two: z.string().optional().describe("A second optional detail (use null or empty string to clear)"),
    },
    async ({ id, category, key_name, status, detail_one, detail_two }) => {
        console.error(`Log: Updating record ID ${id} in database...`);

        // Check if zero update fields are provided
        if (
            category === undefined &&
            key_name === undefined &&
            status === undefined &&
            detail_one === undefined &&
            detail_two === undefined
        ) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: At least one update field (category, key_name, status, detail_one, or detail_two) must be provided for update.",
                    },
                ],
                isError: true,
            };
        }

        const updates: { col: string; val: any }[] = [];
        if (category !== undefined) updates.push({ col: "category", val: category });
        if (key_name !== undefined) updates.push({ col: "key_name", val: key_name });
        if (status !== undefined) updates.push({ col: "status", val: status });
        if (detail_one !== undefined) updates.push({ col: "detail_one", val: detail_one || null });
        if (detail_two !== undefined) updates.push({ col: "detail_two", val: detail_two || null });

        const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
        const params = updates.map((u) => u.val);
        params.push(id); // push id for WHERE clause

        const sql = `UPDATE metrics_and_data SET ${setClause} WHERE id = ?`;

        return new Promise((resolve) => {
            db.run(
                sql,
                params,
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        return resolve({
                            content: [
                                {
                                    type: "text",
                                    text: `Database error updating record: ${err.message}`,
                                },
                            ],
                            isError: true,
                        });
                    }
                    if (this.changes === 0) {
                        return resolve({
                            content: [
                                {
                                    type: "text",
                                    text: `Error: Record with ID ${id} not found`,
                                },
                            ],
                            isError: true,
                        });
                    }
                    resolve({
                        content: [
                            {
                                type: "text",
                                text: `Successfully updated record with ID: ${id}. Rows affected: ${this.changes}`,
                            },
                        ],
                    });
                }
            );
        });
    }
);

// NOTE: This relies on undocumented SDK internals (_requestHandlers). This may break silently on SDK version upgrades.
// If tool error formatting stops working after an SDK bump, check here first.
const serverInstance = server.server as any;
const originalCallToolHandler = serverInstance?._requestHandlers?.get
    ? serverInstance._requestHandlers.get("tools/call")
    : undefined;

if (originalCallToolHandler) {
    serverInstance._requestHandlers.set("tools/call", async (request: any, extra: any) => {
        const result = await originalCallToolHandler(request, extra);
        if (result && result.isError && result.content && result.content[0] && result.content[0].text) {
            const text = result.content[0].text;
            // NOTE: This regex is tightly coupled to the MCP SDK's current error message prefix formatting.
            // If the SDK changes its error formatting, this regex may silently stop matching and fall back to raw text.
            const match = text.match(/^(?:MCP error [-\d]+: )?(Input validation error: Invalid arguments for tool [^:]+: )([\s\S]+)$/);
            if (match) {
                const rawJson = match[2];
                try {
                    const issues = JSON.parse(rawJson);
                    if (Array.isArray(issues)) {
                        const formatted = issues.map((issue: any) => {
                            const path = issue.path.join(".");
                            const cleanMsg = issue.message.replace(/^Invalid input:\s*/i, "");
                            if (cleanMsg.toLowerCase() === "required") {
                                return `Field '${path}' is required`;
                            }
                            return `Field '${path}': ${cleanMsg}`;
                        }).join("; ");
                        result.content[0].text = `Input validation error: ${formatted}`;
                    }
                } catch (e) {
                    // Ignore JSON parsing errors and return original text
                }
            }
        }
        return result;
    });
} else {
    console.error("Warning: error-formatting wrapper could not attach because undocumented SDK internals changed. Raw Zod errors will be returned.");
}

/**
 * Starts the MCP stdio server transport.
 */
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running on Stdio with SQLite");
}

// Check if run directly
const isMain = process.argv[1] && (
    process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("/server.ts") ||
    process.argv[1].endsWith("/server.js") ||
    process.argv[1].endsWith("\\server.ts") ||
    process.argv[1].endsWith("\\server.js")
);

if (isMain) {
    runServer().catch((error) => {
        console.error("Fatal error starting the MCP server:", error);
        process.exit(1);
    });
}

export { server, db };