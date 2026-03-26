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
import { useCallback, useEffect, useState } from 'react';
import { css, styled } from '@apache-superset/core/ui';
import { fetchDatasetList, type DatasetListItem } from './api';

const Wrapper = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit}px;
  `}
`;

const StyledSelect = styled.select`
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
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `}
`;

const ErrorText = styled.span`
  ${({ theme }) => css`
    color: ${theme.colorError};
    font-size: ${theme.fontSizeSM}px;
  `}
`;

interface DatasetPickerProps {
  label: string;
  selectedId: number | null;
  onSelect: (id: number | null, item: DatasetListItem | null) => void;
  disabled?: boolean;
}

export function DatasetPicker({
  label,
  selectedId,
  onSelect,
  disabled = false,
}: DatasetPickerProps) {
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDatasetList()
      .then(list => {
        if (!cancelled) setDatasets(list);
      })
      .catch(err => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (!val) {
        onSelect(null, null);
        return;
      }
      const id = Number(val);
      const item = datasets.find(d => d.id === id) ?? null;
      onSelect(id, item);
    },
    [datasets, onSelect],
  );

  return (
    <Wrapper>
      <StyledSelect
        value={selectedId ?? ''}
        onChange={handleChange}
        disabled={disabled || loading}
      >
        <option value="">
          {loading ? 'Loading datasets...' : `Select ${label}`}
        </option>
        {datasets.map(d => (
          <option key={d.id} value={d.id}>
            {d.database?.database_name
              ? `${d.database.database_name}.${d.schema}.${d.table_name}`
              : d.table_name}
          </option>
        ))}
      </StyledSelect>
      {error && <ErrorText>{error}</ErrorText>}
    </Wrapper>
  );
}
