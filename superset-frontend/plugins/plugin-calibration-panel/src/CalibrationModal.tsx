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
import { useCallback, useState } from 'react';
import { css, styled } from '@apache-superset/core/ui';
import type {
  CalibrationResult,
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
  getCognitoToken,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationModalDataset {
  id: number;
  table_name: string;
}

interface CalibrationModalProps {
  dataset: CalibrationModalDataset;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Overlay = styled.div`
  ${({ theme }) => css`
    position: fixed;
    inset: 0;
    background: ${theme.colorBgMask};
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  `}
`;

const ModalContainer = styled.div`
  ${({ theme }) => css`
    background: ${theme.colorBgContainer};
    border-radius: ${theme.sizeUnit * 2}px;
    width: 680px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: ${theme.boxShadow};
  `}
`;

const ModalHeader = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    font-size: ${theme.fontSizeLG}px;
    font-weight: ${theme.fontWeightStrong};
  `}
`;

const CloseButton = styled.button`
  ${({ theme }) => css`
    background: none;
    border: none;
    font-size: ${theme.fontSizeXL}px;
    color: ${theme.colorTextSecondary};
    cursor: pointer;
    padding: 0;
    line-height: 1;
    &:hover {
      color: ${theme.colorText};
    }
  `}
`;

const ModalBody = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit * 4}px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 3}px;
  `}
`;

const SourceGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${theme.sizeUnit * 3}px;
  `}
`;

const SourceSection = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit}px;
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

const ModeRow = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: ${theme.sizeUnit * 2}px;
  `}
`;

const ModeSelect = styled.select`
  ${({ theme }) => css`
    flex: 1;
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

const LockedDataset = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit * 1.5}px ${theme.sizeUnit * 2}px;
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.sizeUnit}px;
    background: ${theme.colorBgLayout};
    color: ${theme.colorText};
    font-size: ${theme.fontSize}px;
    word-break: break-all;
  `}
`;

const ModalFooter = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: ${theme.sizeUnit * 2}px;
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    border-top: 1px solid ${theme.colorBorderSecondary};
  `}
`;

const ActionButton = styled.button<{
  variant: 'primary' | 'secondary' | 'default';
  isDisabled?: boolean;
}>`
  ${({ theme, variant, isDisabled }) => css`
    padding: ${theme.sizeUnit * 1.5}px ${theme.sizeUnit * 4}px;
    border-radius: ${theme.sizeUnit}px;
    font-size: ${theme.fontSize}px;
    font-weight: ${theme.fontWeightStrong};
    cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
    transition: all 0.2s;
    border: 1px solid
      ${variant === 'primary'
        ? 'transparent'
        : variant === 'secondary'
          ? theme.colorPrimary
          : theme.colorBorderSecondary};
    background: ${variant === 'primary'
      ? isDisabled
        ? theme.colorBgTextHover
        : theme.colorPrimary
      : theme.colorBgContainer};
    color: ${variant === 'primary'
      ? theme.colorTextLightSolid
      : variant === 'secondary'
        ? theme.colorPrimary
        : theme.colorText};
    &:hover {
      opacity: ${isDisabled ? 1 : 0.85};
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

const StatusText = styled.div`
  ${({ theme }) => css`
    text-align: center;
    color: ${theme.colorTextSecondary};
    font-size: ${theme.fontSizeSM}px;
    padding: ${theme.sizeUnit * 2}px 0;
  `}
`;

const Divider = styled.hr`
  ${({ theme }) => css`
    border: none;
    border-top: 1px solid ${theme.colorBorderSecondary};
    margin: 0;
  `}
`;

// ---------------------------------------------------------------------------
// Mode helpers
// ---------------------------------------------------------------------------

type SourceBMode = 'snowflake' | 'file';

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

export function CalibrationModal({ dataset, onClose }: CalibrationModalProps) {
  // Source A is always the pre-selected Snowflake dataset
  // Source B can be file or another Snowflake dataset
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('file');
  const [fileB, setFileB] = useState<ParsedFile | null>(null);
  const [datasetIdB, setDatasetIdB] = useState<number | null>(null);
  const [datasetItemB, setDatasetItemB] = useState<DatasetListItem | null>(
    null,
  );

  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [sourceAName, setSourceAName] = useState(dataset.table_name);
  const [sourceBName, setSourceBName] = useState('');

  const sourceBReady =
    sourceBMode === 'file' ? fileB !== null : datasetIdB !== null;
  const canRun = sourceBReady && loadingState !== 'running';
  const isRunning = loadingState === 'running' || loadingState === 'fetching';

  // Preview summaries
  const previewB: SourceSummary | null = fileB
    ? buildSummaryFromFile(fileB)
    : null;

  const resetResults = useCallback(() => {
    setResult(null);
    setError(null);
    setLoadingState('idle');
  }, []);

  const handleRun = useCallback(async () => {
    setError(null);
    setResult(null);

    try {
      // Build Source A payload (always Snowflake)
      setLoadingState('fetching');
      const { meta: metaA, sampleRows: samplesA } = await fetchDataset(
        dataset.id,
      );
      const payloadA = snowflakeToPayload(metaA, samplesA);
      const nameA = metaA.table_name;
      setSourceAName(nameA);

      // Build Source B payload
      let payloadB: DatasetPayload;
      let nameB: string;
      if (sourceBMode === 'file') {
        if (!fileB) throw new Error('No file uploaded for Source B');
        payloadB = fileToPayload(fileB);
        nameB = fileB.file_name;
      } else {
        if (!datasetIdB) throw new Error('No dataset selected for Source B');
        const { meta: metaB, sampleRows: samplesB } =
          await fetchDataset(datasetIdB);
        payloadB = snowflakeToPayload(metaB, samplesB);
        nameB = datasetItemB?.table_name ?? metaB.table_name;
      }
      setSourceBName(nameB);

      setLoadingState('running');
      const token = getCognitoToken();
      const res = await runCalibration(
        { dataset_a: payloadA, dataset_b: payloadB },
        token,
      );
      setResult(res);
      setLoadingState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration failed');
      setLoadingState('error');
    }
  }, [dataset.id, sourceBMode, fileB, datasetIdB, datasetItemB]);

  const handleExport = useCallback(async () => {
    if (!result) return;
    try {
      await exportResultsToExcel(result, sourceAName, sourceBName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [result, sourceAName, sourceBName]);

  return (
    <Overlay onClick={onClose}>
      <ModalContainer
        onClick={e => e.stopPropagation()}
        data-test="calibration-modal"
      >
        <ModalHeader>
          Compare / Calibrate
          <CloseButton onClick={onClose}>&times;</CloseButton>
        </ModalHeader>

        <ModalBody>
          {/* Source selection */}
          <SourceGrid>
            {/* Source A — locked to selected dataset */}
            <SourceSection>
              <SectionLabel>Source A (Snowflake)</SectionLabel>
              <LockedDataset>{dataset.table_name}</LockedDataset>
            </SourceSection>

            {/* Source B — file or another dataset */}
            <SourceSection>
              <SectionLabel>Source B</SectionLabel>
              <ModeRow>
                <ModeSelect
                  value={sourceBMode}
                  onChange={e => {
                    setSourceBMode(e.target.value as SourceBMode);
                    setFileB(null);
                    setDatasetIdB(null);
                    setDatasetItemB(null);
                    resetResults();
                  }}
                >
                  <option value="file">File upload</option>
                  <option value="snowflake">Snowflake dataset</option>
                </ModeSelect>
              </ModeRow>
              {sourceBMode === 'file' ? (
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
            </SourceSection>
          </SourceGrid>

          {/* Comparison preview */}
          {previewB && (
            <ComparisonPreview
              sourceA={{
                name: dataset.table_name,
                columns: [],
                totalRows: undefined,
              }}
              sourceB={previewB}
            />
          )}

          {/* Status */}
          {isRunning && (
            <StatusText>{LOADING_MESSAGES[loadingState]}</StatusText>
          )}
          {error && <ErrorBanner>{error}</ErrorBanner>}

          {/* Results */}
          {result && (
            <>
              <Divider />
              <ResultsTabs result={result} />
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {result && (
            <ActionButton variant="secondary" onClick={handleExport}>
              Export to Excel
            </ActionButton>
          )}
          <ActionButton variant="default" onClick={onClose}>
            Close
          </ActionButton>
          <ActionButton
            variant="primary"
            isDisabled={!canRun || isRunning}
            onClick={canRun && !isRunning ? handleRun : undefined}
          >
            {isRunning ? 'Running...' : 'Run Calibration'}
          </ActionButton>
        </ModalFooter>
      </ModalContainer>
    </Overlay>
  );
}
