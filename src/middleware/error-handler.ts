import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpToolResponse } from "../types/database.js";

interface ZodIssue {
    code: string;
    expected?: string;
    received?: string;
    path: (string | number)[];
    message: string;
}

/**
 * Decorates the MCP SDK's public setRequestHandler method to intercept the
 * 'tools/call' handler registration. This catches and reformats Zod schema validation
 * errors into clean, agent-friendly feedback strings without exposing private SDK internals.
 */
export function setupErrorFormatting(server: McpServer): void {
    const originalSetRequestHandler = server.server.setRequestHandler.bind(server.server);

    // Override the public setRequestHandler method on the internal Server instance
    server.server.setRequestHandler = (schema: any, handler: any) => {
        if (schema === CallToolRequestSchema) {
            // Wrap the tools/call handler to post-process validation errors
            const wrappedHandler = async (request: any, extra: any) => {
                const result = (await handler(request, extra)) as McpToolResponse;

                if (
                    result &&
                    result.isError &&
                    result.content &&
                    result.content[0] &&
                    result.content[0].text
                ) {
                    const text = result.content[0].text;

                    // Match Zod schema output within the SDK's generated error string
                    const match = text.match(
                        /^(?:MCP error [-\d]+: )?(Input validation error: Invalid arguments for tool [^:]+: )([\s\S]+)$/
                    );

                    if (match) {
                        const rawJson = match[2];
                        try {
                            const issues = JSON.parse(rawJson) as ZodIssue[];
                            if (Array.isArray(issues)) {
                                const formatted = issues
                                    .map((issue) => {
                                        const pathStr = issue.path.join(".");
                                        const cleanMsg = issue.message.replace(/^Invalid input:\s*/i, "");
                                        if (cleanMsg.toLowerCase() === "required") {
                                            return `Field '${pathStr}' is required`;
                                        }
                                        return `Field '${pathStr}': ${cleanMsg}`;
                                    })
                                    .join("; ");

                                result.content[0].text = `Input validation error: ${formatted}`;
                            }
                        } catch (e) {
                            // Fallback gracefully to original SDK error if JSON parsing fails
                        }
                    }
                }
                return result;
            };

            return originalSetRequestHandler(schema, wrappedHandler);
        }

        return originalSetRequestHandler(schema, handler);
    };
}
