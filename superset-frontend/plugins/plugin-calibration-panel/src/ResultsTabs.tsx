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
import { css, styled, useTheme } from '@apache-superset/core/ui';
import type {
  ActiveTab,
  CalibrationResult,
  FieldMatch,
  Anomaly,
  Correction,
} from './types';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const TabBar = styled.div`
  ${({ theme }) => css`
    display: flex;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    margin-bottom: ${theme.sizeUnit * 2}px;
    gap: 0;
  `}
`;

const Tab = styled.button<{ active: boolean }>`
  ${({ theme, active }) => css`
    flex: 1;
    padding: ${theme.sizeUnit}px ${theme.sizeUnit / 2}px;
    border: none;
    border-bottom: 2px solid ${active ? theme.colorPrimary : 'transparent'};
    background: transparent;
    color: ${active ? theme.colorPrimary : theme.colorTextSecondary};
    font-size: ${theme.fontSizeSM}px;
    font-weight: ${active ? theme.fontWeightStrong : 'normal'};
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      color: ${theme.colorPrimary};
    }
  `}
`;

const TabContent = styled.div`
  ${({ theme }) => css`
    overflow-y: auto;
    flex: 1;
    font-size: ${theme.fontSizeSM}px;
  `}
`;

const Card = styled.div`
  ${({ theme }) => css`
    background: ${theme.colorBgLayout};
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.sizeUnit}px;
    padding: ${theme.sizeUnit * 2}px;
    margin-bottom: ${theme.sizeUnit}px;
  `}
`;

const CardTitle = styled.div`
  ${({ theme }) => css`
    font-weight: ${theme.fontWeightStrong};
    margin-bottom: ${theme.sizeUnit / 2}px;
    word-break: break-word;
  `}
`;

const CardMeta = styled.div`
  ${({ theme }) => css`
    color: ${theme.colorTextSecondary};
    font-size: 11px;
    margin-bottom: ${theme.sizeUnit / 2}px;
  `}
`;

const Badge = styled.span<{ bg: string; fg: string }>`
  ${({ bg, fg }) => css`
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    background: ${bg};
    color: ${fg};
  `}
`;

const ExplanationText = styled.div`
  ${({ theme }) => css`
    white-space: pre-wrap;
    line-height: 1.5;
    color: ${theme.colorText};
  `}
`;

const EmptyState = styled.div`
  ${({ theme }) => css`
    text-align: center;
    color: ${theme.colorTextSecondary};
    padding: ${theme.sizeUnit * 4}px 0;
  `}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ThemeColors {
  success: string;
  warning: string;
  error: string;
  textLightSolid: string;
}

function confidenceColor(confidence: number, colors: ThemeColors): string {
  if (confidence >= 0.8) return colors.success;
  if (confidence >= 0.5) return colors.warning;
  return colors.error;
}

function severityColor(
  severity: 'low' | 'medium' | 'high',
  colors: ThemeColors,
): string {
  if (severity === 'high') return colors.error;
  if (severity === 'medium') return colors.warning;
  return colors.success;
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function MatchesTab({
  matches,
  colors,
}: {
  matches: FieldMatch[];
  colors: ThemeColors;
}) {
  if (!matches.length) return <EmptyState>No field matches found</EmptyState>;
  return (
    <>
      {matches.map((m, i) => (
        <Card key={i}>
          <CardTitle>
            {m.field_a} &harr; {m.field_b}
          </CardTitle>
          <CardMeta>
            <Badge
              bg={confidenceColor(m.confidence, colors)}
              fg={colors.textLightSolid}
            >
              {Math.round(m.confidence * 100)}%
            </Badge>{' '}
            {m.match_type}
          </CardMeta>
          <div>{m.reasoning}</div>
        </Card>
      ))}
    </>
  );
}

function AnomaliesTab({
  anomalies,
  colors,
}: {
  anomalies: Anomaly[];
  colors: ThemeColors;
}) {
  if (!anomalies.length) return <EmptyState>No anomalies detected</EmptyState>;
  return (
    <>
      {anomalies.map((a, i) => (
        <Card key={i}>
          <CardTitle>
            Dataset {a.dataset}: {a.field}
          </CardTitle>
          <CardMeta>
            <Badge
              bg={severityColor(a.severity, colors)}
              fg={colors.textLightSolid}
            >
              {a.severity}
            </Badge>{' '}
            ~{a.affected_estimate} affected
          </CardMeta>
          <div>{a.issue}</div>
        </Card>
      ))}
    </>
  );
}

function CorrectionsTab({
  corrections,
  colors,
}: {
  corrections: Correction[];
  colors: ThemeColors;
}) {
  if (!corrections.length)
    return <EmptyState>No corrections suggested</EmptyState>;
  return (
    <>
      {corrections.map((c, i) => (
        <Card key={i}>
          <CardTitle>
            {c.field_a} &rarr; {c.field_b}
          </CardTitle>
          <CardMeta>
            <Badge
              bg={confidenceColor(c.confidence, colors)}
              fg={colors.textLightSolid}
            >
              {Math.round(c.confidence * 100)}%
            </Badge>{' '}
            {c.correction_type}
          </CardMeta>
          <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
            {c.formula}
          </code>
        </Card>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ResultsTabsProps {
  result: CalibrationResult;
}

const TABS: { key: ActiveTab; label: string }[] = [
  { key: 'matches', label: 'Matches' },
  { key: 'anomalies', label: 'Anomalies' },
  { key: 'corrections', label: 'Fixes' },
  { key: 'explanation', label: 'Summary' },
];

export function ResultsTabs({ result }: ResultsTabsProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('matches');
  const theme = useTheme();
  const colors: ThemeColors = {
    success: theme.colorSuccess,
    warning: theme.colorWarning,
    error: theme.colorError,
    textLightSolid: theme.colorTextLightSolid,
  };

  return (
    <>
      <TabBar>
        {TABS.map(t => (
          <Tab
            key={t.key}
            active={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {t.key === 'matches' && ` (${result.field_matches.length})`}
            {t.key === 'anomalies' && ` (${result.anomalies.length})`}
            {t.key === 'corrections' && ` (${result.corrections.length})`}
          </Tab>
        ))}
      </TabBar>
      <TabContent>
        {activeTab === 'matches' && (
          <MatchesTab matches={result.field_matches} colors={colors} />
        )}
        {activeTab === 'anomalies' && (
          <AnomaliesTab anomalies={result.anomalies} colors={colors} />
        )}
        {activeTab === 'corrections' && (
          <CorrectionsTab corrections={result.corrections} colors={colors} />
        )}
        {activeTab === 'explanation' && (
          <ExplanationText>{result.explanation}</ExplanationText>
        )}
      </TabContent>
    </>
  );
}
