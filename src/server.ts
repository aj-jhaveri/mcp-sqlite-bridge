import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import {
  corsMiddleware,
  parseAllowedOrigins,
  perIpLimiter,
  globalLimiter,
} from "./middleware/http.security.js";

import { ServerConfig } from "./types/database.js";
import { resolveReadOnly } from "./config/security.js";
import { createDatabase } from "./db/database.js";
import { SqliteMetricsRepository } from "./db/repository.js";
import { registerTools } from "./tools/index.js";
import { setupErrorFormatting } from "./middleware/error-handler.js";
dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let rawDbPath = process.env.DB_PATH || path.join(__dirname, "..", "mcp_database.db");
if (rawDbPath !== ":memory:" && !path.isAbsolute(rawDbPath)) {
    rawDbPath = path.resolve(__dirname, "..", rawDbPath);
}

// Read-only is the DEFAULT, not an opt-in — see resolveReadOnly. This server is
// deployed as a public, unauthenticated endpoint, so an unset or misspelled variable
// must fail safe. Writes require an explicit READ_ONLY=false.
const config: ServerConfig = {
    dbPath: rawDbPath,
    readOnly: resolveReadOnly(process.env.READ_ONLY),
};

const db = await createDatabase(config);
const repo = new SqliteMetricsRepository(db);

/**
 * Builds a fully-configured MCP server bound to the shared repository.
 *
 * A factory rather than a single instance because the Streamable HTTP transport
 * runs statelessly: each request gets its own server + transport pair, so
 * concurrent callers cannot collide on in-flight request IDs. The database and
 * repository are shared — only the protocol layer is per-request, which is cheap.
 */
function createMcpServer(): McpServer {
    const instance = new McpServer({
        name: "slake-sqlite-tools",
        version: "1.0.0",
    });

    setupErrorFormatting(instance);
    registerTools(instance, repo, config);
    return instance;
}

// The long-lived instance backing the stdio transport and the test suite.
const server = createMcpServer();

// Express HTTP Application Server for Remote MCP Protocol Requests
const app = express();

// Trust the platform proxy so the rate limiter sees the real client address rather
// than the load balancer's. Render terminates TLS at one hop.
app.set("trust proxy", 1);

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
app.use(corsMiddleware(allowedOrigins));
app.use(express.json({ limit: "64kb" }));

// Health Check Endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "HEALTHY",
    timestamp: new Date().toISOString(),
    service: "mcp-sqlite-bridge",
    dbPath: rawDbPath.split('/').pop(),
    readOnly: config.readOnly
  });
});

// ---------------------------------------------------------------------------
// /mcp - the real MCP Streamable HTTP transport.
//
// This is the endpoint an actual MCP client connects to. It performs the full
// protocol handshake (initialize, capability negotiation, tools/list, tools/call)
// via the SDK's own transport, rather than the hand-rolled JSON-RPC switch below.
//
// Stateless (`sessionIdGenerator: undefined`) because the deploy target runs a
// single instance on an ephemeral filesystem: there is nowhere to keep session
// state, and nothing that needs it. `enableJsonResponse` returns plain JSON
// instead of holding an SSE stream open, which suits a request/response demo
// backend and avoids long-lived connections on a small instance.
//
// The read-only default in src/config/security.ts is what makes exposing a
// protocol-compliant endpoint publicly safe: a real client can discover and
// call query_data_source, and cannot reach a mutation tool at all.
// ---------------------------------------------------------------------------
app.post("/mcp", globalLimiter, perIpLimiter, async (req: Request, res: Response) => {
  // A fresh server + transport per request. Sharing one transport across
  // requests is the STATEFUL pattern: without a session to scope them, the
  // second request lands on a transport that has already completed its
  // lifecycle and the handler fails with a 500. Statelessness is what makes
  // this safe on an ephemeral single instance, and per-request construction is
  // what makes statelessness correct.
  const requestServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void requestServer.close();
  });

  await requestServer.connect(transport);
  // express.json() has already consumed the body, so it is passed through
  // explicitly rather than letting the transport re-read the stream.
  await transport.handleRequest(req, res, req.body);
});

// The two transports are mutually exclusive, and stdio must not bind a port.
//
// An MCP client (Claude Desktop, Cursor) launches this file as a subprocess and
// speaks over its pipes. Binding a TCP port there is at best pointless and at worst
// fatal: if the port is already taken the process exits with EADDRINUSE before the
// handshake, and the client reports only "Connection closed" — the same message it
// gives for every other startup failure, which makes the real cause invisible.
//
// HTTP stays the default so the deployed service needs no configuration.
const STDIO_MODE = process.env.STDIO === "true";

if (!STDIO_MODE) {
  // A client launching this as a subprocess gives it piped stdin; a human running it
  // in a terminal does not. If stdin is piped and STDIO was not set, this is almost
  // certainly an MCP client whose config is missing the variable — it will now sit
  // waiting for a handshake that this process is never going to send, and report only
  // "Connection closed". Say so on stderr, where the client surfaces server logs.
  // PORT is set by every hosting platform and by nothing an MCP client does, so it
  // distinguishes a deployed container (non-TTY stdin, legitimately serving HTTP) from
  // a client subprocess whose config is missing STDIO. Without this check the warning
  // fired on every healthy production boot, which is worse than not warning at all:
  // a log line that cries wolf on success trains readers to ignore it.
  if (!process.stdin.isTTY && !process.env.PORT) {
    console.error(
      'WARNING: started without STDIO=true but stdin is not a TTY. If an MCP client ' +
      'launched this process, it will hang and then report "Connection closed": this ' +
      'process is serving HTTP, not the stdio transport. Add "env": { "STDIO": "true" } ' +
      'to the server entry in your MCP client config.'
    );
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.error(
      `MCP Server listening on port ${PORT} (MCP endpoint: /mcp, ` +
      `origins allowed: ${allowedOrigins.length}, rate limits active)`
    );
  });
}

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on Stdio with SQLite");
}

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

const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("/server.ts") ||
  process.argv[1].endsWith("/server.js") ||
  process.argv[1].endsWith("dist/server.js")
);

if (isMain && STDIO_MODE) {
  runServer().catch((error) => {
    console.error("Fatal error starting stdio MCP server:", error);
  });
}

export { server, db, app };
