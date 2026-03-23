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
import React, { useCallback, useRef, useState } from 'react';
import { styled } from '@superset-ui/core';
import type { ParsedFile, WorkbookMeta } from './types';
import {
  detectFormat,
  inspectExcelSheets,
  parseExcel,
  parseCsv,
} from './fileParser';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const DropZone = styled.div<{ dragging: boolean; hasFile: boolean }>`
  align-items: center;
  border: 2px dashed
    ${({ dragging, hasFile, theme }) =>
      dragging
        ? theme.colors.primary.base
        : hasFile
          ? theme.colors.success.base
          : theme.colors.grayscale.light2};
  border-radius: ${({ theme }) => theme.gridUnit}px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.gridUnit}px;
  padding: ${({ theme }) => theme.gridUnit * 2}px;
  text-align: center;
  transition:
    border-color 0.2s,
    background 0.2s;
  background: ${({ dragging, theme }) =>
    dragging ? theme.colors.primary.light4 : 'transparent'};
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.base};
    background: ${({ theme }) => theme.colors.primary.light4};
  }
`;

const DropLabel = styled.span`
  color: ${({ theme }) => theme.colors.grayscale.base};
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
`;

const FileName = styled.span`
  color: ${({ theme }) => theme.colors.success.dark1};
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  word-break: break-all;
`;

const FileMeta = styled.span`
  color: ${({ theme }) => theme.colors.grayscale.base};
  font-size: 11px;
`;

const ClearBtn = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.error.base};
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  &:hover {
    text-decoration: underline;
  }
`;

const ProgressBar = styled.div<{ pct: number }>`
  background: ${({ theme }) => theme.colors.grayscale.light3};
  border-radius: 2px;
  height: 4px;
  overflow: hidden;
  width: 100%;
  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ pct }) => pct}%;
    background: ${({ theme }) => theme.colors.primary.base};
    transition: width 0.3s ease;
  }
`;

const ErrorMsg = styled.span`
  color: ${({ theme }) => theme.colors.error.base};
  font-size: 11px;
`;

const SheetPickerOverlay = styled.div`
  background: ${({ theme }) => theme.colors.grayscale.light5};
  border: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
  border-radius: ${({ theme }) => theme.gridUnit}px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: ${({ theme }) => theme.gridUnit * 2}px;
  position: absolute;
  width: 220px;
  z-index: 100;
`;

const SheetOption = styled.button`
  background: transparent;
  border: none;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.grayscale.dark2};
  cursor: pointer;
  display: block;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  text-align: left;
  width: 100%;
  &:hover {
    background: ${({ theme }) => theme.colors.primary.light4};
    color: ${({ theme }) => theme.colors.primary.base};
  }
`;

const SheetPickerLabel = styled.div`
  color: ${({ theme }) => theme.colors.grayscale.dark1};
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  margin-bottom: ${({ theme }) => theme.gridUnit}px;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FileUploaderProps {
  label: string;
  onParsed: (result: ParsedFile) => void;
  onClear: () => void;
  parsed: ParsedFile | null;
  disabled?: boolean;
}

export function FileUploader({
  label,
  onParsed,
  onClear,
  parsed,
  disabled = false,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workbookMeta, setWorkbookMeta] = useState<WorkbookMeta | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const format = detectFormat(file);
      if (!format) {
        setError(
          'Unsupported file type. Please upload .xlsx, .xls, .xlsm, or .csv',
        );
        return;
      }

      if (format === 'csv') {
        // CSV — single implicit sheet, parse directly
        setParsing(true);
        setProgress(30);
        try {
          const ticker = setInterval(
            () => setProgress(p => Math.min(p + 10, 85)),
            200,
          );
          const result = await parseCsv(file);
          clearInterval(ticker);
          setProgress(100);
          onParsed(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to read CSV file');
        } finally {
          setParsing(false);
          setProgress(0);
        }
        return;
      }

      // Excel — inspect sheets first, show picker if more than one
      setParsing(true);
      setProgress(20);
      try {
        const meta = await inspectExcelSheets(file);
        setProgress(40);
        if (meta.sheet_names.length === 1) {
          const result = await parseExcel(file, meta.sheet_names[0]);
          setProgress(100);
          onParsed(result);
        } else {
          // Multiple sheets — show picker overlay
          setWorkbookMeta(meta);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to read Excel file');
      } finally {
        setParsing(false);
        setProgress(0);
      }
    },
    [onParsed],
  );

  const handleSheetPick = useCallback(
    async (sheetName: string) => {
      if (!workbookMeta) return;
      setWorkbookMeta(null);
      setParsing(true);
      setProgress(50);
      try {
        const result = await parseExcel(workbookMeta.file, sheetName);
        setProgress(100);
        onParsed(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to parse sheet');
      } finally {
        setParsing(false);
        setProgress(0);
      }
    },
    [workbookMeta, onParsed],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled || parsing) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, parsing, handleFile],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = ''; // allow re-upload of same file
    },
    [handleFile],
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <DropZone
        dragging={dragging}
        hasFile={!!parsed}
        onClick={() => !disabled && !parsing && inputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv"
          style={{ display: 'none' }}
          onChange={onInputChange}
          disabled={disabled || parsing}
        />

        {parsed ? (
          <>
            <FileName>{parsed.file_name}</FileName>
            <FileMeta>
              {parsed.format.toUpperCase()}
              {parsed.sheet_name ? ` · ${parsed.sheet_name}` : ''}
              {' · '}
              {parsed.total_rows.toLocaleString()} rows
              {' · '}
              {parsed.column_stats.length} columns
            </FileMeta>
            <ClearBtn
              onClick={e => {
                e.stopPropagation();
                onClear();
                setError(null);
              }}
            >
              Remove file
            </ClearBtn>
          </>
        ) : parsing ? (
          <>
            <DropLabel>Parsing file…</DropLabel>
            <ProgressBar pct={progress} style={{ width: '80%' }} />
          </>
        ) : (
          <DropLabel>
            Drop {label} here or click to browse
            <br />
            <span style={{ fontSize: 10 }}>
              Excel (.xlsx, .xls) or CSV (.csv)
            </span>
          </DropLabel>
        )}
      </DropZone>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {/* Sheet picker dropdown */}
      {workbookMeta && (
        <SheetPickerOverlay>
          <SheetPickerLabel>Select a sheet</SheetPickerLabel>
          {workbookMeta.sheet_names.map(name => (
            <SheetOption key={name} onClick={() => handleSheetPick(name)}>
              {name}
            </SheetOption>
          ))}
          <ClearBtn
            style={{ marginTop: 8 }}
            onClick={() => {
              setWorkbookMeta(null);
              setParsing(false);
            }}
          >
            Cancel
          </ClearBtn>
        </SheetPickerOverlay>
      )}
    </div>
  );
}
