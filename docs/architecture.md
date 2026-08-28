# System Architecture

`mcp-sqlite-bridge` exposes a SQLite database to LLM agents through the Model
Context Protocol. This document describes how a tool call travels through the
system and where each guarantee is enforced.

## Layers

```
MCP client (Claude Desktop, Cursor, curl)
    |
    |  stdio pipes            OR    HTTP POST /mcp
    v                                v
StdioServerTransport          StreamableHTTPServerTransport
    |                                |  (per-request instance)
    +----------------+---------------+
                     v
              McpServer (SDK)
                     |
                     |  1. Zod validation of tool arguments
                     |  2. dispatch to a REGISTERED tool only
                     v
            src/tools/handlers.ts
                     |
                     |  3. handler-level readOnly re-check
                     v
        IMetricsRepository (src/db/repository.ts)
                     |
                     |  4. parameterized SQL only
                     v
                 SQLite
```

## Request lifecycle

1. **Transport.** `src/server.ts` selects exactly one transport. `STDIO=true`
   speaks over the process pipes and binds no port; otherwise an Express app
   serves `POST /mcp`. The two are mutually exclusive: binding a port under a
   stdio client is at best pointless and at worst fatal, because an
   `EADDRINUSE` exit produces only "Connection closed" on the client side.

2. **HTTP protections** (HTTP transport only). `src/middleware/http.security.ts`
   applies an explicit CORS allowlist, then a global rate limiter, then a per-IP
   limiter. Order matters: the global ceiling is evaluated first so that a
   distributed burst is capped in aggregate, not just per client.

3. **Per-request server construction.** `createMcpServer()` builds a fresh
   `McpServer` and transport for every HTTP request. The deployment is stateless
   (`sessionIdGenerator: undefined`), so sharing one transport across requests
   would land the second request on a transport that has already completed its
   lifecycle. The database and repository are shared; only the protocol layer is
   per-request, which is cheap.

4. **Tool registration.** `registerTools()` always registers `query_data_source`.
   It registers the two mutation tools **only** when `config.readOnly` is false.
   A read-only server therefore does not advertise them in `tools/list`, and a
   direct `tools/call` for one is rejected by the SDK dispatch layer with
   `MCP error -32602: Tool ... not found`.

5. **Argument validation.** The SDK parses arguments against the Zod shapes in
   `src/tools/schemas.ts` before the handler runs. `category` is a closed enum,
   so an arbitrary category is rejected at the boundary rather than reaching SQL.

6. **Handler guard.** Both mutation handlers re-check `config.readOnly` and
   refuse if set. This is redundant with step 4 by design — see
   [design_decisions.md](design_decisions.md).

7. **Persistence.** `SqliteMetricsRepository` binds every client value with `?`
   placeholders. The dynamic `UPDATE` builds its `SET` clause from a fixed
   column whitelist, so column names cannot be injected either.

8. **Error formatting.** `setupErrorFormatting()` intercepts the `tools/call`
   handler and rewrites raw Zod issue JSON into agent-readable strings
   (`Field 'category': expected one of ...`). Database driver errors are logged
   server-side and replaced with a stable client-facing message; internal
   messages never reach the model.

## Failure paths

| Failure | Where it is caught | What the caller sees |
|---|---|---|
| Unknown tool | SDK dispatch | `-32602 Tool ... not found` |
| Write attempted, read-only | Registration + handler guard | Tool absent, or explicit refusal |
| Invalid argument type/enum | Zod, pre-handler | `Input validation error: Field '...'` |
| Update with no fields | `handleUpdateDatabaseRecord` | Explicit "at least one field" error |
| Record not found | `updateRecord` returns 0 changes | `Record with ID n not found` |
| SQLite driver error | Handler catch | Stable message; detail logged only |
| Origin not allowed (browser) | `corsMiddleware` | Header omitted; `OPTIONS` gets 403 |
| Rate limit exceeded | `perIpLimiter` / `globalLimiter` | 429 with JSON body |
