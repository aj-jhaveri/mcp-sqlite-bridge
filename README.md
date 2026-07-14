# Agentic SQLite Data Bridge (MCP Server)

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/node.js-%3E%3D18-green.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

A Model Context Protocol (MCP) server built in TypeScript and Node.js that enables LLM agents (such as Claude 3.5 Sonnet) to perform secure, type-safe, and real-time read/write operations against a local SQLite database. By bridging foundation models directly to local system environments, this server empowers agents to autonomously execute semantic reasoning, validate query boundaries, and perform CRUD mutations dynamically over a standard stdio transport.

---

## Quick Demo

Run the standalone demo in 30 seconds to witness the complete tool-calling lifecycle (Read, Create, Update) without having to open Claude Desktop:

```bash
npm install
npm run demo
```

### Expected Output
```text
=========================================
      MCP SQLite Bridge Standalone Demo   
=========================================

--- Initial Query ---
Querying 'headcount' category records...

Log: Executing SQL query for category: headcount
Result:
[
  {
    "key_name": "Full Stack Software Engineer",
    "status": "Sourcing",
    "detail_one": "2 Allocations",
    "detail_two": "ENG-2026-Q3"
  },
  {
    "key_name": "Frontend Developer",
    "status": "Interviewing",
    "detail_one": "1 Allocation",
    "detail_two": null
  }
]


--- Adding Record ---
Adding a new headcount record for 'Frontend Developer (React)'...

Log: Writing new record to database...
Result:
Successfully inserted record. Row ID: 12


--- Updating Record ---
Updating headcount record ID 12 status to 'Offer Extended'...

Log: Updating record ID 12 in database...
Result:
Successfully updated record with ID: 12. Rows affected: 1


--- Final Query ---
Querying 'headcount' category records again to confirm changes...

Log: Executing SQL query for category: headcount
Result:
[
  {
    "key_name": "Full Stack Software Engineer",
    "status": "Sourcing",
    "detail_one": "2 Allocations",
    "detail_two": "ENG-2026-Q3"
  },
  {
    "key_name": "Frontend Developer",
    "status": "Interviewing",
    "detail_one": "1 Allocation",
    "detail_two": null
  },
  {
    "key_name": "Frontend Developer (React)",
    "status": "Offer Extended",
    "detail_one": "1 Allocation",
    "detail_two": "ENG-2026-Q4"
  }
]


=========================================
      Demo Completed Successfully!       
=========================================
```

---

## Architecture Overview

This server functions as a local coordinator between foundational model sessions and a private SQLite file. Rather than relying on rigid, context-heavy prompt engineering or static file dumps, the server exposes discrete, declarative tools defined using TypeScript and Zod schemas. 

* **Agentic Tool Execution:** Provides the agent with precise, granular capabilities for data retrieval and modification.
* **Type-Safe Data Contracts:** Zod is used for runtime validation of model-generated arguments before they interact with SQLite. A global interceptor sanitizes Zod error responses, translating raw JSON validation objects into readable strings that help agents self-correct.
* **Local Data Sovereignty:** Operates locally using `StdioServerTransport` to prevent data leakage and keep operations private.

---

## Tool Reference

### 1. `query_data_source`
Queries database records matching a specific domain category.

#### Zod Schema
```typescript
z.object({
  category: z.string().describe("The data domain to search: internal_metrics, headcount, or engineering_delivery"),
})
```

#### Example Call
```json
{
  "name": "query_data_source",
  "arguments": {
    "category": "headcount"
  }
}
```

#### Example Response
```json
[
  {
    "key_name": "Full Stack Software Engineer",
    "status": "Sourcing",
    "detail_one": "2 Allocations",
    "detail_two": "ENG-2026-Q3"
  }
]
```

---

### 2. `add_database_record`
Inserts a new record into the database.

#### Zod Schema
```typescript
z.object({
  category: z.string().describe("The domain category: internal_metrics, headcount, or engineering_delivery"),
  key_name: z.string().describe("The primary name of the metric, project, or job title"),
  status: z.string().describe("The current status (e.g. Sourcing, In Progress, Stable)"),
  detail_one: z.string().optional().describe("Additional descriptive detail"),
  detail_two: z.string().optional().describe("A second optional detail"),
})
```

#### Example Call
```json
{
  "name": "add_database_record",
  "arguments": {
    "category": "headcount",
    "key_name": "Frontend Developer (React)",
    "status": "Open",
    "detail_one": "1 Allocation",
    "detail_two": "ENG-2026-Q4"
  }
}
```

#### Example Response
```text
Successfully inserted record. Row ID: 12
```

---

### 3. `update_database_record`
Mutates an existing record in the database by its ID. Supports partial updates of all table fields.

#### Zod Schema
```typescript
z.object({
  id: z.number().int().describe("The ID of the record to update"),
  category: z.string().optional().describe("The new domain category (e.g. internal_metrics, headcount, or engineering_delivery)"),
  key_name: z.string().optional().describe("The new primary name of the metric, project, or job title"),
  status: z.string().optional().describe("The new status value"),
  detail_one: z.string().optional().describe("Additional descriptive detail (use null or empty string to clear)"),
  detail_two: z.string().optional().describe("A second optional detail (use null or empty string to clear)"),
})
```

#### Example Call
```json
{
  "name": "update_database_record",
  "arguments": {
    "id": 12,
    "status": "Interviewing"
  }
}
```

#### Example Response
```text
Successfully updated record with ID: 12. Rows affected: 1
```

---

## Setup & Claude Desktop Integration

### 1. Configure Environment
Create a `.env` file based on `.env.example` to point to your SQLite file:
```bash
cp .env.example .env
```

### 2. Configure Claude Desktop
Add this server configuration to your `claude_desktop_config.json` (typically located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

*(Note: Use absolute paths to `npx` and your project directory).*

```json
{
  "mcpServers": {
    "slake-data-tools": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/mcp-server/server.ts"
      ]
    }
  }
}
```

### 3. Database Initialization
The SQLite database (`mcp_database.db`) is ignored by version control. When the MCP server starts up for the first time, it automatically verifies folder write accessibility, initializes the database file, and seeds it with default records.

---

## Running Tests

Run the full Vitest suite (validating schemas, database queries, record insertions, partial updates, no-ops, and database failures):

```bash
npm test
```

---

## Known Limitations

This project is built as a lightweight, developer-focused tooling interface. The following boundaries are intentional design choices rather than oversights:
* **Local Database Only:** The server communicates directly with a single local SQLite file and is not designed for distributed network databases.
* **No Concurrent Write Locking:** It relies on SQLite's default concurrency behavior (e.g. locks during active write operations) and is optimized for personal, single-client use.
* **No Authentication Layer:** Security is maintained by keeping execution strictly bound to local stdio transports on the host machine.