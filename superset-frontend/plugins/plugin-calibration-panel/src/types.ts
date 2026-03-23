// ---------------------------------------------------------------------------
// Comparison source types
// ---------------------------------------------------------------------------

export type ComparisonMode =
  | 'snowflake_snowflake'
  | 'file_snowflake'
  | 'file_file';

export type FileFormat = 'excel' | 'csv';

// Rich column metadata computed client-side from the full file
export interface ColumnStats {
  name: string;
  type: string;           // inferred JS type: 'string' | 'number' | 'date' | 'boolean' | 'mixed'
  null_count: number;
  null_pct: number;       // 0–100
  total_count: number;
  unique_estimate: number;
  min?: string;           // stringified for transport
  max?: string;
  sample_values: string[]; // up to 5 distinct non-null values
}

// A parsed file ready for comparison
export interface ParsedFile {
  file_name: string;
  format: FileFormat;
  sheet_name?: string;     // Excel only
  total_rows: number;
  column_stats: ColumnStats[];
  sample_rows: Record<string, unknown>[];  // ~50 representative rows
}

// Available sheets inside an Excel workbook
export interface WorkbookMeta {
  file: File;
  sheet_names: string[];
}

// ---------------------------------------------------------------------------
// Dataset payload sent to the Lambda (unified — same shape for all sources)
// ---------------------------------------------------------------------------
export interface DatasetColumn {
  name: string;
  type: string;
  is_dttm?: boolean;
  null_pct?: number;
  unique_estimate?: number;
  min?: string;
  max?: string;
  sample_values?: string[];
}

export interface DatasetPayload {
  name: string;
  source: 'snowflake' | 'excel' | 'csv';
  total_rows?: number;
  columns: DatasetColumn[];
  sample_rows: Record<string, unknown>[];
}

// Superset API dataset shape (subset of what /api/v1/dataset/:id returns)
export interface SupersetDataset {
  id: number;
  table_name: string;
  datasource_name?: string;
  columns: {
    column_name: string;
    type: string;
    is_dttm?: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Lambda response types
// ---------------------------------------------------------------------------

export interface FieldMatch {
  field_a: string;
  field_b: string;
  confidence: number;   // 0.0 – 1.0
  match_type: 'exact' | 'semantic' | 'partial' | 'derived';
  reasoning: string;
}

export interface Anomaly {
  dataset: 'A' | 'B';
  field: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  affected_estimate: string;
}

export interface Correction {
  field_a: string;
  field_b: string;
  correction_type: string;
  formula: string;
  confidence: number;   // 0.0 – 1.0
}

export interface CalibrationResult {
  field_matches: FieldMatch[];
  anomalies: Anomaly[];
  corrections: Correction[];
  explanation: string;
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export type DockPosition = 'bottom' | 'left' | 'right';
export type ActiveTab = 'matches' | 'anomalies' | 'corrections' | 'explanation';
export type LoadingState =
  | 'idle'
  | 'parsing'       // parsing uploaded file
  | 'fetching'      // fetching Snowflake metadata
  | 'running'       // waiting for Lambda / Anthropic
  | 'done'
  | 'error';
