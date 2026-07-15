import sqlite3 from "sqlite3";
import { MetricRecord, NewMetricRecord, UpdateMetricRecord } from "../types/database.js";

/**
 * Interface defining the persistence operations for Metrics.
 * Decouples the tool handlers from physical database drivers.
 */
export interface IMetricsRepository {
    queryByCategory(category: string): Promise<MetricRecord[]>;
    addRecord(record: NewMetricRecord): Promise<number>;
    updateRecord(record: UpdateMetricRecord): Promise<number>;
}

/**
 * SQLite-backed implementation of the metrics repository.
 */
export class SqliteMetricsRepository implements IMetricsRepository {
    constructor(private db: sqlite3.Database) {}

    /**
     * Retrieves records matching the given category.
     */
    queryByCategory(category: string): Promise<MetricRecord[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                "SELECT key_name, status, detail_one, detail_two FROM metrics_and_data WHERE category = ?",
                [category],
                (err, rows: MetricRecord[]) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                }
            );
        });
    }

    /**
     * Adds a new record and returns the assigned row ID.
     */
    addRecord(record: NewMetricRecord): Promise<number> {
        const { category, key_name, status, detail_one, detail_two } = record;
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
                 VALUES (?, ?, ?, ?, ?)`,
                [category, key_name, status, detail_one || null, detail_two || null],
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(this.lastID);
                }
            );
        });
    }

    /**
     * Updates fields on an existing record. Returns the number of affected rows.
     */
    updateRecord(record: UpdateMetricRecord): Promise<number> {
        const { id, category, key_name, status, detail_one, detail_two } = record;
        const updates: { col: string; val: string | number | null }[] = [];
        if (category !== undefined) updates.push({ col: "category", val: category });
        if (key_name !== undefined) updates.push({ col: "key_name", val: key_name });
        if (status !== undefined) updates.push({ col: "status", val: status });
        if (detail_one !== undefined) updates.push({ col: "detail_one", val: detail_one || null });
        if (detail_two !== undefined) updates.push({ col: "detail_two", val: detail_two || null });

        if (updates.length === 0) {
            return Promise.reject(new Error("At least one update field must be provided."));
        }

        const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
        const params: (string | number | null)[] = updates.map((u) => u.val);
        params.push(id);

        const sql = `UPDATE metrics_and_data SET ${setClause} WHERE id = ?`;

        return new Promise((resolve, reject) => {
            this.db.run(
                sql,
                params,
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(this.changes);
                }
            );
        });
    }
}
