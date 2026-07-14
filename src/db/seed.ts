import sqlite3 from "sqlite3";

/**
 * Seeds mock/demo data into the metrics_and_data table if it is completely empty.
 */
export function seedDatabase(db: sqlite3.Database): Promise<void> {
    return new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM metrics_and_data", (err, row: { count: number } | undefined) => {
            if (err) {
                console.error("Failed to check if database needs seeding:", err.message);
                return reject(err);
            }

            if (row && row.count === 0) {
                console.error("Log: Seeding SQLite database with initial records...");
                const stmt = db.prepare(`
                    INSERT INTO metrics_and_data (category, key_name, status, detail_one, detail_two) 
                    VALUES (?, ?, ?, ?, ?)
                `);

                try {
                    // Seed Engineering Delivery
                    stmt.run("engineering_delivery", "RAG Pipeline Ingestion", "Validation", "Production Ready", null);
                    stmt.run("engineering_delivery", "Graph Search Integration", "Discovery", null, "Q4 2026");

                    // Seed Headcount
                    stmt.run("headcount", "Full Stack Software Engineer", "Sourcing", "2 Allocations", "ENG-2026-Q3");
                    stmt.run("headcount", "Frontend Developer", "Interviewing", "1 Allocation", null);

                    // Seed Internal Metrics
                    stmt.run("internal_metrics", "API Response Latency", "Optimized", "Under 8s Target", "7.4s Current");
                    stmt.run("internal_metrics", "Token Throughput", "Stable", "94% Efficiency", null);

                    stmt.finalize((finalizeErr) => {
                        if (finalizeErr) {
                            console.error("Error finalizing database seeding statements:", finalizeErr.message);
                            return reject(finalizeErr);
                        }
                        resolve();
                    });
                } catch (runErr) {
                    reject(runErr);
                }
            } else {
                resolve();
            }
        });
    });
}
