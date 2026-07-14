import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

import { ServerConfig } from "./types/database.js";
import { validateDatabasePath } from "./db/database.js";
import { CREATE_TABLE_SQL } from "./db/schema.js";
import { seedDatabase } from "./db/seed.js";
import { registerTools } from "./tools/index.js";
import { setupErrorFormatting } from "./middleware/error-handler.js";

// Load configuration
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DB path. If relative path is supplied, resolve relative to the main project directory.
let rawDbPath = process.env.DB_PATH || path.join(__dirname, "..", "mcp_database.db");
if (rawDbPath !== ":memory:" && !path.isAbsolute(rawDbPath)) {
    rawDbPath = path.resolve(__dirname, "..", rawDbPath);
}

const config: ServerConfig = {
    dbPath: rawDbPath,
    readOnly: process.env.READ_ONLY === "true",
};

// Validate SQLite database file path write privileges
validateDatabasePath(config.dbPath);

// Initialize SQLite database connection
const db = new sqlite3.Database(config.dbPath);

// Initialize the database schema and seed data asynchronously
db.serialize(() => {
    db.run(CREATE_TABLE_SQL, (err) => {
        if (err) {
            console.error("Database schema initialization failed:", err.message);
        } else {
            seedDatabase(db).catch((seedErr) => {
                console.error("Database seeding failed:", seedErr.message);
            });
        }
    });
});

// Initialize MCP Server
const server = new McpServer({
    name: "slake-sqlite-tools",
    version: "1.0.0",
});

// Register tools based on configuration
registerTools(server, db, config);

// Setup error formatting middleware
setupErrorFormatting(server);

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
    process.argv[1].endsWith("\\server.js") ||
    process.argv[1].endsWith("dist/server.js") ||
    process.argv[1].endsWith("dist\\server.js")
);

if (isMain) {
    runServer().catch((error) => {
        console.error("Fatal error starting the MCP server:", error);
        process.exit(1);
    });
}

export { server, db };
