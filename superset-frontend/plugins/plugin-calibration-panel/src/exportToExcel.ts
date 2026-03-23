/**
 * exportToExcel.ts
 *
 * Exports calibration results to a formatted .xlsx file.
 * Uses SheetJS (xlsx) which is already in superset-frontend/package.json.
 *
 * Output workbook has four sheets:
 *   1. Summary       — run metadata + plain-English explanation
 *   2. Field Matches — matched columns with confidence and reasoning
 *   3. Anomalies     — flagged issues with severity
 *   4. Corrections   — suggested formulas and transformations
 */

import type { CalibrationResult, DatasetPayload } from './types';

// SheetJS is bundled by Superset — available on window.XLSX or via import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getXLSX(): Promise<any> {
  if (typeof (window as any).XLSX !== 'undefined') return (window as any).XLSX;
  return import('xlsx');
}

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
    ['Run date',    new Date().toLocaleString()],
    ['Source A',   sourceAName],
    ['Source B',   sourceBName],
    ...(sourceARows != null ? [['Source A rows', sourceARows.toLocaleString()]] : []),
    ...(sourceBRows != null ? [['Source B rows', sourceBRows.toLocaleString()]] : []),
    [],
    ['Field matches found',  result.field_matches.length],
    ['Anomalies detected',   result.anomalies.length],
    ['Corrections suggested',result.corrections.length],
    [],
    ['AI Explanation'],
    [result.explanation],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

  // Style column widths
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 80 }];

  // Bold the title cell
  if (wsSummary['A1']) {
    wsSummary['A1'].s = {
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
    { wch: 28 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 60 },
  ];
  _boldHeaderRow(wsMatches, matchHeaders.length);
  _applyConfidenceConditional(wsMatches, matchRows, 3); // col D = confidence
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
    { wch: 12 }, { wch: 26 }, { wch: 55 }, { wch: 12 }, { wch: 24 },
  ];
  _boldHeaderRow(wsAnomalies, anomalyHeaders.length);
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

  const wsCorrections = XLSX.utils.aoa_to_sheet([correctionHeaders, ...correctionRows]);
  wsCorrections['!cols'] = [
    { wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 55 }, { wch: 12 },
  ];
  _boldHeaderRow(wsCorrections, correctionHeaders.length);
  XLSX.utils.book_append_sheet(wb, wsCorrections, 'Corrections');

  // ── Write and trigger download ────────────────────────────────────────────
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const fileName = `calibration-report-${timestamp}.xlsx`;

  XLSX.writeFile(wb, fileName);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _boldHeaderRow(ws: any, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    const addr = _cellAddr(0, c);
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'E6F1FB' } },
        alignment: { horizontal: 'left' },
      };
    }
  }
}

// Light conditional colouring for confidence column (no full XLSX conditionals —
// we bake the colour into the cell style directly based on value)
function _applyConfidenceConditional(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  dataRows: unknown[][],
  colIndex: number,
): void {
  dataRows.forEach((row, rowIdx) => {
    const raw = row[colIndex] as string; // e.g. "87%"
    const pct = parseInt(raw, 10);
    const addr = _cellAddr(rowIdx + 1, colIndex); // +1 for header
    if (!ws[addr]) return;
    const rgb =
      pct >= 80 ? 'E1F5EE' :   // green tint
      pct >= 50 ? 'FAEEDA' :   // amber tint
                  'FCEBEB';    // red tint
    ws[addr].s = { fill: { fgColor: { rgb } } };
  });
}

function _cellAddr(row: number, col: number): string {
  const colLetter = String.fromCharCode(65 + col); // A–Z (sufficient for our cols)
  return `${colLetter}${row + 1}`;
}
