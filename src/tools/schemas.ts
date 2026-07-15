import { z } from "zod";

/**
 * Shared category enum schema to restrict valid database domains.
 */
export const CategorySchema = z.enum(["internal_metrics", "headcount", "engineering_delivery"])
    .describe("The data domain to search: internal_metrics, headcount, or engineering_delivery");

/**
 * Raw Zod Shape definitions expected by the MCP SDK for tool registration.
 */

export const QueryDataSourceSchema = {
    category: CategorySchema,
};

export const AddDatabaseRecordSchema = {
    category: CategorySchema,
    key_name: z.string().describe("The primary name of the metric, project, or job title"),
    status: z.string().describe("The current status (e.g. Sourcing, In Progress, Stable)"),
    detail_one: z.string().optional().nullable().describe("Additional descriptive detail"),
    detail_two: z.string().optional().nullable().describe("A second optional detail"),
};

export const UpdateDatabaseRecordSchema = {
    id: z.number().int().describe("The ID of the record to update"),
    category: CategorySchema.optional(),
    key_name: z.string().optional().describe("The new primary name of the metric, project, or job title"),
    status: z.string().optional().describe("The new status value"),
    detail_one: z.string().optional().nullable().describe("Additional descriptive detail (use null or empty string to clear)"),
    detail_two: z.string().optional().nullable().describe("A second optional detail (use null or empty string to clear)"),
};

/**
 * Standard Zod Object schemas constructed for strict type inference.
 */

export const MetricRecordZodSchema = z.object({
    id: z.number().int(),
    category: CategorySchema,
    key_name: z.string(),
    status: z.string().nullable(),
    detail_one: z.string().optional().nullable(),
    detail_two: z.string().optional().nullable(),
});

export const NewMetricRecordZodSchema = MetricRecordZodSchema.omit({ id: true });

export const UpdateMetricRecordZodSchema = MetricRecordZodSchema.partial().omit({ id: true }).extend({
    id: z.number().int(),
});
