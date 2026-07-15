import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

import { ServerConfig } from "./types/database.js";
import { createDatabase } from "./db/database.js";
import { SqliteMetricsRepository } from "./db/repository.js";
import { registerTools } from "./tools/index.js";
import { setupErrorFormatting } from "./middleware/error-handler.js";

// Load configuration
dotenv.config({ quiet: true });

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

// Asynchronously initialize database connection, create schema, and seed default data
const db = await createDatabase(config);
const repo = new SqliteMetricsRepository(db);

// Initialize MCP Server
const server = new McpServer({
    name: "slake-sqlite-tools",
    version: "1.0.0",
});

// Setup error formatting middleware BEFORE registering tools to intercept handler calls
setupErrorFormatting(server);

// Register tools based on configuration, passing the repository abstraction
registerTools(server, repo, config);

/**
 * Starts the MCP stdio server transport.
 */
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running on Stdio with SQLite");
}

/**
 * Perform clean teardown on process signals (SIGINT, SIGTERM).
 */
const cleanup = async () => {
    console.error("\nLog: Shutting down MCP server gracefully...");
    try {
        await server.close();
    } catch (err) {
        console.error("Error closing MCP server:", err instanceof Error ? err.message : String(err));
    }

    await new Promise<void>((resolve) => {
        db.close((err) => {
            if (err) {
                console.error("Error closing SQLite database:", err.message);
            } else {
                console.error("Log: SQLite database connection closed gracefully.");
            }
            resolve();
        });
    });
    process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

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
