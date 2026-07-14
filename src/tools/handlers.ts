import sqlite3 from "sqlite3";
import { McpToolResponse, MetricRecord } from "../types/database.js";

/**
 * Handles query_data_source tool execution.
 * Fetches rows matching a given category/domain.
 */
export async function handleQueryDataSource(
    db: sqlite3.Database,
    args: { category: string }
): Promise<McpToolResponse> {
    const { category } = args;
    console.error(`Log: Executing SQL query for category: ${category}`);

    return new Promise((resolve) => {
        db.all(
            "SELECT key_name, status, detail_one, detail_two FROM metrics_and_data WHERE category = ?",
            [category],
            (err: Error | null, rows: MetricRecord[]) => {
                if (err) {
                    return resolve({
                        content: [
                            {
                                type: "text",
                                text: `Database error querying data source: ${err.message}`,
                            },
                        ],
                        isError: true,
                    });
                }
                resolve({
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(rows, null, 2),
                        },
                    ],
                });
            }
        );
    });
}

/**
 * Handles add_database_record tool execution.
 * Inserts a new row into the database with category, key_name, status, and optional details.
 */
export async function handleAddDatabaseRecord(
    db: sqlite3.Database,
    args: {
        category: string;
        key_name: string;
        status: string;
        detail_one?: string;
        detail_two?: string;
    }
): Promise<McpToolResponse> {
    const { category, key_name, status, detail_one, detail_two } = args;
    console.error(`Log: Writing new record to database...`);

    return new Promise((resolve) => {
        db.run(
            `INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
             VALUES (?, ?, ?, ?, ?)`,
            [category, key_name, status, detail_one || null, detail_two || null],
            function (this: sqlite3.RunResult, err: Error | null) {
                if (err) {
                    return resolve({
                        content: [
                            {
                                type: "text",
                                text: `Database error adding record: ${err.message}`,
                            },
                        ],
                        isError: true,
                    });
                }
                resolve({
                    content: [
                        {
                            type: "text",
                            text: `Successfully inserted record. Row ID: ${this.lastID}`,
                        },
                    ],
                });
            }
        );
    });
}

/**
 * Handles update_database_record tool execution.
 * Mutates an existing database row by its ID. Supports partial updates of all table fields.
 */
export async function handleUpdateDatabaseRecord(
    db: sqlite3.Database,
    args: {
        id: number;
        category?: string;
        key_name?: string;
        status?: string;
        detail_one?: string;
        detail_two?: string;
    }
): Promise<McpToolResponse> {
    const { id, category, key_name, status, detail_one, detail_two } = args;
    console.error(`Log: Updating record ID ${id} in database...`);

    // Check if zero update fields are provided
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

    const updates: { col: string; val: string | number | null }[] = [];
    if (category !== undefined) updates.push({ col: "category", val: category });
    if (key_name !== undefined) updates.push({ col: "key_name", val: key_name });
    if (status !== undefined) updates.push({ col: "status", val: status });
    if (detail_one !== undefined) updates.push({ col: "detail_one", val: detail_one || null });
    if (detail_two !== undefined) updates.push({ col: "detail_two", val: detail_two || null });

    const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
    const params: (string | number | null)[] = updates.map((u) => u.val);
    params.push(id); // push id for WHERE clause

    const sql = `UPDATE metrics_and_data SET ${setClause} WHERE id = ?`;

    return new Promise((resolve) => {
        db.run(
            sql,
            params,
            function (this: sqlite3.RunResult, err: Error | null) {
                if (err) {
                    return resolve({
                        content: [
                            {
                                type: "text",
                                text: `Database error updating record: ${err.message}`,
                            },
                        ],
                        isError: true,
                    });
                }
                if (this.changes === 0) {
                    return resolve({
                        content: [
                            {
                                type: "text",
                                text: `Error: Record with ID ${id} not found`,
                            },
                        ],
                        isError: true,
                    });
                }
                resolve({
                    content: [
                        {
                            type: "text",
                            text: `Successfully updated record with ID: ${id}. Rows affected: ${this.changes}`,
                        },
                    ],
                });
            }
        );
    });
}
