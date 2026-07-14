import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { ServerConfig } from "../types/database.js";
import { CREATE_TABLE_SQL } from "./schema.js";
import { seedDatabase } from "./seed.js";

/**
 * Validates file system write access for the given SQLite database path.
 * Will throw an error if the path is invalid or unwritable.
 */
export function validateDatabasePath(dbPath: string): void {
    if (dbPath === ":memory:") {
        return;
    }

    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Check directory write access
    fs.accessSync(dir, fs.constants.W_OK);

    // If file exists, check file write access
    if (fs.existsSync(resolvedPath)) {
        fs.accessSync(resolvedPath, fs.constants.W_OK);
    }
}

/**
 * Factory function to create, initialize, and seed the SQLite database connection.
 */
export async function createDatabase(config: ServerConfig): Promise<sqlite3.Database> {
    // 1. Verify filesystem accessibility (only for file-backed databases)
    try {
        validateDatabasePath(config.dbPath);
    } catch (error) {
        throw new Error(`SQLite database path '${config.dbPath}' is not writable/accessible: ${(error as Error).message}`);
    }

    // 2. Instantiate Connection
    const db = new sqlite3.Database(config.dbPath);

    // 3. Serialize Table Initialization & Seeding
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(CREATE_TABLE_SQL, async (err) => {
                if (err) {
                    console.error("Database schema initialization failed:", err.message);
                    return reject(err);
                }

                try {
                    await seedDatabase(db);
                    resolve(db);
                } catch (seedErr) {
                    reject(seedErr);
                }
            });
        });
    });
}
