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
import { memo, useState } from 'react';
import { css, styled } from '@apache-superset/core/ui';

export type CalibrationPanelDock = 'left' | 'right';

export interface CalibrationPanelProps {
  defaultDock?: CalibrationPanelDock;
}

const PanelContainer = styled.div<{ dock: CalibrationPanelDock }>`
  ${({ theme, dock }) => css`
    display: flex;
    flex-direction: column;
    width: 320px;
    min-width: 320px;
    background-color: ${theme.colorBgContainer};
    border-${dock === 'right' ? 'left' : 'right'}: 1px solid ${theme.colorBorderSecondary};
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
  flex: 1;
`;

const CalibrationPanel = ({ defaultDock = 'right' }: CalibrationPanelProps) => {
  const [dock] = useState<CalibrationPanelDock>(defaultDock);

  return (
    <PanelContainer dock={dock} data-test="calibration-panel">
      <PanelHeader>Calibration</PanelHeader>
      <PanelBody />
    </PanelContainer>
  );
};

export default memo(CalibrationPanel);
