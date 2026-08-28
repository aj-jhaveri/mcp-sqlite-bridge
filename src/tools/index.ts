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
import { logger } from "../logging/logger.js";

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
        "Retrieve metrics records from the SQLite database, filtered by category. " +
        "Call this whenever the question concerns engineering delivery status, headcount, " +
        "or internal operational metrics — it is the only way to read this data, and " +
        "answering from memory will be wrong. Returns each matching record's key_name, " +
        "status, and detail fields. Valid categories include 'engineering_delivery', " +
        "'headcount', and 'internal_metrics'.",
        QueryDataSourceSchema,
        async (args) => {
            return handleQueryDataSource(repo, args);
        }
    );

    // 2. Expose Mutating Tools conditionally based on READ_ONLY setting
    if (!config.readOnly) {
        server.tool(
            "add_database_record",
            "Insert a new metrics record. Only available when the server is explicitly " +
            "started with READ_ONLY=false; the default deployment refuses writes and does " +
            "not advertise this tool at all.",
            AddDatabaseRecordSchema,
            async (args) => {
                return handleAddDatabaseRecord(repo, args, config);
            }
        );

        server.tool(
            "update_database_record",
            "Update an existing metrics record, identified by its numeric id. Only " +
            "available when the server is explicitly started with READ_ONLY=false; the " +
            "default deployment refuses writes and does not advertise this tool at all.",
            UpdateDatabaseRecordSchema,
            async (args) => {
                return handleUpdateDatabaseRecord(repo, args, config);
            }
        );
    } else {
        logger.info({ readOnly: true }, "Running in READ_ONLY mode; mutation tools are not registered");
    }
}
