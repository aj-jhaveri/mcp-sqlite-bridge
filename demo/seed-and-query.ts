import { server, db } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * A clean, type-safe mock transport that facilitates in-memory process piping
 * for strict black-box client/server communication testing in the demo.
 */
class InMemoryMockTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    constructor(public other?: InMemoryMockTransport) {}

    async start(): Promise<void> {}
    async close(): Promise<void> {
        this.onclose?.();
    }
    async send(message: JSONRPCMessage): Promise<void> {
        setTimeout(() => this.other?.onmessage?.(message), 0);
    }
}

// Global references for client/transport pairing
let client: Client;

async function bootstrapClient() {
    const serverTransport = new InMemoryMockTransport();
    const clientTransport = new InMemoryMockTransport();
    serverTransport.other = clientTransport;
    clientTransport.other = serverTransport;

    await server.connect(serverTransport);

    client = new Client(
        { name: "demo-client", version: "1.0.0" },
        { capabilities: {} }
    );
    await client.connect(clientTransport);
}

// Helper to call a tool and format the console log output
async function callTool(name: string, args: any) {
    const res = await client.callTool({
        name,
        arguments: args
    });
    return {
        content: res.content,
        isError: res.isError ? true : undefined
    };
}

async function runDemo() {
    console.log("=========================================");
    console.log("      MCP SQLite Bridge Standalone Demo   ");
    console.log("=========================================\n");

    // Initialize mock transport client pairing
    await bootstrapClient();

    // 1. Initial Query
    console.log("--- 1. Initial Query ---");
    console.log("Querying 'headcount' category records...\n");
    const initQueryResult = await callTool("query_data_source", { category: "headcount" });
    if (initQueryResult.isError) {
        console.error("Query Error:", initQueryResult.content[0].text);
        process.exit(1);
    }
    console.log("Result:");
    console.log(initQueryResult.content[0].text);
    console.log("\n");

    // 2. Adding Record
    console.log("--- 2. Adding Record ---");
    console.log("Adding a new headcount record for 'Frontend Developer (React)'...\n");
    const addResult = await callTool("add_database_record", {
        category: "headcount",
        key_name: "Frontend Developer (React)",
        status: "Sourcing",
        detail_one: "1 Allocation",
        detail_two: "ENG-2026-Q4"
    });
    if (addResult.isError) {
        console.error("Add Error:", addResult.content[0].text);
        process.exit(1);
    }
    console.log("Result:");
    console.log(addResult.content[0].text);
    console.log("\n");

    // Extract row ID from response
    const match = addResult.content[0].text.match(/Row ID: (\d+)/);
    if (!match) {
        console.error("Failed to parse row ID from response.");
        process.exit(1);
    }
    const insertedId = parseInt(match[1], 10);

    // 3. Updating Record
    console.log("--- 3. Updating Record ---");
    console.log(`Updating headcount record ID ${insertedId} status to 'Offer Extended'...\n`);
    const updateResult = await callTool("update_database_record", {
        id: insertedId,
        status: "Offer Extended"
    });
    if (updateResult.isError) {
        console.error("Update Error:", updateResult.content[0].text);
        process.exit(1);
    }
    console.log("Result:");
    console.log(updateResult.content[0].text);
    console.log("\n");

    // 4. Final Query
    console.log("--- 4. Final Query ---");
    console.log("Querying 'headcount' category records again to confirm changes...\n");
    const finalQueryResult = await callTool("query_data_source", { category: "headcount" });
    if (finalQueryResult.isError) {
        console.error("Query Error:", finalQueryResult.content[0].text);
        process.exit(1);
    }
    console.log("Result:");
    console.log(finalQueryResult.content[0].text);
    console.log("\n");

    // 5. Clean Up (Prevent database contamination)
    console.log("--- 5. Clean Up ---");
    console.log(`Removing temporary headcount record ID ${insertedId}...\n`);
    await new Promise<void>((resolve) => {
        db.run("DELETE FROM metrics_and_data WHERE id = ?", [insertedId], (err) => {
            if (err) {
                console.error("Cleanup failed:", err.message);
            } else {
                console.log("Result:");
                console.log("Database cleaned up successfully. No leftover test records.");
            }
            resolve();
        });
    });
    console.log("\n");

    console.log("=========================================");
    console.log("      Demo Completed Successfully!       ");
    console.log("=========================================");
    
    // Explicitly exit process to close database connections
    process.exit(0);
}

runDemo().catch((error) => {
    console.error("Fatal demo error:", error);
    process.exit(1);
});
