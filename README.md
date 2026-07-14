# Agentic SQLite Data Bridge (MCP Server)

A custom Model Context Protocol (MCP) server built with Node.js and TypeScript, designed to give local LLM agents direct, secure, and structured read/write access to a local SQLite database.

## Architecture Overview
This server acts as a bridge between foundational models (like Claude 3.5 Sonnet) and local system environments. Instead of relying on static context windows, this implementation allows an AI agent to dynamically execute semantic reasoning, formulate SQL queries via predefined Zod schemas, and autonomously read from or mutate database records in real-time.

As the primary technical owner of this implementation, I designed the architecture to demonstrate:
* **Agentic Tool Execution:** Exposing robust, declarative tools that allow LLMs to perform multi-step data retrieval and synthesis.
* **Type-Safe Data Contracts:** Utilizing Zod for strict runtime validation of AI-generated arguments before they hit the database.
* **Local Data Sovereignty:** Running entirely over `StdioServerTransport`, keeping all data execution local, private, and secure.

## Features
* **`query_data_source`**: Allows the agent to fetch structured datasets dynamically.
* **`add_database_record`**: Grants the agent mutation capabilities to insert new rows into the SQLite instance based on natural language logic.
* Auto-initialization and seeding of the SQLite database upon first connection.

## Tech Stack
* **Language:** TypeScript / Node.js
* **Protocol:** Model Context Protocol (MCP) SDK
* **Database:** SQLite3
* **Validation:** Zod

## Local Setup & Installation

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Configure Claude Desktop
To grant Claude access to this server, update your `claude_desktop_config.json` file to include this tool integration. 

*(Note: Ensure you provide the absolute path to your local project directory).*

\`\`\`json
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
\`\`\`

### 3. Initialize the Database
The SQLite database (`mcp_database.db`) is completely ignored by version control. Upon the first successful connection from the Claude Desktop client, the server will automatically generate the database file and seed it with initial structured metrics.