"""
AI Calibration Lambda
---------------------
Receives two Superset dataset descriptors, calls Anthropic to perform
field matching, anomaly detection, correction suggestions, and plain-English
explanation, and returns structured JSON.

Environment variables required:
  ANTHROPIC_API_KEY   — your Anthropic API key (store in AWS Secrets Manager
                        and inject via Lambda environment variable)
"""

import json
import os
import re
import anthropic


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def lambda_handler(event: dict, context) -> dict:
    # CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return _response(200, {})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Invalid JSON body"})

    dataset_a = body.get("dataset_a")
    dataset_b = body.get("dataset_b")

    for ds, label in [(dataset_a, "dataset_a"), (dataset_b, "dataset_b")]:
        if not ds or not ds.get("name") or not ds.get("columns"):
            return _response(400, {"error": f"{label} must include 'name' and 'columns'"})

    try:
        result = _run_calibration(dataset_a, dataset_b)
        return _response(200, result)
    except anthropic.APIError as exc:
        return _response(502, {"error": f"Anthropic API error: {exc}"})
    except ValueError as exc:
        return _response(502, {"error": f"Failed to parse AI response: {exc}"})
    except Exception as exc:  # noqa: BLE001
        return _response(500, {"error": f"Internal error: {exc}"})


# ---------------------------------------------------------------------------
# Core calibration logic
# ---------------------------------------------------------------------------

def _run_calibration(dataset_a: dict, dataset_b: dict) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable not set")

    client = anthropic.Anthropic(api_key=api_key)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=(
            "You are a senior data engineer specialising in dataset calibration "
            "and record linkage. Return only valid JSON — no preamble, no markdown "
            "fences, no trailing commentary."
        ),
        messages=[{"role": "user", "content": _build_prompt(dataset_a, dataset_b)}],
    )

    raw = message.content[0].text.strip()
    return _parse_response(raw)


def _build_prompt(dataset_a: dict, dataset_b: dict) -> str:
    def fmt(ds: dict) -> str:
        source = ds.get("source", "snowflake")
        total = ds.get("total_rows")
        total_str = f" ({total:,} total rows, sample shown)" if total else ""
        header = f"Name: {ds['name']}\nSource: {source}{total_str}"
        cols = json.dumps(ds["columns"], indent=2)
        rows = json.dumps(ds.get("sample_rows", [])[:20], indent=2)
        return f"{header}\nColumns (with stats where available):\n{cols}\nSample rows:\n{rows}"

    return f"""Analyze these two data sources for calibration and record linkage.
Sources may be Snowflake datasets, Excel files (.xlsx), or CSV files.
Column metadata may include null_pct, unique_estimate, min, max, and sample_values
— use these statistics to improve your analysis quality.

=== SOURCE A ===
{fmt(dataset_a)}

=== SOURCE B ===
{fmt(dataset_b)}

Return a single JSON object with EXACTLY this structure — no other text:

{{
  "field_matches": [
    {{
      "field_a": "<column from Source A>",
      "field_b": "<column from Source B>",
      "confidence": <float 0.0-1.0>,
      "match_type": "<exact | semantic | partial | derived>",
      "reasoning": "<one sentence>"
    }}
  ],
  "anomalies": [
    {{
      "dataset": "<A | B>",
      "field": "<column name>",
      "issue": "<concise description of the anomaly>",
      "severity": "<low | medium | high>",
      "affected_estimate": "<e.g. ~15% of rows or all null values>"
    }}
  ],
  "corrections": [
    {{
      "field_a": "<column from A>",
      "field_b": "<column from B>",
      "correction_type": "<scale | offset | transform | mapping | unit_conversion>",
      "formula": "<human-readable formula or mapping description>",
      "confidence": <float 0.0-1.0>
    }}
  ],
  "explanation": "<2-4 sentence plain-English summary: key findings, main discrepancies, recommended next steps>"
}}"""


def _parse_response(raw: str) -> dict:
    # Strip any accidental markdown fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"AI returned non-JSON content: {exc}\nFirst 300 chars: {raw[:300]}"
        ) from exc

    required = {"field_matches", "anomalies", "corrections", "explanation"}
    missing = required - set(parsed.keys())
    if missing:
        raise ValueError(f"AI response missing required keys: {missing}")

    return parsed


# ---------------------------------------------------------------------------
# HTTP response helper
# ---------------------------------------------------------------------------

def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }
