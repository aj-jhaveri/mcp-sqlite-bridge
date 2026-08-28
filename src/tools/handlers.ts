import { IMetricsRepository } from "../db/repository.js";
import { McpToolResponse, NewMetricRecord, UpdateMetricRecord, ServerConfig } from "../types/database.js";
import { logger } from "../logging/logger.js";

/**
 * Refusal returned by a mutation handler on a read-only server.
 *
 * Registration in tools/index.ts is the primary gate: a read-only server never
 * advertises these tools and the SDK rejects a direct call before any handler
 * runs. This is the second lock. Registration is a single point of failure -
 * one `server.tool(...)` accidentally placed outside the `if (!config.readOnly)`
 * block, a plausible edit for someone adding a tool later, and writes are live
 * with nothing else standing in the way.
 */
function readOnlyRefusal(action: string): McpToolResponse {
    return {
        content: [
            {
                type: "text",
                text: `This server is running in read-only mode. Refusing to ${action}. ` +
                      `No data was modified. Writes require the operator to start the ` +
                      `server with READ_ONLY=false; this cannot be changed at call time.`,
            },
        ],
        isError: true,
    };
}

/**
 * Handles query_data_source tool execution.
 * Invokes the repository layer to fetch records and formats the response.
 */
export async function handleQueryDataSource(
    repo: IMetricsRepository,
    args: { category: string }
): Promise<McpToolResponse> {
    const { category } = args;
    logger.debug({ tool: "query_data_source", category }, "Executing repository query");

    try {
        const rows = await repo.queryByCategory(category);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(rows, null, 2),
                },
            ],
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Driver text stays server-side. The consumer of this string is an LLM,
        // and SQLite errors can echo schema details and filesystem paths.
        logger.error({ tool: "query_data_source", errMessage: msg }, "Database query operation failed");
        return {
            content: [
                {
                    type: "text",
                    text: "The database could not be queried. No results were returned. " +
                          "This is a server-side fault, not a problem with the arguments; " +
                          "retrying the same call is unlikely to help.",
                },
            ],
            isError: true,
        };
    }
}

/**
 * Handles add_database_record tool execution.
 * Decoupled from SQLite details; writes records through the IMetricsRepository contract.
 */
export async function handleAddDatabaseRecord(
    repo: IMetricsRepository,
    args: NewMetricRecord,
    config: ServerConfig
): Promise<McpToolResponse> {
    if (config.readOnly) {
        logger.warn({ tool: "add_database_record" }, "Refused mutation: server is read-only");
        return readOnlyRefusal("insert a record");
    }

    logger.debug({ tool: "add_database_record" }, "Executing repository write");

    try {
        const lastID = await repo.addRecord(args);
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully inserted record. Row ID: ${lastID}`,
                },
            ],
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ tool: "add_database_record", errMessage: msg }, "Database write operation failed");
        return {
            content: [
                {
                    type: "text",
                    text: "The database rejected this write. No record was created. " +
                          "Do not retry with identical arguments without changing them.",
                },
            ],
            isError: true,
        };
    }
}

/**
 * Handles update_database_record tool execution.
 * Performs logical validation of partial update arguments, then executes the update via IMetricsRepository.
 */
export async function handleUpdateDatabaseRecord(
    repo: IMetricsRepository,
    args: UpdateMetricRecord,
    config: ServerConfig
): Promise<McpToolResponse> {
    if (config.readOnly) {
        logger.warn({ tool: "update_database_record" }, "Refused mutation: server is read-only");
        return readOnlyRefusal("update a record");
    }

    const { id } = args;
    logger.debug({ tool: "update_database_record", recordId: id }, "Executing repository update");

    // Verify if we have any fields to update (other than the ID parameter)
    const { category, key_name, status, detail_one, detail_two } = args;
    if (
        category === undefined &&
        key_name === undefined &&
        status === undefined &&
        detail_one === undefined &&
        detail_two === undefined
    ) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: At least one update field (category, key_name, status, detail_one, or detail_two) must be provided for update.",
                },
            ],
            isError: true,
        };
    }

    try {
        const changes = await repo.updateRecord(args);
        if (changes === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: Record with ID ${id} not found`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully updated record with ID: ${id}. Rows affected: ${changes}`,
                },
            ],
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ tool: "update_database_record", recordId: id, errMessage: msg }, "Database update operation failed");
        return {
            content: [
                {
                    type: "text",
                    text: `The database rejected the update to record ${id}. ` +
                          "No fields were changed.",
                },
            ],
            isError: true,
        };
    }
}
