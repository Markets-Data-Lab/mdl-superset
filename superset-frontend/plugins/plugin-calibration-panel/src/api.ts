/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { SupersetClient } from '@superset-ui/core';
import type {
  SupersetDataset,
  DatasetPayload,
  DatasetColumn,
  CalibrationResult,
  ParsedFile,
} from './types';

// ---------------------------------------------------------------------------
// Config — no external URL needed; calls Superset's own /api/v1/calibration/run
// ---------------------------------------------------------------------------

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
// Call the AI calibration endpoint on Superset's own backend
// ---------------------------------------------------------------------------

export async function runCalibration(payload: {
  dataset_a: DatasetPayload;
  dataset_b: DatasetPayload;
}): Promise<CalibrationResult> {
  const res = await SupersetClient.post({
    endpoint: '/api/v1/calibration/run',
    jsonPayload: payload,
  });

  const body = res.json as { result?: CalibrationResult; message?: string };
  if (body.result) return body.result;
  throw new Error(body.message ?? 'Calibration returned no results');
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
