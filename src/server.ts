import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";

import { ServerConfig } from "./types/database.js";
import { resolveReadOnly } from "./config/security.js";
import { createDatabase } from "./db/database.js";
import { SqliteMetricsRepository } from "./db/repository.js";
import { registerTools } from "./tools/index.js";
import { setupErrorFormatting } from "./middleware/error-handler.js";
import {
  handleQueryDataSource,
  handleAddDatabaseRecord,
  handleUpdateDatabaseRecord
} from "./tools/handlers.js";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let rawDbPath = process.env.DB_PATH || path.join(__dirname, "..", "mcp_database.db");
if (rawDbPath !== ":memory:" && !path.isAbsolute(rawDbPath)) {
    rawDbPath = path.resolve(__dirname, "..", rawDbPath);
}

// Read-only is the DEFAULT, not an opt-in — see resolveReadOnly. This server is
// deployed as a public, unauthenticated endpoint, so an unset or misspelled variable
// must fail safe. The previous `=== "true"` form meant an absent variable ENABLED the
// mutation tools, leaving a blocklist in the Netlify proxy as the only thing refusing
// writes in production — which protects nothing on its own, because this URL is public
// and a caller can simply not use the proxy.
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
app.use(cors());
app.use(express.json());

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
app.post("/mcp", async (req: Request, res: Response) => {
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

// JSON-RPC 2.0 MCP Endpoint
//
// LEGACY. Predates the Streamable HTTP transport above and is not MCP-compliant:
// no initialize handshake, no capability negotiation, a hand-written tools/list.
// Retained because the slakedesign.com demo proxy posts to it directly; new
// clients should use /mcp. Both are served by the same tool implementations.
app.post("/api/mcp", async (req: Request, res: Response) => {
  const { jsonrpc, method, params, id } = req.body || {};

  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid Request: jsonrpc version must be '2.0'" },
      id: id || null
    });
  }

  // 1. tools/list
  //
  // The advertised surface must match what the server will actually honour. Listing
  // the mutation tools while READ_ONLY refuses them tells a calling agent it can write,
  // which is a contract lie: the agent plans around a capability that does not exist and
  // discovers it only at call time.
  if (method === "tools/list") {
    const readTools = [
      {
        name: "query_data_source",
        description: "Retrieves metrics records matching the specified category from SQLite database",
        inputSchema: {
          type: "object",
          properties: { category: { type: "string" } },
          required: ["category"]
        }
      }
    ];

    const writeTools = [
          {
            name: "add_database_record",
            description: "Adds a new record to the SQLite metrics database",
            inputSchema: {
              type: "object",
              properties: {
                category: { type: "string" },
                key_name: { type: "string" },
                status: { type: "string" },
                detail_one: { type: "string" },
                detail_two: { type: "string" }
              },
              required: ["category", "key_name", "status"]
            }
          },
          {
            name: "update_database_record",
            description: "Updates an existing record in the SQLite database by ID",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "number" },
                category: { type: "string" },
                key_name: { type: "string" },
                status: { type: "string" },
                detail_one: { type: "string" },
                detail_two: { type: "string" }
              },
              required: ["id"]
            }
          }
    ];

    return res.json({
      jsonrpc: "2.0",
      result: {
        tools: config.readOnly ? readTools : [...readTools, ...writeTools]
      },
      id
    });
  }

  // 2. tools/call
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};

    if (name === "query_data_source") {
      const result = await handleQueryDataSource(repo, args);
      return res.json({ jsonrpc: "2.0", result, id });
    }

    if (name === "add_database_record") {
      if (config.readOnly) {
        return res.json({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: "MCP_SECURITY_VIOLATION: Server is running in READ_ONLY mode. Write mutations disabled." }],
            isError: true
          },
          id
        });
      }
      const result = await handleAddDatabaseRecord(repo, args);
      return res.json({ jsonrpc: "2.0", result, id });
    }

    if (name === "update_database_record") {
      if (config.readOnly) {
        return res.json({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: "MCP_SECURITY_VIOLATION: Server is running in READ_ONLY mode. Write mutations disabled." }],
            isError: true
          },
          id
        });
      }
      const result = await handleUpdateDatabaseRecord(repo, args);
      return res.json({ jsonrpc: "2.0", result, id });
    }

    return res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32601, message: `Method not found: Unknown tool '${name}'` },
      id
    });
  }

  return res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32601, message: `Unsupported MCP method: '${method}'` },
    id: id || null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.error(`MCP Server listening on port ${PORT} (MCP: /mcp, legacy JSON-RPC: /api/mcp)`);
});

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

if (isMain && process.env.STDIO === "true") {
  runServer().catch((error) => {
    console.error("Fatal error starting stdio MCP server:", error);
  });
}

export { server, db, app };
