import { z } from "zod";

/**
 * Schema for query_data_source tool
 */
export const QueryDataSourceSchema = {
    category: z.string().describe("The data domain to search: internal_metrics, headcount, or engineering_delivery"),
};

/**
 * Schema for add_database_record tool
 */
export const AddDatabaseRecordSchema = {
    category: z.string().describe("The domain category: internal_metrics, headcount, or engineering_delivery"),
    key_name: z.string().describe("The primary name of the metric, project, or job title"),
    status: z.string().describe("The current status (e.g. Sourcing, In Progress, Stable)"),
    detail_one: z.string().optional().describe("Additional descriptive detail"),
    detail_two: z.string().optional().describe("A second optional detail"),
};

/**
 * Schema for update_database_record tool
 */
export const UpdateDatabaseRecordSchema = {
    id: z.number().int().describe("The ID of the record to update"),
    category: z.string().optional().describe("The new domain category (e.g. internal_metrics, headcount, or engineering_delivery)"),
    key_name: z.string().optional().describe("The new primary name of the metric, project, or job title"),
    status: z.string().optional().describe("The new status value"),
    detail_one: z.string().optional().describe("Additional descriptive detail (use null or empty string to clear)"),
    detail_two: z.string().optional().describe("A second optional detail (use null or empty string to clear)"),
};
