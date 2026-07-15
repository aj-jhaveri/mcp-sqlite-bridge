import { z } from "zod";
import {
    MetricRecordZodSchema,
    NewMetricRecordZodSchema,
    UpdateMetricRecordZodSchema,
} from "../tools/schemas.js";

/**
 * Type-safe interfaces inferred directly from runtime validation schemas.
 */
export type MetricRecord = z.infer<typeof MetricRecordZodSchema>;
export type NewMetricRecord = z.infer<typeof NewMetricRecordZodSchema>;
export type UpdateMetricRecord = z.infer<typeof UpdateMetricRecordZodSchema>;

export interface ServerConfig {
    dbPath: string;
    readOnly: boolean;
}

export interface McpToolResponse {
    [key: string]: unknown;
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
