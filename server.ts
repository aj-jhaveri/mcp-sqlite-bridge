import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "mcp_database.db");

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
    `);

    // Seed mock data if the table is completely empty
    db.get("SELECT COUNT(*) as count FROM metrics_and_data", (err: Error | null, row: any) => {
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

            stmt.finalize();
        }
    });
});

const server = new McpServer({
    name: "slake-sqlite-tools",
    version: "1.0.0",
});

// TOOL 1: Query database records (Read)
server.tool(
    "query_data_source",
    {
        category: z.string().describe("The data domain to search: internal_metrics, headcount, or engineering_delivery"),
    },
    async ({ category }) => {
        console.error(`Log: Executing SQL query for category: ${category}`);

        return new Promise((resolve, reject) => {
            db.all(
                "SELECT key_name, status, detail_one, detail_two FROM metrics_and_data WHERE category = ?",
                [category],
                (err: Error | null, rows: any[]) => {
                    if (err) {
                        return reject(err);
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

// TOOL 2: Add new records to the database (Write!)
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

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
                 VALUES (?, ?, ?, ?, ?)`,
                [category, key_name, status, detail_one || null, detail_two || null],
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        return reject(err);
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

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running on Stdio with SQLite");
}

runServer().catch((error) => {
    console.error("Fatal error starting the MCP server:", error);
    process.exit(1);
});