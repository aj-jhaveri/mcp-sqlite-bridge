import { IMetricsRepository } from "../db/repository.js";
import { McpToolResponse, NewMetricRecord, UpdateMetricRecord } from "../types/database.js";

/**
 * Handles query_data_source tool execution.
 * Invokes the repository layer to fetch records and formats the response.
 */
export async function handleQueryDataSource(
    repo: IMetricsRepository,
    args: { category: string }
): Promise<McpToolResponse> {
    const { category } = args;
    console.error(`Log: Executing repository query for category: ${category}`);

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
        console.error("Database query operation failed:", msg);
        return {
            content: [
                {
                    type: "text",
                    text: `Database error querying data source: ${msg}`,
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
    args: NewMetricRecord
): Promise<McpToolResponse> {
    console.error(`Log: Executing repository write...`);

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
        console.error("Database write operation failed:", msg);
        return {
            content: [
                {
                    type: "text",
                    text: `Database error adding record: ${msg}`,
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
    args: UpdateMetricRecord
): Promise<McpToolResponse> {
    const { id } = args;
    console.error(`Log: Executing repository update for ID ${id}...`);

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
        console.error("Database update operation failed:", msg);
        return {
            content: [
                {
                    type: "text",
                    text: `Database error updating record: ${msg}`,
                },
            ],
            isError: true,
        };
    }
}
