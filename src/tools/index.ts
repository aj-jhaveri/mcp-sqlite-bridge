import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMetricsRepository } from "../db/repository.js";
import { ServerConfig } from "../types/database.js";
import {
    QueryDataSourceSchema,
    AddDatabaseRecordSchema,
    UpdateDatabaseRecordSchema,
} from "./schemas.js";
import {
    handleQueryDataSource,
    handleAddDatabaseRecord,
    handleUpdateDatabaseRecord,
} from "./handlers.js";

/**
 * Registers MCP tools with the server using injected Repository instances.
 * Dynamically registers mutating endpoints based on read-only configurations.
 */
export function registerTools(
    server: McpServer,
    repo: IMetricsRepository,
    config: ServerConfig
): void {
    // 1. Expose the Read (Query) Tool unconditionally
    server.tool(
        "query_data_source",
        QueryDataSourceSchema,
        async (args) => {
            return handleQueryDataSource(repo, args);
        }
    );

    // 2. Expose Mutating Tools conditionally based on READ_ONLY setting
    if (!config.readOnly) {
        server.tool(
            "add_database_record",
            AddDatabaseRecordSchema,
            async (args) => {
                return handleAddDatabaseRecord(repo, args);
            }
        );

        server.tool(
            "update_database_record",
            UpdateDatabaseRecordSchema,
            async (args) => {
                return handleUpdateDatabaseRecord(repo, args);
            }
        );
    } else {
        console.error("Log: Running in READ_ONLY mode. Mutation tools (add, update) are disabled.");
    }
}
