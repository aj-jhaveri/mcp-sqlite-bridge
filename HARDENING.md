# Hardening Log

This repository was audited, found to have real defects, and remediated. This
file records what was wrong and what changed, because a repository whose
entire premise is that its guardrails are real should be able to show where
they were not.

---

## The worst defect was in the README

`README.md` claimed that calls to disabled mutation tools "return an explicit
security payload (`MCP_SECURITY_VIOLATION`)".

That string existed nowhere in the codebase. The real behaviour, observed by
running the demo against a read-only server, is the SDK's generic dispatch
error:

```
MCP error -32602: Tool add_database_record not found
```

The actual behaviour is arguably *better* than the invented one (the tool does
not exist on a read-only server rather than existing and refusing), which is
what makes the fabrication so pointless. A security claim the code does not
implement is worse than no claim: it invites a reader to trust the rest of the
document, and every other guarantee in that section was true.

The README now states what happens, names the file and function that enforce it,
and points at the tests that would fail if it stopped being true.

**Also fixed:** two links to `docs/architecture.md` and
`docs/design_decisions.md` in a repository with no `docs/` directory. Both
files were written rather than the links deleted: the repository claims its
guardrails are deliberate, and that is only checkable if the reasoning is
written down.

---

## `npm run demo` had been broken

The demo imported the shared server instance (which resolves `READ_ONLY` at
module load and therefore starts read-only) then called `add_database_record`
on it. It died at step 2 of 5.

That failure is also the observation that disproved the security claim above:
running the demo is what produced the `-32602 Tool not found` response.

Prefixing `READ_ONLY=false` onto the npm script would have hidden the problem
rather than fixed it, and would have made the demo's write posture invisible at
the point where writes happen. Instead `createMcpServer()` is exported and
accepts a config override, so the demo constructs a writable server explicitly.
The deployed default is untouched.

**Related:** importing `src/server.ts` used to call `app.listen()`
unconditionally, so loading the module (from the demo, or a test) bound TCP
port 3000 as a side effect. Binding a port is a side effect of *running* the
server, not of loading it. The listener is now gated on the same `isMain`
entrypoint check that already guarded the stdio transport.

---

## Read-only was enforced in exactly one place

Write access was gated solely by `registerTools()` declining to register the
mutation tools. That is correct for the current dispatch model, and the existing
tests proved it worked.

It was also a single point of failure. One `server.tool(...)` placed outside
the `if (!config.readOnly)` block (a plausible edit for anyone adding a tool a
year from now), and writes are live with nothing else standing in the way.

Both mutation handlers now re-check `config.readOnly` and refuse, **before**
argument validation so the guard cannot be reordered out of effect. The tests
for it deliberately bypass registration and call the handlers directly, the way
a mis-registered tool would reach them.

---

## Internal error text was reaching the model

All three handlers interpolated `err.message` into the tool response. The
consumer of that string is an LLM, and SQLite errors can echo schema details
and filesystem paths, `SQLITE_CANTOPEN: unable to open database file /srv/...`
was reachable by any anonymous caller of a public unauthenticated endpoint.

Driver text is now logged server-side only. The replacements are written for an
agent deciding what to do next rather than a human reading a stack trace: "No
record was created. Do not retry with identical arguments" is more actionable
than the raw driver string ever was. A test asserts the refusal to leak did not
degrade into an opaque error.

---

## Security middleware with no tests

`src/middleware/http.security.ts` (the CORS allowlist and both rate limiters)
was imported by exactly one file and asserted on by none. It is the only thing
bounding cost on an unauthenticated public endpoint, which makes it exactly
the code that should not be taken on trust.

It now has 14 tests covering lookalike origins
(`slakedesign.com.evil.example`, `http://` downgrade), preflight 403 vs 204,
no-`Origin` passthrough, `Vary: Origin`, wildcard rejection in
`parseAllowedOrigins`, the 60/minute ceiling with its documented JSON body,
and draft-7 headers. They mount the middleware on a bare Express app (no MCP
server, no SQLite), so they test the middleware rather than the system around
it.

---

## Logging that could have broken every stdio client

The server logged via 27 `console.error` calls prefixed `"Log:"`, no levels,
no structure, no correlation.

Those calls were *accidentally* correct in one important way. Under the stdio
transport an MCP client owns this process's **stdout**: that stream is the
JSON-RPC message channel. A single stray log line corrupts it, and the client
reports only "Connection closed", identical to every other startup failure,
which makes the real cause invisible.

The Pino instance is pinned to `pino.destination(2)`, making deliberate what
was previously luck. `tests/logging.stdio.test.ts` spawns the built server,
drives a real handshake, and asserts every line on stdout parses as JSON-RPC,
then asserts the logs *did* appear, on stderr. It was verified to fail when
the destination is switched to stdout.

`src/client/mcp-client.ts` is deliberately left on `console.log`: it is a
human-facing CLI demo whose output is its product.

---

## What is still demo-grade, deliberately

- **No authentication on the HTTP transport.** By design, any MCP client must
  be able to connect. This is safe *only* because of the read-only default. Do
  not set `READ_ONLY=false` on a publicly reachable instance.
- **Seeded fixture data** about a fictional company, not a production dataset.
- **Ephemeral storage.** Writes made with `READ_ONLY=false` do not survive a
  restart.
- **No query timeouts or connection pooling.** A single local SQLite file with a
  bounded fixture dataset does not need them; a real deployment would.
- **`src/middleware/error-handler.ts` monkey-patches an SDK method** to reformat
  Zod errors into agent-readable strings. It is isolated and commented, but it
  reaches into `server.server` and could break on an SDK upgrade.

---

## Production rollout

Deployed 2026-08-28 by auto-deploy on merge to `main`. See
[DEPLOYMENT.md](DEPLOYMENT.md) for the runbook.

**What shipped:** the handler-level read-only guard, the error-leakage fix, the
repaired demo, and structured logging on stderr with correlation IDs.

**The deploy was clean**; no failed builds, no rollback. Verified against the
live service and through the Netlify proxy the demo page actually uses:
`/health` returns `readOnly: true` and carries `x-correlation-id`; the
Streamable HTTP handshake completes; `tools/list` advertises exactly
`["query_data_source"]` with neither mutation tool present.

**One latent fragility was found while writing the runbook, and has since been
fixed.** The build command was `npm install && npm run build` with no
`--include=dev`, and `typescript` is a `devDependency`. It worked only because
`NODE_ENV` was not set to `production` on this service, setting that variable,
an entirely reasonable operator action, would have broken the build. It was
documented rather than changed at the time, on the grounds that a rollout is
the wrong moment to alter a working build command.

That was the right call for that moment and the wrong state to leave behind. It
was fixed on 2026-08-29, verified in a clean clone first:

```
$ NODE_ENV=production npm install && npm run build
sh: tsc: command not found          # the fragility, reproduced

$ NODE_ENV=production npm ci --include=dev && npm run build && npm prune --omit=dev
                                    # OK; dist/ produced, sqlite3 and pino kept,
                                    # typescript removed
```

The pruned production tree was then started and exercised before the config was
touched: `/health` returned `readOnly: true`, the Streamable HTTP handshake
completed, and logs were structured Pino on stderr.

**A correction worth recording, because it nearly caused a wrong fix.** The
first local attempt at `npm ci` failed with `Missing: @emnapi/runtime from
lock file`, which looked like a defective committed lockfile, and regenerating
it locally did make the error go away. That would have been the wrong change.
MCP's CI runs `npm ci` on Linux with `npm@11.6.2` and passes consistently, so
the lockfile is correct for the platform that matters; the failure was a
macOS-ARM resolution artifact. Committing a macOS-regenerated lockfile would
have risked breaking Linux CI to fix a problem that only existed on a laptop.
The actual fix was the npm pin the CI workflow already used.

**Measured benefit beyond the fragility:** the prune strips build-only
dependencies from the running image, 278 packages after install, 197 after
prune on the 2026-08-29 deploy.

**What to monitor.** `tools/list` must never advertise a mutation tool; that
is the single check that proves the read-only posture is intact end to end,
and it is cheap enough to run on a schedule. Beyond that, the rate limiters
(60/min per IP, 300/min global) bound cost on an unauthenticated endpoint; a
sustained 429 rate is the signal that someone is looping the endpoint.

---

## Method

Every fix was preceded by a guard that was **run against the unfixed code and
watched to fail**. A check that cannot fail is not evidence. The stdout-purity
test was verified by pointing the logger at stdout; the demo fix was verified by
running the demo end to end, not by reasoning about it.
