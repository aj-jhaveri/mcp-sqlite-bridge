import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolResponse } from "../types/database.js";

interface ZodIssue {
    code: string;
    expected?: string;
    received?: string;
    path: (string | number)[];
    message: string;
}

// SDK request handlers are async functions that take a request payload and context
type SdkRequestHandler = (request: any, extra: any) => Promise<McpToolResponse>;

/**
 * Intercepts the MCP SDK's internal tools/call handler to sanitize and reformat Zod validation errors.
 * Instead of exposing a raw Zod JSON issue list, it translates validation errors into actionable,
 * developer/agent-readable strings like: "Input validation error: Field 'status' is required".
 * 
 * NOTE: This relies on undocumented SDK internals (serverInstance._requestHandlers). If the MCP SDK is 
 * upgraded, this interceptor may fail silently or logs a warning if the internal map layout changes.
 */
export function setupErrorFormatting(server: McpServer): void {
    // Access the low-level server instance inside the McpServer wrapper
    const serverInstance = server.server as unknown as {
        _requestHandlers?: Map<string, SdkRequestHandler>;
    };

    if (!serverInstance || !serverInstance._requestHandlers) {
        console.error(
            "Warning: error-formatting wrapper could not attach because server._requestHandlers was not found. Raw Zod errors will be returned."
        );
        return;
    }

    const originalCallToolHandler = serverInstance._requestHandlers.get("tools/call");

    if (originalCallToolHandler) {
        serverInstance._requestHandlers.set("tools/call", async (request, extra) => {
            const result = await originalCallToolHandler(request, extra);

            // If the execution returned a validation/parsing error, format it
            if (
                result &&
                result.isError &&
                result.content &&
                result.content[0] &&
                result.content[0].text
            ) {
                const text = result.content[0].text;

                // Match both:
                // - SDK format: "Input validation error: Invalid arguments for tool <name>: <JSON_STRING>"
                // - Raw Zod error containing json string
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
                        // If json parsing fails, fallback gracefully to the original SDK error message
                    }
                }
            }
            return result;
        });
    } else {
        console.error(
            "Warning: error-formatting wrapper could not attach because 'tools/call' request handler was not registered. Raw Zod errors will be returned."
        );
    }
}
