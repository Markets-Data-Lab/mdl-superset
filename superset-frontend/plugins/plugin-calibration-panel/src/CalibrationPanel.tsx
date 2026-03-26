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
import { memo, useCallback, useState } from 'react';
import { css, styled } from '@apache-superset/core/ui';
import type {
  CalibrationResult,
  ComparisonMode,
  LoadingState,
  ParsedFile,
  DatasetPayload,
} from './types';
import type { DatasetListItem } from './api';
import {
  fetchDataset,
  snowflakeToPayload,
  fileToPayload,
  runCalibration,
} from './api';
import { FileUploader } from './FileUploader';
import { DatasetPicker } from './DatasetPicker';
import {
  ComparisonPreview,
  buildSummaryFromFile,
  type SourceSummary,
} from './ComparisonPreview';
import { ResultsTabs } from './ResultsTabs';
import { exportResultsToExcel } from './exportToExcel';

export type CalibrationPanelDock = 'left' | 'right';

export interface CalibrationPanelProps {
  defaultDock?: CalibrationPanelDock;
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const PanelContainer = styled.div<{ dock: CalibrationPanelDock }>`
  ${({ theme, dock }) => css`
    display: flex;
    flex-direction: column;
    width: 320px;
    min-width: 320px;
    background-color: ${theme.colorBgContainer};
    border-${dock === 'right' ? 'left' : 'right'}: 1px solid ${theme.colorBorderSecondary};
    grid-column: 3;
    grid-row: 1 / span 2;
    height: 100%;
    overflow-y: auto;
    padding: ${theme.sizeUnit * 4}px;
  `}
`;

const PanelHeader = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: ${theme.sizeUnit * 3}px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    margin-bottom: ${theme.sizeUnit * 3}px;
    font-weight: ${theme.fontWeightStrong};
    font-size: ${theme.fontSizeLG}px;
  `}
`;

const PanelBody = styled.div`
  ${({ theme }) => css`
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 3}px;
  `}
`;

const SectionLabel = styled.label`
  ${({ theme }) => css`
    font-size: ${theme.fontSizeSM}px;
    font-weight: ${theme.fontWeightStrong};
    color: ${theme.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `}
`;

const Section = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit}px;
  `}
`;

const ModeSelect = styled.select`
  ${({ theme }) => css`
    width: 100%;
    padding: ${theme.sizeUnit}px ${theme.sizeUnit * 2}px;
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.sizeUnit}px;
    background: ${theme.colorBgContainer};
    color: ${theme.colorText};
    font-size: ${theme.fontSize}px;
    cursor: pointer;
    &:focus {
      outline: none;
      border-color: ${theme.colorPrimary};
    }
  `}
`;

const RunButton = styled.button<{ disabled: boolean }>`
  ${({ theme, disabled }) => css`
    width: 100%;
    padding: ${theme.sizeUnit * 2}px;
    border: none;
    border-radius: ${theme.sizeUnit}px;
    background: ${disabled ? theme.colorBgTextHover : theme.colorPrimary};
    color: ${theme.colorTextLightSolid};
    font-size: ${theme.fontSize}px;
    font-weight: ${theme.fontWeightStrong};
    cursor: ${disabled ? 'not-allowed' : 'pointer'};
    transition: background 0.2s;
    &:hover {
      background: ${disabled
        ? theme.colorBgTextHover
        : theme.colorPrimaryHover};
    }
  `}
`;

const ExportButton = styled.button`
  ${({ theme }) => css`
    width: 100%;
    padding: ${theme.sizeUnit * 1.5}px;
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.sizeUnit}px;
    background: ${theme.colorBgContainer};
    color: ${theme.colorText};
    font-size: ${theme.fontSizeSM}px;
    cursor: pointer;
    &:hover {
      border-color: ${theme.colorPrimary};
      color: ${theme.colorPrimary};
    }
  `}
`;

const ErrorBanner = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit * 2}px;
    border-radius: ${theme.sizeUnit}px;
    background: ${theme.colorErrorBg};
    color: ${theme.colorError};
    font-size: ${theme.fontSizeSM}px;
    word-break: break-word;
  `}
`;

const Divider = styled.hr`
  ${({ theme }) => css`
    border: none;
    border-top: 1px solid ${theme.colorBorderSecondary};
    margin: 0;
  `}
`;

const StatusText = styled.div`
  ${({ theme }) => css`
    text-align: center;
    color: ${theme.colorTextSecondary};
    font-size: ${theme.fontSizeSM}px;
    padding: ${theme.sizeUnit * 2}px 0;
  `}
`;

// ---------------------------------------------------------------------------
// Mode labels
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: 'file_snowflake', label: 'File vs Snowflake' },
  { value: 'snowflake_snowflake', label: 'Snowflake vs Snowflake' },
  { value: 'file_file', label: 'File vs File' },
];

function sourceNeedsFile(mode: ComparisonMode, side: 'A' | 'B'): boolean {
  if (mode === 'file_file') return true;
  if (mode === 'file_snowflake') return side === 'A';
  return false;
}

// ---------------------------------------------------------------------------
// Loading messages
// ---------------------------------------------------------------------------

const LOADING_MESSAGES: Record<LoadingState, string> = {
  idle: '',
  parsing: 'Parsing file...',
  fetching: 'Fetching dataset metadata...',
  running: 'Running AI calibration...',
  done: '',
  error: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CalibrationPanel = ({ defaultDock = 'right' }: CalibrationPanelProps) => {
  const [dock] = useState<CalibrationPanelDock>(defaultDock);

  // Source selection
  const [mode, setMode] = useState<ComparisonMode>('file_snowflake');
  const [fileA, setFileA] = useState<ParsedFile | null>(null);
  const [fileB, setFileB] = useState<ParsedFile | null>(null);
  const [datasetIdA, setDatasetIdA] = useState<number | null>(null);
  const [datasetIdB, setDatasetIdB] = useState<number | null>(null);
  const [datasetItemA, setDatasetItemA] = useState<DatasetListItem | null>(
    null,
  );
  const [datasetItemB, setDatasetItemB] = useState<DatasetListItem | null>(
    null,
  );

  // Results
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);

  // Track source names for export
  const [sourceAName, setSourceAName] = useState('');
  const [sourceBName, setSourceBName] = useState('');

  // Determine if we can run
  const sourceAReady = sourceNeedsFile(mode, 'A')
    ? fileA !== null
    : datasetIdA !== null;
  const sourceBReady = sourceNeedsFile(mode, 'B')
    ? fileB !== null
    : datasetIdB !== null;
  const canRun = sourceAReady && sourceBReady && loadingState !== 'running';

  // Build preview summaries from selected sources
  const previewA: SourceSummary | null = fileA
    ? buildSummaryFromFile(fileA)
    : null;
  const previewB: SourceSummary | null = fileB
    ? buildSummaryFromFile(fileB)
    : null;

  const resetResults = useCallback(() => {
    setResult(null);
    setError(null);
    setLoadingState('idle');
  }, []);

  const handleModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setMode(e.target.value as ComparisonMode);
      setFileA(null);
      setFileB(null);
      setDatasetIdA(null);
      setDatasetIdB(null);
      setDatasetItemA(null);
      setDatasetItemB(null);
      resetResults();
    },
    [resetResults],
  );

  // Build payload for a side
  const buildPayload = useCallback(
    async (
      side: 'A' | 'B',
    ): Promise<{ payload: DatasetPayload; name: string }> => {
      const needsFile = sourceNeedsFile(mode, side);
      if (needsFile) {
        const file = side === 'A' ? fileA : fileB;
        if (!file) throw new Error(`No file uploaded for Source ${side}`);
        return { payload: fileToPayload(file), name: file.file_name };
      }

      const id = side === 'A' ? datasetIdA : datasetIdB;
      const item = side === 'A' ? datasetItemA : datasetItemB;
      if (!id) throw new Error(`No dataset selected for Source ${side}`);

      setLoadingState('fetching');
      const { meta, sampleRows } = await fetchDataset(id);
      const name = item?.table_name ?? meta.table_name;
      return { payload: snowflakeToPayload(meta, sampleRows), name };
    },
    [mode, fileA, fileB, datasetIdA, datasetIdB, datasetItemA, datasetItemB],
  );

  const handleRun = useCallback(async () => {
    setError(null);
    setResult(null);

    try {
      const payloadA = await buildPayload('A');
      const payloadB = await buildPayload('B');

      setSourceAName(payloadA.name);
      setSourceBName(payloadB.name);

      setLoadingState('running');
      const res = await runCalibration({
        dataset_a: payloadA.payload,
        dataset_b: payloadB.payload,
      });
      setResult(res);
      setLoadingState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration failed');
      setLoadingState('error');
    }
  }, [buildPayload]);

  const handleExport = useCallback(async () => {
    if (!result) return;
    try {
      await exportResultsToExcel(result, sourceAName, sourceBName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [result, sourceAName, sourceBName]);

  const isRunning = loadingState === 'running' || loadingState === 'fetching';

  return (
    <PanelContainer dock={dock} data-test="calibration-panel">
      <PanelHeader>Calibration</PanelHeader>
      <PanelBody>
        {/* Mode selector */}
        <Section>
          <SectionLabel>Comparison type</SectionLabel>
          <ModeSelect value={mode} onChange={handleModeChange}>
            {MODE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </ModeSelect>
        </Section>

        {/* Source A */}
        <Section>
          <SectionLabel>Source A</SectionLabel>
          {sourceNeedsFile(mode, 'A') ? (
            <FileUploader
              label="Source A file"
              parsed={fileA}
              onParsed={f => {
                setFileA(f);
                resetResults();
              }}
              onClear={() => {
                setFileA(null);
                resetResults();
              }}
              disabled={isRunning}
            />
          ) : (
            <DatasetPicker
              label="Source A dataset"
              selectedId={datasetIdA}
              onSelect={(id, item) => {
                setDatasetIdA(id);
                setDatasetItemA(item);
                resetResults();
              }}
              disabled={isRunning}
            />
          )}
        </Section>

        {/* Source B */}
        <Section>
          <SectionLabel>Source B</SectionLabel>
          {sourceNeedsFile(mode, 'B') ? (
            <FileUploader
              label="Source B file"
              parsed={fileB}
              onParsed={f => {
                setFileB(f);
                resetResults();
              }}
              onClear={() => {
                setFileB(null);
                resetResults();
              }}
              disabled={isRunning}
            />
          ) : (
            <DatasetPicker
              label="Source B dataset"
              selectedId={datasetIdB}
              onSelect={(id, item) => {
                setDatasetIdB(id);
                setDatasetItemB(item);
                resetResults();
              }}
              disabled={isRunning}
            />
          )}
        </Section>

        {/* Comparison preview */}
        {(previewA || previewB) && (
          <ComparisonPreview sourceA={previewA} sourceB={previewB} />
        )}

        {/* Run button */}
        <RunButton
          disabled={!canRun || isRunning}
          onClick={handleRun}
          data-test="calibration-run-btn"
        >
          {isRunning ? 'Running...' : 'Run Calibration'}
        </RunButton>

        {/* Loading / error */}
        {isRunning && <StatusText>{LOADING_MESSAGES[loadingState]}</StatusText>}
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {/* Results */}
        {result && (
          <>
            <Divider />
            <ResultsTabs result={result} />
            <ExportButton onClick={handleExport}>Export to Excel</ExportButton>
          </>
        )}
      </PanelBody>
    </PanelContainer>
  );
};

export default memo(CalibrationPanel);
