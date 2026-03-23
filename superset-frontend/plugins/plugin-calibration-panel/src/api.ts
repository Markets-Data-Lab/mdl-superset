import { SupersetClient } from '@superset-ui/core';
import type {
  SupersetDataset,
  DatasetPayload,
  DatasetColumn,
  CalibrationResult,
  ParsedFile,
} from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getApiUrl(): string {
  const w = window as unknown as Record<string, string>;
  return (
    w.CALIBRATION_API_URL ||
    process.env.REACT_APP_CALIBRATION_API_URL ||
    ''
  );
}

// ---------------------------------------------------------------------------
// Snowflake: fetch dataset metadata + sample rows from Superset API
// ---------------------------------------------------------------------------

export async function fetchDataset(id: number): Promise<{
  meta: SupersetDataset;
  sampleRows: Record<string, unknown>[];
}> {
  const metaRes = await SupersetClient.get({
    endpoint: `/api/v1/dataset/${id}`,
  });
  const meta = (metaRes.json as { result: SupersetDataset }).result;

  let sampleRows: Record<string, unknown>[] = [];
  try {
    const colNames = meta.columns.map(c => c.column_name).slice(0, 20);
    const dataRes = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: {
        datasource: { id, type: 'table' },
        queries: [{ columns: colNames, row_limit: 50, filters: [] }],
      },
    });
    sampleRows =
      (dataRes.json as { result: { data: Record<string, unknown>[] }[] })
        .result?.[0]?.data ?? [];
  } catch {
    // best-effort
  }

  return { meta, sampleRows };
}

// ---------------------------------------------------------------------------
// Build a DatasetPayload from a Snowflake dataset
// ---------------------------------------------------------------------------

export function snowflakeToPayload(
  meta: SupersetDataset,
  sampleRows: Record<string, unknown>[],
): DatasetPayload {
  return {
    name: meta.table_name ?? meta.datasource_name ?? `Dataset ${meta.id}`,
    source: 'snowflake',
    columns: meta.columns.map(c => ({
      name: c.column_name,
      type: c.type,
      is_dttm: c.is_dttm,
    })),
    sample_rows: sampleRows,
  };
}

// ---------------------------------------------------------------------------
// Build a DatasetPayload from a parsed file (Excel / CSV)
// Enriches column definitions with the stats computed during parsing.
// ---------------------------------------------------------------------------

export function fileToPayload(parsed: ParsedFile): DatasetPayload {
  const columns: DatasetColumn[] = parsed.column_stats.map(s => ({
    name: s.name,
    type: s.type,
    null_pct: s.null_pct,
    unique_estimate: s.unique_estimate,
    min: s.min,
    max: s.max,
    sample_values: s.sample_values,
  }));

  return {
    name: parsed.sheet_name
      ? `${parsed.file_name} [${parsed.sheet_name}]`
      : parsed.file_name,
    source: parsed.format,
    total_rows: parsed.total_rows,
    columns,
    sample_rows: parsed.sample_rows,
  };
}

// ---------------------------------------------------------------------------
// Call the AI calibration Lambda via API Gateway
// ---------------------------------------------------------------------------

export async function runCalibration(
  payload: { dataset_a: DatasetPayload; dataset_b: DatasetPayload },
  cognitoToken: string,
): Promise<CalibrationResult> {
  const url = getApiUrl();
  if (!url) {
    throw new Error(
      'Calibration API URL not configured. ' +
      'Set CALIBRATION_API_URL in your Superset config or environment.',
    );
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cognitoToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      message = err.error ?? message;
    } catch { /* keep status */ }
    throw new Error(message);
  }

  return res.json() as Promise<CalibrationResult>;
}

// ---------------------------------------------------------------------------
// Retrieve Cognito JWT from Superset's bootstrap data
// ---------------------------------------------------------------------------

export function getCognitoToken(): string {
  try {
    const bootstrap = (
      window as unknown as {
        bootstrapData?: { user?: { access_token?: string } };
      }
    ).bootstrapData;
    return bootstrap?.user?.access_token ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Dataset list for Snowflake dropdowns
// ---------------------------------------------------------------------------

export interface DatasetListItem {
  id: number;
  table_name: string;
  schema: string;
  database: { database_name: string };
}

export async function fetchDatasetList(): Promise<DatasetListItem[]> {
  const res = await SupersetClient.get({
    endpoint:
      '/api/v1/dataset/?q=(page_size:500,order_column:table_name,order_direction:asc)',
  });
  return (res.json as { result: DatasetListItem[] }).result ?? [];
}
