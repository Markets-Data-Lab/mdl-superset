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

import type { CalibrationResult } from './types';

// SheetJS is bundled by Superset — available on window.XLSX or via import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getXLSX(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).XLSX !== 'undefined')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).XLSX;
  return import('xlsx');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellAddr(row: number, col: number): string {
  const colLetter = String.fromCharCode(65 + col); // A–Z
  return `${colLetter}${row + 1}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boldHeaderRow(ws: any, colCount: number): void {
  for (let c = 0; c < colCount; c += 1) {
    const addr = cellAddr(0, c);
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'E6F1FB' } },
        alignment: { horizontal: 'left' },
      };
    }
  }
}

function applyConfidenceConditional(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  dataRows: unknown[][],
  colIndex: number,
): void {
  dataRows.forEach((row, rowIdx) => {
    const raw = row[colIndex] as string; // e.g. "87%"
    const pct = parseInt(raw, 10);
    const addr = cellAddr(rowIdx + 1, colIndex); // +1 for header
    if (!ws[addr]) return;
    const rgb =
      pct >= 80
        ? 'E1F5EE' // green tint
        : pct >= 50
          ? 'FAEEDA' // amber tint
          : 'FCEBEB'; // red tint
    ws[addr].s = { fill: { fgColor: { rgb } } };
  });
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportResultsToExcel(
  result: CalibrationResult,
  sourceAName: string,
  sourceBName: string,
  sourceARows?: number,
  sourceBRows?: number,
): Promise<void> {
  const XLSX = await getXLSX();

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summaryRows = [
    ['AI Calibration Report'],
    [],
    ['Run date', new Date().toLocaleString()],
    ['Source A', sourceAName],
    ['Source B', sourceBName],
    ...(sourceARows != null
      ? [['Source A rows', sourceARows.toLocaleString()]]
      : []),
    ...(sourceBRows != null
      ? [['Source B rows', sourceBRows.toLocaleString()]]
      : []),
    [],
    ['Field matches found', result.field_matches.length],
    ['Anomalies detected', result.anomalies.length],
    ['Corrections suggested', result.corrections.length],
    [],
    ['AI Explanation'],
    [result.explanation],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 80 }];

  if (wsSummary.A1) {
    wsSummary.A1.s = {
      font: { bold: true, sz: 14 },
      alignment: { horizontal: 'left' },
    };
  }

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ── Sheet 2: Field Matches ────────────────────────────────────────────────
  const matchHeaders = [
    `${sourceAName} field`,
    `${sourceBName} field`,
    'Match type',
    'Confidence',
    'Reasoning',
  ];

  const matchRows = result.field_matches.map(m => [
    m.field_a,
    m.field_b,
    m.match_type,
    `${Math.round(m.confidence * 100)}%`,
    m.reasoning,
  ]);

  const wsMatches = XLSX.utils.aoa_to_sheet([matchHeaders, ...matchRows]);
  wsMatches['!cols'] = [
    { wch: 28 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 60 },
  ];
  boldHeaderRow(wsMatches, matchHeaders.length);
  applyConfidenceConditional(wsMatches, matchRows, 3);
  XLSX.utils.book_append_sheet(wb, wsMatches, 'Field Matches');

  // ── Sheet 3: Anomalies ────────────────────────────────────────────────────
  const anomalyHeaders = ['Source', 'Field', 'Issue', 'Severity', 'Affected'];

  const anomalyRows = result.anomalies.map(a => [
    `Dataset ${a.dataset}`,
    a.field,
    a.issue,
    a.severity,
    a.affected_estimate,
  ]);

  const wsAnomalies = XLSX.utils.aoa_to_sheet([anomalyHeaders, ...anomalyRows]);
  wsAnomalies['!cols'] = [
    { wch: 12 },
    { wch: 26 },
    { wch: 55 },
    { wch: 12 },
    { wch: 24 },
  ];
  boldHeaderRow(wsAnomalies, anomalyHeaders.length);
  XLSX.utils.book_append_sheet(wb, wsAnomalies, 'Anomalies');

  // ── Sheet 4: Corrections ──────────────────────────────────────────────────
  const correctionHeaders = [
    `${sourceAName} field`,
    `${sourceBName} field`,
    'Correction type',
    'Formula / mapping',
    'Confidence',
  ];

  const correctionRows = result.corrections.map(c => [
    c.field_a,
    c.field_b,
    c.correction_type,
    c.formula,
    `${Math.round(c.confidence * 100)}%`,
  ]);

  const wsCorrections = XLSX.utils.aoa_to_sheet([
    correctionHeaders,
    ...correctionRows,
  ]);
  wsCorrections['!cols'] = [
    { wch: 28 },
    { wch: 28 },
    { wch: 20 },
    { wch: 55 },
    { wch: 12 },
  ];
  boldHeaderRow(wsCorrections, correctionHeaders.length);
  XLSX.utils.book_append_sheet(wb, wsCorrections, 'Corrections');

  // ── Write and trigger download ────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `calibration-report-${timestamp}.xlsx`;

  XLSX.writeFile(wb, fileName);
}
