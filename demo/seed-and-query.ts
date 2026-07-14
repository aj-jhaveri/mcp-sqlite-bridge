import { server } from "../server.js";

// Helper to call a tool and format the console log output
async function callTool(name: string, args: any) {
    const handler = (server.server as any)._requestHandlers.get("tools/call");
    if (!handler) {
        throw new Error("tools/call handler not found");
    }
    const response = await handler({
        method: "tools/call",
        params: {
            name,
            arguments: args
        }
    }, {
        signal: new AbortController().signal
    });
    return response;
}

async function runDemo() {
    console.log("=========================================");
    console.log("      MCP SQLite Bridge Standalone Demo   ");
    console.log("=========================================\n");

    // Wait a brief moment to let database initialize and seed
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 1. Initial Query
    console.log("--- Initial Query ---");
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
    console.log("--- Adding Record ---");
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
    console.log("--- Updating Record ---");
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
    console.log("--- Final Query ---");
    console.log("Querying 'headcount' category records again to confirm changes...\n");
    const finalQueryResult = await callTool("query_data_source", { category: "headcount" });
    if (finalQueryResult.isError) {
        console.error("Query Error:", finalQueryResult.content[0].text);
        process.exit(1);
    }
    console.log("Result:");
    console.log(finalQueryResult.content[0].text);
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
