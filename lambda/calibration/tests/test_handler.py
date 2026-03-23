"""
Unit tests for the calibration Lambda handler.
Run with: pytest lambda/calibration/tests/
"""

import json
import pytest
from unittest.mock import MagicMock, patch

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler


DATASET_A = {
    "name": "sales_2023",
    "columns": [
        {"name": "sale_id", "type": "BIGINT"},
        {"name": "customer_id", "type": "BIGINT"},
        {"name": "revenue_usd", "type": "FLOAT"},
        {"name": "sale_date", "type": "DATE"},
    ],
    "sample_rows": [
        {"sale_id": 1, "customer_id": 101, "revenue_usd": 250.0, "sale_date": "2023-01-15"},
    ],
}

DATASET_B = {
    "name": "orders_2023",
    "columns": [
        {"name": "order_id", "type": "BIGINT"},
        {"name": "cust_id", "type": "BIGINT"},
        {"name": "amount", "type": "DECIMAL"},
        {"name": "order_dt", "type": "TIMESTAMP"},
    ],
    "sample_rows": [
        {"order_id": 1, "cust_id": 101, "amount": 250.0, "order_dt": "2023-01-15T00:00:00"},
    ],
}

MOCK_AI_RESPONSE = {
    "field_matches": [
        {
            "field_a": "sale_id",
            "field_b": "order_id",
            "confidence": 0.95,
            "match_type": "semantic",
            "reasoning": "Both are primary identifier fields of the same integer type.",
        }
    ],
    "anomalies": [
        {
            "dataset": "B",
            "field": "order_dt",
            "issue": "Timestamp includes time component while Dataset A uses plain DATE.",
            "severity": "low",
            "affected_estimate": "100% of rows",
        }
    ],
    "corrections": [
        {
            "field_a": "revenue_usd",
            "field_b": "amount",
            "correction_type": "unit_conversion",
            "formula": "revenue_usd = amount (no conversion needed; both in USD)",
            "confidence": 0.9,
        }
    ],
    "explanation": "The two datasets appear to represent the same transactions from different systems. Field names differ but semantics align closely. The main discrepancy is the timestamp precision in Dataset B.",
}


def _make_event(body: dict, method: str = "POST") -> dict:
    return {"httpMethod": method, "body": json.dumps(body)}


# ---------------------------------------------------------------------------
# CORS preflight
# ---------------------------------------------------------------------------

def test_options_returns_200():
    event = {"httpMethod": "OPTIONS"}
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == 200


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_missing_dataset_a_returns_400():
    event = _make_event({"dataset_b": DATASET_B})
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == 400
    assert "dataset_a" in json.loads(resp["body"])["error"]


def test_missing_columns_returns_400():
    event = _make_event({"dataset_a": {"name": "x"}, "dataset_b": DATASET_B})
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == 400


def test_invalid_json_returns_400():
    event = {"httpMethod": "POST", "body": "not-json"}
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == 400


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"})
@patch("handler.anthropic.Anthropic")
def test_successful_calibration(mock_anthropic_cls):
    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(MOCK_AI_RESPONSE))]
    mock_client.messages.create.return_value = mock_msg

    event = _make_event({"dataset_a": DATASET_A, "dataset_b": DATASET_B})
    resp = handler.lambda_handler(event, None)

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert "field_matches" in body
    assert "anomalies" in body
    assert "corrections" in body
    assert "explanation" in body
    assert body["field_matches"][0]["confidence"] == 0.95


# ---------------------------------------------------------------------------
# Prompt builder smoke test
# ---------------------------------------------------------------------------

def test_build_prompt_contains_dataset_names():
    prompt = handler._build_prompt(DATASET_A, DATASET_B)
    assert "sales_2023" in prompt
    assert "orders_2023" in prompt
    assert "field_matches" in prompt  # JSON schema is embedded


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------

def test_parse_strips_markdown_fences():
    raw = "```json\n" + json.dumps(MOCK_AI_RESPONSE) + "\n```"
    result = handler._parse_response(raw)
    assert result["explanation"] == MOCK_AI_RESPONSE["explanation"]


def test_parse_raises_on_non_json():
    with pytest.raises(ValueError, match="non-JSON"):
        handler._parse_response("Sorry, I cannot help with that.")


def test_parse_raises_on_missing_keys():
    bad = {"field_matches": [], "anomalies": []}
    with pytest.raises(ValueError, match="missing required keys"):
        handler._parse_response(json.dumps(bad))
