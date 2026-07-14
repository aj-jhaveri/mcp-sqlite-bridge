/**
 * SQLite Schema definition for metrics and data.
 */
export const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS metrics_and_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key_name TEXT NOT NULL,
        status TEXT,
        detail_one TEXT,
        detail_two TEXT
    )
`;
