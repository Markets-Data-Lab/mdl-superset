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
import { useState } from 'react';
import { css, styled } from '@apache-superset/core/ui';
import type { ColumnStats, ParsedFile } from './types';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const PreviewContainer = styled.div`
  ${({ theme }) => css`
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.sizeUnit}px;
    overflow: hidden;
  `}
`;

const PreviewHeader = styled.button`
  ${({ theme }) => css`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.sizeUnit * 1.5}px ${theme.sizeUnit * 2}px;
    background: ${theme.colorBgLayout};
    border: none;
    cursor: pointer;
    font-size: ${theme.fontSizeSM}px;
    font-weight: ${theme.fontWeightStrong};
    color: ${theme.colorText};
    &:hover {
      background: ${theme.colorBgTextHover};
    }
  `}
`;

const Chevron = styled.span<{ open: boolean }>`
  ${({ open }) => css`
    display: inline-block;
    transition: transform 0.2s;
    transform: rotate(${open ? 180 : 0}deg);
  `}
`;

const PreviewBody = styled.div`
  ${({ theme }) => css`
    max-height: 300px;
    overflow-y: auto;
    border-top: 1px solid ${theme.colorBorderSecondary};
  `}
`;

const SideBySide = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: ${theme.colorBorderSecondary};
  `}
`;

const SourcePane = styled.div`
  ${({ theme }) => css`
    background: ${theme.colorBgContainer};
  `}
`;

const SourceTitle = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit}px ${theme.sizeUnit * 1.5}px;
    font-size: ${theme.fontSizeSM}px;
    font-weight: ${theme.fontWeightStrong};
    color: ${theme.colorTextSecondary};
    background: ${theme.colorBgLayout};
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `}
`;

const ColumnRow = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit * 0.5}px ${theme.sizeUnit * 1.5}px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    &:last-child {
      border-bottom: none;
    }
  `}
`;

const ColumnName = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.fontSizeSM}px;
    color: ${theme.colorText};
    word-break: break-all;
  `}
`;

const ColumnMeta = styled.div`
  ${({ theme }) => css`
    font-size: 10px;
    color: ${theme.colorTextTertiary};
  `}
`;

const SummaryRow = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit}px ${theme.sizeUnit * 1.5}px;
    font-size: ${theme.fontSizeSM}px;
    color: ${theme.colorTextSecondary};
    background: ${theme.colorBgLayout};
  `}
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceSummary {
  name: string;
  columns: ColumnStats[];
  totalRows?: number;
}

interface ComparisonPreviewProps {
  sourceA: SourceSummary | null;
  sourceB: SourceSummary | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatColumnMeta(col: ColumnStats): string {
  const parts: string[] = [col.type];
  if (col.null_pct > 0) parts.push(`${col.null_pct}% null`);
  if (col.unique_estimate > 0)
    parts.push(`~${col.unique_estimate.toLocaleString()} unique`);
  return parts.join(' · ');
}

function buildSummaryFromFile(file: ParsedFile): SourceSummary {
  return {
    name: file.sheet_name
      ? `${file.file_name} [${file.sheet_name}]`
      : file.file_name,
    columns: file.column_stats,
    totalRows: file.total_rows,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function SourceColumn({ columns }: { columns: ColumnStats[] }) {
  if (!columns.length) {
    return <SummaryRow>No columns</SummaryRow>;
  }
  return (
    <>
      {columns.map(col => (
        <ColumnRow key={col.name}>
          <ColumnName>{col.name}</ColumnName>
          <ColumnMeta>{formatColumnMeta(col)}</ColumnMeta>
        </ColumnRow>
      ))}
    </>
  );
}

export function ComparisonPreview({
  sourceA,
  sourceB,
}: ComparisonPreviewProps) {
  const [open, setOpen] = useState(true);

  if (!sourceA && !sourceB) return null;

  const colCountA = sourceA?.columns.length ?? 0;
  const colCountB = sourceB?.columns.length ?? 0;
  const label = `${colCountA} vs ${colCountB} columns`;

  return (
    <PreviewContainer data-test="comparison-preview">
      <PreviewHeader onClick={() => setOpen(prev => !prev)}>
        <span>Comparison Preview — {label}</span>
        <Chevron open={open}>▾</Chevron>
      </PreviewHeader>
      {open && (
        <PreviewBody>
          <SideBySide>
            <SourcePane>
              <SourceTitle title={sourceA?.name}>
                A: {sourceA?.name ?? '—'}
                {sourceA?.totalRows != null &&
                  ` (${sourceA.totalRows.toLocaleString()} rows)`}
              </SourceTitle>
              {sourceA ? (
                <SourceColumn columns={sourceA.columns} />
              ) : (
                <SummaryRow>Not selected</SummaryRow>
              )}
            </SourcePane>
            <SourcePane>
              <SourceTitle title={sourceB?.name}>
                B: {sourceB?.name ?? '—'}
                {sourceB?.totalRows != null &&
                  ` (${sourceB.totalRows.toLocaleString()} rows)`}
              </SourceTitle>
              {sourceB ? (
                <SourceColumn columns={sourceB.columns} />
              ) : (
                <SummaryRow>Not selected</SummaryRow>
              )}
            </SourcePane>
          </SideBySide>
        </PreviewBody>
      )}
    </PreviewContainer>
  );
}

export { buildSummaryFromFile };
export type { SourceSummary };
