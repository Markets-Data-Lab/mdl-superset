import React, { useState, useCallback, useEffect, useRef } from 'react';
import { styled } from '@superset-ui/core';
import type {
  CalibrationResult,
  ComparisonMode,
  DockPosition,
  ActiveTab,
  LoadingState,
  FieldMatch,
  Anomaly,
  Correction,
  ParsedFile,
} from './types';
import {
  fetchDataset,
  fetchDatasetList,
  snowflakeToPayload,
  fileToPayload,
  runCalibration,
  getCognitoToken,
  type DatasetListItem,
} from './api';
import { FileUploader } from './FileUploader';
import { exportResultsToExcel } from './exportToExcel';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const PanelWrapper = styled.div<{ dock: DockPosition }>`
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.grayscale.light5};
  border: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
  border-radius: ${({ theme }) => theme.gridUnit}px;
  font-family: ${({ theme }) => theme.typography.families.sansSerif};
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  overflow: hidden;
  height: ${({ dock }) => dock === 'bottom' ? '380px' : '100%'};
  width: ${({ dock }) =>
    dock === 'left' || dock === 'right' ? '400px' : '100%'};
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.gridUnit * 2}px ${theme.gridUnit * 3}px`};
  background: ${({ theme }) => theme.colors.primary.dark1};
  color: #fff;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  flex-shrink: 0;
`;

const DockControls = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.gridUnit}px;
`;

const DockBtn = styled.button<{ active: boolean }>`
  background: ${({ active, theme }) => active ? theme.colors.primary.light1 : 'transparent'};
  border: 1px solid ${({ active }) => active ? 'transparent' : 'rgba(255,255,255,0.4)'};
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 8px;
  &:hover { background: ${({ theme }) => theme.colors.primary.light1}; border-color: transparent; }
`;

const PanelBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.gridUnit * 2}px;
  padding: ${({ theme }) => theme.gridUnit * 2}px;
  overflow-y: auto;
  flex: 1;
`;

// Mode selector tabs
const ModeBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
`;

const ModeTab = styled.button<{ active: boolean }>`
  background: transparent;
  border: none;
  border-bottom: 2px solid ${({ active, theme }) =>
    active ? theme.colors.primary.base : 'transparent'};
  color: ${({ active, theme }) =>
    active ? theme.colors.primary.base : theme.colors.grayscale.base};
  cursor: pointer;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ active, theme }) =>
    active ? theme.typography.weights.bold : theme.typography.weights.normal};
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  white-space: nowrap;
  &:hover { color: ${({ theme }) => theme.colors.primary.base}; }
`;

const SectionLabel = styled.label`
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.grayscale.dark1};
  margin-bottom: 4px;
  display: block;
`;

const SourceGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.gridUnit * 2}px;
  align-items: start;
`;

const SourceColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Select = styled.select`
  border: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
  border-radius: 4px;
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  background: #fff;
  color: ${({ theme }) => theme.colors.grayscale.dark2};
  width: 100%;
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.primary.base}; }
`;

const RunButton = styled.button`
  background: ${({ theme }) => theme.colors.primary.base};
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 4}px`};
  width: 100%;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.primary.dark1}; }
`;

const DownloadButton = styled.button`
  align-items: center;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.success.base};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.success.dark1};
  cursor: pointer;
  display: flex;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  gap: 6px;
  justify-content: center;
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 3}px`};
  width: 100%;
  &:hover {
    background: ${({ theme }) => theme.colors.success.light1};
  }
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
`;

const Tab = styled.button<{ active: boolean }>`
  background: transparent;
  border: none;
  border-bottom: 2px solid ${({ active, theme }) =>
    active ? theme.colors.primary.base : 'transparent'};
  color: ${({ active, theme }) =>
    active ? theme.colors.primary.base : theme.colors.grayscale.base};
  cursor: pointer;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ active, theme }) =>
    active ? theme.typography.weights.bold : theme.typography.weights.normal};
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  &:hover { color: ${({ theme }) => theme.colors.primary.base}; }
`;

const Badge = styled.span<{ variant: 'success' | 'warning' | 'danger' | 'neutral' }>`
  border-radius: 10px;
  font-size: 10px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  margin-left: 4px;
  padding: 1px 6px;
  ${({ variant, theme }) => {
    switch (variant) {
      case 'success': return `background:${theme.colors.success.light1};color:${theme.colors.success.dark1};`;
      case 'warning': return `background:${theme.colors.warning.light1};color:${theme.colors.warning.dark1};`;
      case 'danger':  return `background:${theme.colors.error.light1};color:${theme.colors.error.dark1};`;
      default:        return `background:${theme.colors.grayscale.light2};color:${theme.colors.grayscale.dark1};`;
    }
  }}
`;

const TableWrap = styled.div` overflow-x: auto; `;

const StyledTable = styled.table`
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  width: 100%;
`;

const Th = styled.th`
  background: ${({ theme }) => theme.colors.grayscale.light4};
  border-bottom: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
  color: ${({ theme }) => theme.colors.grayscale.dark1};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  text-align: left;
  white-space: nowrap;
`;

const Td = styled.td`
  border-bottom: 1px solid ${({ theme }) => theme.colors.grayscale.light3};
  color: ${({ theme }) => theme.colors.grayscale.dark2};
  padding: ${({ theme }) => `${theme.gridUnit}px ${theme.gridUnit * 2}px`};
  vertical-align: top;
`;

const Code = styled.code`
  background: ${({ theme }) => theme.colors.grayscale.light3};
  border-radius: 3px;
  font-family: ${({ theme }) => theme.typography.families.monospace};
  font-size: 11px;
  padding: 1px 5px;
`;

const ExplanationBox = styled.div`
  background: ${({ theme }) => theme.colors.primary.light4};
  border-left: 3px solid ${({ theme }) => theme.colors.primary.base};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.grayscale.dark2};
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  line-height: 1.6;
  padding: ${({ theme }) => theme.gridUnit * 2}px;
`;

const StatusLine = styled.div<{ variant?: 'error' }>`
  color: ${({ variant, theme }) =>
    variant === 'error' ? theme.colors.error.base : theme.colors.grayscale.base};
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  padding: ${({ theme }) => theme.gridUnit}px 0;
  text-align: center;
`;

const EmptyState = styled.div`
  color: ${({ theme }) => theme.colors.grayscale.base};
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  padding: ${({ theme }) => theme.gridUnit * 2}px;
  text-align: center;
`;

const Divider = styled.div`
  align-items: center;
  color: ${({ theme }) => theme.colors.grayscale.base};
  display: flex;
  font-size: 11px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  gap: ${({ theme }) => theme.gridUnit}px;
  justify-content: center;
  &::before, &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${({ theme }) => theme.colors.grayscale.light2};
  }
`;

// ---------------------------------------------------------------------------
// Result sub-components
// ---------------------------------------------------------------------------

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const variant = value >= 0.8 ? 'success' : value >= 0.5 ? 'warning' : 'danger';
  return <Badge variant={variant}>{pct}%</Badge>;
}

function SeverityBadge({ sev }: { sev: string }) {
  const variant = sev === 'high' ? 'danger' : sev === 'medium' ? 'warning' : 'success';
  return <Badge variant={variant} style={{ textTransform: 'capitalize' }}>{sev}</Badge>;
}

function MatchesTab({ matches }: { matches: FieldMatch[] }) {
  if (!matches.length) return <EmptyState>No field matches identified.</EmptyState>;
  return (
    <TableWrap>
      <StyledTable>
        <thead><tr>{['Source A field','Source B field','Type','Confidence','Reasoning'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>
          {matches.map((m, i) => (
            <tr key={i}>
              <Td><Code>{m.field_a}</Code></Td>
              <Td><Code>{m.field_b}</Code></Td>
              <Td><Badge variant="neutral">{m.match_type}</Badge></Td>
              <Td><ConfidenceBadge value={m.confidence} /></Td>
              <Td>{m.reasoning}</Td>
            </tr>
          ))}
        </tbody>
      </StyledTable>
    </TableWrap>
  );
}

function AnomaliesTab({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies.length) return <EmptyState>No anomalies detected.</EmptyState>;
  return (
    <TableWrap>
      <StyledTable>
        <thead><tr>{['Source','Field','Issue','Severity','Affected'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>
          {anomalies.map((a, i) => (
            <tr key={i}>
              <Td><Badge variant="neutral">{a.dataset}</Badge></Td>
              <Td><Code>{a.field}</Code></Td>
              <Td>{a.issue}</Td>
              <Td><SeverityBadge sev={a.severity} /></Td>
              <Td>{a.affected_estimate}</Td>
            </tr>
          ))}
        </tbody>
      </StyledTable>
    </TableWrap>
  );
}

function CorrectionsTab({ corrections }: { corrections: Correction[] }) {
  if (!corrections.length) return <EmptyState>No corrections suggested.</EmptyState>;
  return (
    <TableWrap>
      <StyledTable>
        <thead><tr>{['Source A field','Source B field','Type','Formula / mapping','Confidence'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>
          {corrections.map((c, i) => (
            <tr key={i}>
              <Td><Code>{c.field_a}</Code></Td>
              <Td><Code>{c.field_b}</Code></Td>
              <Td><Badge variant="neutral">{c.correction_type}</Badge></Td>
              <Td><Code>{c.formula}</Code></Td>
              <Td><ConfidenceBadge value={c.confidence} /></Td>
            </tr>
          ))}
        </tbody>
      </StyledTable>
    </TableWrap>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface CalibrationPanelProps {
  defaultDock?: DockPosition;
}

const MODES: { key: ComparisonMode; label: string }[] = [
  { key: 'snowflake_snowflake', label: 'Snowflake vs Snowflake' },
  { key: 'file_snowflake',      label: 'File vs Snowflake' },
  { key: 'file_file',           label: 'File vs File' },
];

export function CalibrationPanel({ defaultDock = 'right' }: CalibrationPanelProps) {
  const [dock, setDock] = useState<DockPosition>(defaultDock);
  const [mode, setMode] = useState<ComparisonMode>('snowflake_snowflake');

  // Snowflake state
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [dsIdA, setDsIdA] = useState<number | null>(null);
  const [dsIdB, setDsIdB] = useState<number | null>(null);
  const datasetsLoaded = useRef(false);

  // File state
  const [fileA, setFileA] = useState<ParsedFile | null>(null);
  const [fileB, setFileB] = useState<ParsedFile | null>(null);

  // Results
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('matches');
  const [downloading, setDownloading] = useState(false);

  // Load Snowflake dataset list when needed
  useEffect(() => {
    if (
      (mode === 'snowflake_snowflake' || mode === 'file_snowflake') &&
      !datasetsLoaded.current
    ) {
      datasetsLoaded.current = true;
      fetchDatasetList()
        .then(setDatasets)
        .catch(() => setError('Could not load Snowflake dataset list.'));
    }
  }, [mode]);

  // Clear results when mode changes
  const handleModeChange = (m: ComparisonMode) => {
    setMode(m);
    setResult(null);
    setError(null);
    setLoadingState('idle');
  };

  // Can we run?
  const canRun = (() => {
    if (loadingState === 'running') return false;
    if (mode === 'snowflake_snowflake') return dsIdA !== null && dsIdB !== null && dsIdA !== dsIdB;
    if (mode === 'file_snowflake')      return fileA !== null && dsIdB !== null;
    if (mode === 'file_file')           return fileA !== null && fileB !== null;
    return false;
  })();

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setError(null);
    setResult(null);

    try {
      let payloadA, payloadB;

      if (mode === 'snowflake_snowflake') {
        setLoadingState('fetching');
        setStatusMsg('Fetching Snowflake dataset metadata…');
        const [resA, resB] = await Promise.all([
          fetchDataset(dsIdA!),
          fetchDataset(dsIdB!),
        ]);
        payloadA = snowflakeToPayload(resA.meta, resA.sampleRows);
        payloadB = snowflakeToPayload(resB.meta, resB.sampleRows);

      } else if (mode === 'file_snowflake') {
        setLoadingState('fetching');
        setStatusMsg('Fetching Snowflake dataset metadata…');
        const resB = await fetchDataset(dsIdB!);
        payloadA = fileToPayload(fileA!);
        payloadB = snowflakeToPayload(resB.meta, resB.sampleRows);

      } else {
        // file_file — both already parsed
        payloadA = fileToPayload(fileA!);
        payloadB = fileToPayload(fileB!);
      }

      setLoadingState('running');
      setStatusMsg('Running AI calibration analysis…');
      const token = getCognitoToken();
      const calibrationResult = await runCalibration({ dataset_a: payloadA, dataset_b: payloadB }, token);
      setResult(calibrationResult);
      setActiveTab('matches');
      setLoadingState('done');
      setStatusMsg('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setLoadingState('error');
      setStatusMsg('');
    }
  }, [canRun, mode, dsIdA, dsIdB, fileA, fileB]);

  const handleDownload = useCallback(async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const nameA =
        mode === 'snowflake_snowflake'
          ? datasets.find(d => d.id === dsIdA)?.table_name ?? 'Source A'
          : fileA?.file_name ?? 'Source A';
      const nameB =
        mode === 'file_file'
          ? fileB?.file_name ?? 'Source B'
          : datasets.find(d => d.id === dsIdB)?.table_name ?? 'Source B';
      await exportResultsToExcel(
        result,
        nameA,
        nameB,
        fileA?.total_rows,
        mode === 'file_file' ? fileB?.total_rows : undefined,
      );
    } finally {
      setDownloading(false);
    }
  }, [result, mode, datasets, dsIdA, dsIdB, fileA, fileB]);

  return (
    <PanelWrapper dock={dock}>
      {/* Header */}
      <PanelHeader>
        <span>AI Calibration</span>
        <DockControls>
          {(['left', 'bottom', 'right'] as DockPosition[]).map(d => (
            <DockBtn key={d} active={dock === d} onClick={() => setDock(d)}>
              {d === 'left' ? '◧' : d === 'bottom' ? '⬛' : '▨'} {d}
            </DockBtn>
          ))}
        </DockControls>
      </PanelHeader>

      <PanelBody>
        {/* Mode selector */}
        <ModeBar>
          {MODES.map(m => (
            <ModeTab
              key={m.key}
              active={mode === m.key}
              onClick={() => handleModeChange(m.key)}
            >
              {m.label}
            </ModeTab>
          ))}
        </ModeBar>

        {/* Source inputs */}
        <SourceGrid>
          {/* ── Source A ── */}
          <SourceColumn>
            <SectionLabel>Source A</SectionLabel>
            {mode === 'snowflake_snowflake' ? (
              <Select
                value={dsIdA ?? ''}
                onChange={e => setDsIdA(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select dataset —</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.database?.database_name ? `${d.database.database_name} / ` : ''}
                    {d.schema ? `${d.schema}.` : ''}{d.table_name}
                  </option>
                ))}
              </Select>
            ) : (
              <FileUploader
                label="file A"
                parsed={fileA}
                onParsed={setFileA}
                onClear={() => setFileA(null)}
              />
            )}
          </SourceColumn>

          {/* ── Source B ── */}
          <SourceColumn>
            <SectionLabel>Source B</SectionLabel>
            {mode === 'file_file' ? (
              <FileUploader
                label="file B"
                parsed={fileB}
                onParsed={setFileB}
                onClear={() => setFileB(null)}
              />
            ) : (
              <Select
                value={dsIdB ?? ''}
                onChange={e => setDsIdB(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select dataset —</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.database?.database_name ? `${d.database.database_name} / ` : ''}
                    {d.schema ? `${d.schema}.` : ''}{d.table_name}
                  </option>
                ))}
              </Select>
            )}
          </SourceColumn>
        </SourceGrid>

        <RunButton onClick={handleRun} disabled={!canRun}>
          {loadingState === 'running' || loadingState === 'fetching'
            ? 'Analyzing…'
            : 'Run calibration'}
        </RunButton>

        {/* Status / error */}
        {statusMsg && <StatusLine>{statusMsg}</StatusLine>}
        {error && <StatusLine variant="error">{error}</StatusLine>}

        {/* Results */}
        {result && (
          <>
            <Divider>Results</Divider>
            <DownloadButton onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Preparing download…' : 'Download Excel report'}
            </DownloadButton>
            <TabBar>
              <Tab active={activeTab === 'matches'} onClick={() => setActiveTab('matches')}>
                Field matches<Badge variant="neutral">{result.field_matches.length}</Badge>
              </Tab>
              <Tab active={activeTab === 'anomalies'} onClick={() => setActiveTab('anomalies')}>
                Anomalies
                <Badge variant={result.anomalies.some(a => a.severity === 'high') ? 'danger' : 'warning'}>
                  {result.anomalies.length}
                </Badge>
              </Tab>
              <Tab active={activeTab === 'corrections'} onClick={() => setActiveTab('corrections')}>
                Corrections<Badge variant="neutral">{result.corrections.length}</Badge>
              </Tab>
              <Tab active={activeTab === 'explanation'} onClick={() => setActiveTab('explanation')}>
                Explanation
              </Tab>
            </TabBar>

            {activeTab === 'matches'     && <MatchesTab     matches={result.field_matches} />}
            {activeTab === 'anomalies'   && <AnomaliesTab   anomalies={result.anomalies} />}
            {activeTab === 'corrections' && <CorrectionsTab corrections={result.corrections} />}
            {activeTab === 'explanation' && <ExplanationBox>{result.explanation}</ExplanationBox>}
          </>
        )}
      </PanelBody>
    </PanelWrapper>
  );
}

export default CalibrationPanel;
