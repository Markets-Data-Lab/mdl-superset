# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""REST API for AI-powered dataset calibration."""

from __future__ import annotations

import json  # noqa: TID251
import logging
import re
from typing import Any

from flask import request, Response
from flask_appbuilder.api import expose, protect

from superset.views.base_api import BaseSupersetApi, statsd_metrics

logger = logging.getLogger(__name__)


class CalibrationRestApi(BaseSupersetApi):
    """API for AI-powered dataset calibration and comparison."""

    resource_name = "calibration"
    allow_browser_login = True
    class_permission_name = "Calibration"

    @expose("/run", methods=("POST",))
    @protect()
    @statsd_metrics
    def run(self) -> Response:
        """Run AI calibration on two datasets.
        ---
        post:
          summary: Run AI calibration comparing two datasets
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - dataset_a
                    - dataset_b
                  properties:
                    dataset_a:
                      type: object
                    dataset_b:
                      type: object
          responses:
            200:
              description: Calibration results
            400:
              description: Invalid request
            502:
              description: AI service error
        """
        try:
            body = request.json
        except Exception:  # noqa: BLE001
            return self.response_400(message="Invalid JSON body")

        if not body:
            return self.response_400(message="Request body is required")

        dataset_a = body.get("dataset_a")
        dataset_b = body.get("dataset_b")

        for ds, label in [(dataset_a, "dataset_a"), (dataset_b, "dataset_b")]:
            if not ds or not ds.get("name") or not ds.get("columns"):
                return self.response_400(
                    message=f"{label} must include 'name' and 'columns'"
                )

        try:
            result = _run_calibration(dataset_a, dataset_b)
            return self.response(200, result=result)
        except ImportError:
            return self.response(
                502,
                message=(
                    "The anthropic package is not installed. "
                    "Install it with: pip install anthropic"
                ),
            )
        except RuntimeError as exc:
            return self.response(502, message=str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Calibration failed")
            return self.response(502, message=f"Calibration failed: {exc}")


def _run_calibration(
    dataset_a: dict[str, Any], dataset_b: dict[str, Any]
) -> dict[str, Any]:
    try:
        import anthropic
    except ImportError as exc:
        raise ImportError("anthropic package is not installed") from exc

    from flask import current_app

    api_key: str = current_app.config.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured. "
            "Set it in superset_config.py or as an environment variable."
        )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=(
            "You are a senior data engineer specialising in dataset"
            " calibration and record linkage. Return only valid JSON"
            " — no preamble, no markdown fences, no trailing commentary."
        ),
        messages=[
            {
                "role": "user",
                "content": _build_prompt(dataset_a, dataset_b),
            }
        ],
    )

    raw = message.content[0].text.strip()
    return _parse_response(raw)


def _build_prompt(dataset_a: dict[str, Any], dataset_b: dict[str, Any]) -> str:
    def fmt(ds: dict[str, Any]) -> str:
        source = ds.get("source", "snowflake")
        total = ds.get("total_rows")
        total_str = f" ({total:,} total rows, sample shown)" if total else ""
        header = f"Name: {ds['name']}\nSource: {source}{total_str}"
        cols = json.dumps(ds["columns"], indent=2)
        rows = json.dumps(ds.get("sample_rows", [])[:20], indent=2)
        return (
            f"{header}\n"
            f"Columns (with stats where available):\n{cols}\n"
            f"Sample rows:\n{rows}"
        )

    return f"""Analyze these two data sources for calibration and record linkage.
Sources may be Snowflake datasets, Excel files (.xlsx), or CSV files.
Column metadata may include null_pct, unique_estimate, min, max, and sample_values
— use these statistics to improve your analysis quality.

=== SOURCE A ===
{fmt(dataset_a)}

=== SOURCE B ===
{fmt(dataset_b)}

Return a single JSON object with EXACTLY this structure — no other text:

{{{{
  "field_matches": [
    {{{{
      "field_a": "<column from Source A>",
      "field_b": "<column from Source B>",
      "confidence": <float 0.0-1.0>,
      "match_type": "<exact | semantic | partial | derived>",
      "reasoning": "<one sentence>"
    }}}}
  ],
  "anomalies": [
    {{{{
      "dataset": "<A | B>",
      "field": "<column name>",
      "issue": "<concise description of the anomaly>",
      "severity": "<low | medium | high>",
      "affected_estimate": "<e.g. ~15% of rows or all null values>"
    }}}}
  ],
  "corrections": [
    {{{{
      "field_a": "<column from A>",
      "field_b": "<column from B>",
      "correction_type": "<scale | offset | transform | mapping | unit_conversion>",
      "formula": "<human-readable formula or mapping description>",
      "confidence": <float 0.0-1.0>
    }}}}
  ],
  "explanation": "<2-4 sentence plain-English summary>"
}}}}"""


def _parse_response(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"AI returned non-JSON content: {exc}\nFirst 300 chars: {raw[:300]}"
        ) from exc

    required = {"field_matches", "anomalies", "corrections", "explanation"}
    if missing := required - set(parsed.keys()):
        raise ValueError(f"AI response missing required keys: {missing}")

    return parsed
