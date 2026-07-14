export interface MetricRecord {
  id: number;
  category: string;
  key_name: string;
  status: string;
  detail_one: string | null;
  detail_two: string | null;
}

export type NewMetricRecord = Omit<MetricRecord, "id">;

export type UpdateMetricRecord = Partial<Omit<MetricRecord, "id">> & { id: number };

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

