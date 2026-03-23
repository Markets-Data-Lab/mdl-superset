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

import type {
  ColumnStats,
  ParsedFile,
  FileFormat,
  WorkbookMeta,
} from './types';

// SheetJS is available globally in the Superset bundle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const XLSX: any;

const SAMPLE_TARGET = 50;
const SAMPLE_VALUES = 5;

// ---------------------------------------------------------------------------
// Lazy-load SheetJS
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getXLSX(): Promise<any> {
  if (typeof XLSX !== 'undefined') return XLSX;
  try {
    return await import('xlsx');
  } catch {
    throw new Error(
      'SheetJS (xlsx) is not available. ' +
        'Ensure it is listed in superset-frontend/package.json dependencies.',
    );
  }
}

// ---------------------------------------------------------------------------
// Detect file type from extension
// ---------------------------------------------------------------------------

export function detectFormat(file: File): FileFormat | null {
  const name = file.name.toLowerCase();
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsm')
  ) {
    return 'excel';
  }
  if (name.endsWith('.csv')) {
    return 'csv';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

function inferType(val: unknown): string {
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (val instanceof Date) return 'date';
  if (typeof val === 'string') {
    if (!Number.isNaN(Number(val)) && val.trim() !== '') return 'number';
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return 'date';
    return 'string';
  }
  return 'string';
}

// ---------------------------------------------------------------------------
// Column statistics computed over the full dataset
// ---------------------------------------------------------------------------

function computeColumnStats(
  name: string,
  rows: Record<string, unknown>[],
): ColumnStats {
  const total = rows.length;
  let nullCount = 0;
  const seenTypes = new Set<string>();
  const uniqueValues = new Set<string>();
  const numericValues: number[] = [];
  const sampleDistinct: string[] = [];

  for (const row of rows) {
    const val = row[name];
    if (val === null || val === undefined || val === '') {
      nullCount += 1;
      continue;
    }
    const jsType = inferType(val);
    seenTypes.add(jsType);
    const str = String(val);
    if (uniqueValues.size < 10_000) uniqueValues.add(str);
    if (jsType === 'number') numericValues.push(Number(val));
    if (
      sampleDistinct.length < SAMPLE_VALUES &&
      !sampleDistinct.includes(str)
    ) {
      sampleDistinct.push(str);
    }
  }

  const dominantType =
    seenTypes.size === 0
      ? 'string'
      : seenTypes.size === 1
        ? [...seenTypes][0]
        : 'mixed';

  const stats: ColumnStats = {
    name,
    type: dominantType,
    null_count: nullCount,
    null_pct: Math.round((nullCount / total) * 100),
    total_count: total,
    unique_estimate: uniqueValues.size,
    sample_values: sampleDistinct,
  };

  if (numericValues.length > 0) {
    stats.min = String(Math.min(...numericValues));
    stats.max = String(Math.max(...numericValues));
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Strategic sampling — first N, evenly-spaced middle, last N
// ---------------------------------------------------------------------------

function strategicSample(
  rows: Record<string, unknown>[],
  target: number,
): Record<string, unknown>[] {
  if (rows.length <= target) return rows;
  const bucketSize = Math.floor(target / 3);
  const first = rows.slice(0, bucketSize);
  const last = rows.slice(-bucketSize);
  const middleCount = target - first.length - last.length;
  const middleStart = bucketSize;
  const middleEnd = rows.length - bucketSize;
  const step = Math.max(1, Math.floor((middleEnd - middleStart) / middleCount));
  const middle: Record<string, unknown>[] = [];
  for (
    let i = middleStart;
    i < middleEnd && middle.length < middleCount;
    i += step
  ) {
    middle.push(rows[i]);
  }
  return [...first, ...middle, ...last];
}

// ---------------------------------------------------------------------------
// Core: build ParsedFile from an in-memory row array
// ---------------------------------------------------------------------------

function buildParsedFile(
  rows: Record<string, unknown>[],
  fileName: string,
  format: FileFormat,
  sheetName?: string,
): ParsedFile {
  if (!rows.length) {
    return {
      file_name: fileName,
      format,
      sheet_name: sheetName,
      total_rows: 0,
      column_stats: [],
      sample_rows: [],
    };
  }
  const columnNames = Object.keys(rows[0]);
  const columnStats = columnNames.map(name => computeColumnStats(name, rows));
  const sampleRows = strategicSample(rows, SAMPLE_TARGET);
  return {
    file_name: fileName,
    format,
    sheet_name: sheetName,
    total_rows: rows.length,
    column_stats: columnStats,
    sample_rows: sampleRows,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspect an Excel file and return its sheet names without fully parsing.
 */
export async function inspectExcelSheets(file: File): Promise<WorkbookMeta> {
  const buffer = await file.arrayBuffer();
  const XLSXLib = await getXLSX();
  const wb = XLSXLib.read(buffer, { type: 'array', bookSheets: true });
  return { file, sheet_names: wb.SheetNames as string[] };
}

/**
 * Parse an Excel file — one specific sheet — and return schema + sample.
 */
export async function parseExcel(
  file: File,
  sheetName: string,
): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const XLSXLib = await getXLSX();
  const wb = XLSXLib.read(buffer, { type: 'array', dense: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in ${file.name}`);
  const rows: Record<string, unknown>[] = XLSXLib.utils.sheet_to_json(ws, {
    defval: null,
    raw: false,
  });
  return buildParsedFile(rows, file.name, 'excel', sheetName);
}

/**
 * Parse a CSV file and return schema + sample.
 */
export async function parseCsv(file: File): Promise<ParsedFile> {
  const text = await file.text();
  const XLSXLib = await getXLSX();
  const wb = XLSXLib.read(text, { type: 'string', raw: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSXLib.utils.sheet_to_json(ws, {
    defval: null,
    raw: false,
  });
  return buildParsedFile(rows, file.name, 'csv');
}
