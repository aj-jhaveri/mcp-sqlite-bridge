import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
    name: "mcp-server",
    version: "1.0.0",
});

server.tool(
    "query_data_source",
    {
        category: z.string().describe("The data domain to search: internal_metrics, headcount, or engineering_delivery"),
        limit: z.number().optional().describe("Maximum number of records to return"),
    },
    async ({ category, limit }) => {
        const recordLimit = limit ?? 5;

        console.error(`Log: Executing data retrieval for domain: ${category}`);

        const mockData: Record<string, any[]> = {
            internal_metrics: [
                { metric: "API Response Latency", status: "Optimized", target: "Under 8s", current: "7.4s" },
                { metric: "Token Throughput", status: "Stable", efficiency: "94%" }
            ],
            headcount: [
                { role: "Full Stack Software Engineer", open_allocations: 2, status: "Sourcing", budget_code: "ENG-2026-Q3" },
                { role: "Frontend Developer", open_allocations: 1, status: "Interviewing" }
            ],
            engineering_delivery: [
                { project: "RAG Pipeline Ingestion", phase: "Validation", deployment: "Production Ready" },
                { project: "Graph Search Integration", phase: "Discovery", target: "Q4 2026" }
            ]
        };

        const results = mockData[category] || [{ error: "Unknown data category requested" }];
        const slicedResults = results.slice(0, recordLimit);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(slicedResults, null, 2),
                },
            ],
        };
    }
);

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running on Stdio");
}

runServer().catch((error) => {
    console.error("Fatal error starting the MCP server:", error);
    process.exit(1);
});