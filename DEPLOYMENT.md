# Deployment

## Where it runs

| | |
|---|---|
| Host | Render (web service, Oregon, `starter` plan) |
| Service | `slake-mcp-server` — `srv-d9rnmv2fngtc73dqkspg` |
| URL | https://slake-mcp-server.onrender.com |
| Repo / branch | `aj-jhaveri/mcp-sqlite-bridge` — `main` |
| Auto-deploy | **on**, triggered per commit to `main` |
| Consumed by | `slakedesign.com/demo/mcp`, via the Netlify function `netlify/functions/mcp-demo.js`, which is a real MCP client speaking Streamable HTTP to `/mcp` |

## Build and start commands

```
Build:  npm install && npm run build
Start:  npm start
```

**This build command is fragile in one specific way, and it is worth knowing
before someone "tidies up" the environment.** `typescript` is a
`devDependency`. The command works only because `NODE_ENV` is *not* set to
`production` on this service — if it were, npm would set `omit=dev`, strip
`typescript`, and `tsc` would fail with dozens of missing-module errors.

The sibling `task-queue-system` and `slakedesign-rag` services both set
`NODE_ENV=production` and therefore use
`npm ci --include=dev && npm run build && npm prune --omit=dev`. If you ever add
`NODE_ENV=production` here, change the build command in the same action.

`postinstall` runs `npm rebuild sqlite3 --build-from-source`. `sqlite3` is a
native module built per Node major version, which is why `.nvmrc` and
`engines` both pin `22.12.0` and why the CI workflow reads the version from
`.nvmrc` rather than hardcoding it.

## Environment variables

| Variable | Required | Default | Notes |
|---|:---:|---|---|
| `READ_ONLY` | no | *(read-only)* | **Leave unset.** Read-only is the default and fails safe: any value except the exact string `"false"` resolves to read-only. This is the control that makes a public unauthenticated endpoint safe. Do **not** set `READ_ONLY=false` on a publicly reachable instance. |
| `PORT` | no | `3000` | Set by Render. |
| `DB_PATH` | no | `<repo>/mcp_database.db` | Ephemeral on Render — writes do not survive a restart. |
| `CORS_ALLOWED_ORIGINS` | no | `https://slakedesign.com,https://www.slakedesign.com` | Comma-separated allowlist. A `*` entry is discarded rather than honoured. |
| `STDIO` | no | unset | `"true"` switches to the stdio transport and binds no port. Never set on the HTTP deployment. |
| `LOG_LEVEL` | no | `info` | |
| `NODE_ENV` | no | unset | See the build-command warning above. |

## Deploying

Auto-deploy handles the normal case. Manually:

```bash
render deploys create srv-d9rnmv2fngtc73dqkspg --confirm --wait
```

Render runs the old and new instances briefly during a swap, so verify with a
signal only the new build emits rather than trusting the deploy status.

## Rollback

1. **Redeploy the last good version** — Render's dashboard lists prior deploys
   with a rollback action; `render deploys create <srv-id> --commit <sha>`.
2. **Revert the commit** — `git revert -m 1 <merge-sha>`, push, let auto-deploy
   carry it.
3. **Last resort** — disable the demo link on `slakedesign.com/demo`.

A failed build is self-rollbacking: Render keeps the previous version live and
never routes traffic to a build that did not start.

## Known behavioural changes

Introduced by the P3/P4 work deployed 2026-08-28:

- **Mutation handlers refuse independently of registration.** Read-only was
  previously enforced only by not registering the write tools. Both handlers
  now re-check `config.readOnly` before argument validation.
- **Internal database error text is no longer returned to callers.** Driver
  messages are logged server-side; the tool response carries a stable, agent-
  readable message instead. `SQLITE_CANTOPEN` and filesystem paths were
  previously reachable by any anonymous caller.
- **Logs are structured JSON (Pino) on stderr.** Pinning to
  `pino.destination(2)` is a correctness requirement, not a preference: under
  the stdio transport an MCP client owns stdout, and a stray log line corrupts
  the JSON-RPC stream. `tests/logging.stdio.test.ts` guards this.
- **Responses carry `x-correlation-id`**, accepted from the request or
  generated per request.
- **Importing `src/server.ts` no longer binds a port.** The listener is gated
  on the entrypoint check, so the demo and tests can import the module. The
  deployed service is unaffected — it runs the file as the process entrypoint.

## Smoke test after deploy

```bash
# 1. Health, and confirmation that new code is serving
curl -sD - https://slake-mcp-server.onrender.com/health | grep -iE 'x-correlation-id|readOnly'

# 2. Protocol handshake over Streamable HTTP
curl -s -X POST https://slake-mcp-server.onrender.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'

# 3. Through the live site: only the read tool must be advertised
curl -s -X POST https://slakedesign.com/api/mcp-demo \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expect exactly `["query_data_source"]` from step 3. If `add_database_record` or
`update_database_record` appears, the service is running with `READ_ONLY=false`
and should be corrected immediately.

Then confirm the page runs its full sequence: https://slakedesign.com/demo/mcp
