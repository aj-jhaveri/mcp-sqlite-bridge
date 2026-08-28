# Design Decisions & Engineering Tradeoffs

Each entry states the decision, the alternative that was rejected, and the
reason. Where a decision is enforced by a test, the test is named.

---

### 1. Read-only is the default, and the default is a pure function

**Decision.** `resolveReadOnly(value)` returns `true` unless the value is
exactly the string `"false"`. Unset, empty, `"true"`, `"False"`, or a typo all
resolve to read-only.

**Rejected.** The conventional `READ_ONLY !== 'true'` or a boolean coercion.

**Why.** This server is deployed as a public, unauthenticated endpoint. The
failure mode that matters is not "someone sets the wrong value" — it is "the
variable is missing from the deploy config and nobody notices". Under a
coercion-based default, a missing variable unlocks the database. Here it
locks it. The resolution is a pure function precisely so the *default itself*
is testable, not merely the gating that depends on it.

**Enforced by.** `tests/read-only-default.test.ts`.

---

### 2. Write access is enforced twice, deliberately

**Decision.** Mutation tools are not registered when `readOnly` is true, **and**
both mutation handlers re-check `config.readOnly` and refuse.

**Rejected.** Non-registration alone, which is sufficient for the current
dispatch model.

**Why.** Non-registration is a single point of failure. One accidental
`server.tool(...)` placed outside the `if (!config.readOnly)` block — a
plausible edit for someone adding a tool a year from now — makes writes live
with no other guard in the system. The handler check costs four lines and
converts "the gate is correct" into "the gate and the door are both locked".
This is the difference between a guardrail that is claimed and one that holds
under an unrelated future refactor.

**Enforced by.** `tests/security.test.ts` (registration gate) and the
handler-guard cases in the same file (refusal when invoked directly).

---

### 3. The HTTP transport is stateless, with a server per request

**Decision.** `sessionIdGenerator: undefined`, `enableJsonResponse: true`, and a
fresh `McpServer` + transport per `POST /mcp`.

**Rejected.** A single long-lived server and transport shared across requests.

**Why.** The deploy target is a single instance on an ephemeral filesystem:
there is nowhere to keep session state and nothing that needs it. Sharing one
transport is the *stateful* pattern — without a session to scope them, the
second request lands on a transport whose lifecycle has already completed and
the handler fails with a 500. Per-request construction is what makes
statelessness correct. The database and repository are shared, so the cost is
the protocol object only.

**Enforced by.** `tests/mcp-protocol.test.ts` — consecutive stateless requests
over Streamable HTTP.

---

### 4. Rate limiting is two-tier, and the global tier is checked first

**Decision.** 60 requests/minute per IP, 300/minute globally, global evaluated
before per-IP.

**Why.** Read-only means a caller cannot *change* anything. It does not mean a
caller cannot *cost* anything: every `tools/call` reaches SQLite, and the
endpoint is unauthenticated by design so that any MCP client can connect. Cost,
not mutation, is what these bound. Per-IP limits answer one flooder; they do
nothing about many addresses each staying politely under the individual cap.
The global bucket is the ceiling on total cost regardless of source.

---

### 5. CORS omits the header rather than rejecting the request

**Decision.** A disallowed `Origin` on a non-`OPTIONS` request passes through
without an `Access-Control-Allow-Origin` header. A disallowed `OPTIONS`
preflight gets a 403. A missing `Origin` passes untouched.

**Why.** CORS is enforced by the browser and is not a substitute for
authentication. Blocking the request server-side would break every non-browser
MCP client — curl, uptime monitors, Claude Desktop — none of which send an
`Origin` at all. Omitting the header stops an arbitrary web page from driving
this server using a visitor's browser, which is the only threat CORS actually
addresses.

---

### 6. A repository interface sits between handlers and SQLite

**Decision.** Handlers depend on `IMetricsRepository`, not on `sqlite3`.

**Why.** It keeps the driver's callback style out of the tool layer, makes the
handlers unit-testable against a fake, and means the parameterization guarantee
lives in exactly one file that can be audited on its own.

---

### 7. Internal error messages are not returned to the model

**Decision.** Driver errors are logged server-side; the caller receives a
stable, actionable message.

**Rejected.** Interpolating `err.message` into the tool response, which is what
this repo did until P3.

**Why.** The consumer of a tool error is an LLM, and SQLite error strings can
echo schema details and filesystem paths. The replacement messages are written
for the agent — "No record was created" tells a model not to retry blindly,
which the raw driver string never did.

---

### 8. What is demo-shaped, stated plainly

- **Data.** The SQLite corpus is seeded fixture data about a fictional company.
  It is not a production dataset.
- **No authentication.** The HTTP endpoint is unauthenticated by design so any
  MCP client can connect. This is safe *only* because of the read-only default;
  do not set `READ_ONLY=false` on a publicly reachable instance.
- **Ephemeral storage.** The deploy target has an ephemeral filesystem, so
  writes made with `READ_ONLY=false` do not survive a restart.
- **No connection pooling or query timeouts.** A single local SQLite file with
  a bounded fixture dataset does not need them; a real deployment would.
