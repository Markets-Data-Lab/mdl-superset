# ---------------------------------------------------------------------------
# AI Calibration Infrastructure
# Provisions: Lambda function, API Gateway (HTTP API), Cognito JWT Authorizer
#
# Prerequisites:
#   - An existing Cognito User Pool (referenced via var.cognito_user_pool_id)
#   - An existing ECR repo or S3 bucket holding the Lambda zip
#   - The mdl-superset VPC and subnet IDs if Lambda needs private Snowflake access
# ---------------------------------------------------------------------------

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  default = "us-east-1"
}

variable "env" {
  description = "Deployment environment (dev, staging, prod)"
  default     = "prod"
}

variable "cognito_user_pool_id" {
  description = "Existing Cognito User Pool ID used by your Superset deployment"
}

variable "cognito_client_id" {
  description = "Cognito App Client ID that Superset uses"
}

variable "anthropic_api_key_secret_arn" {
  description = "ARN of the AWS Secrets Manager secret holding ANTHROPIC_API_KEY"
}

variable "lambda_zip_path" {
  description = "Local path to the Lambda deployment zip"
  default     = "../../../lambda/calibration/function.zip"
}

# ---------------------------------------------------------------------------
# IAM role for the Lambda
# ---------------------------------------------------------------------------

resource "aws_iam_role" "calibration_lambda" {
  name = "mdl-calibration-lambda-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.calibration_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "calibration-secrets-access"
  role = aws_iam_role.calibration_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.anthropic_api_key_secret_arn]
    }]
  })
}

# ---------------------------------------------------------------------------
# Lambda function
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "calibration" {
  function_name = "mdl-calibration-${var.env}"
  role          = aws_iam_role.calibration_lambda.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 120 # AI inference can take up to ~60s
  memory_size   = 512

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      # The actual key is fetched from Secrets Manager at cold start.
      # Use a Lambda Extension or init code to load it; see README.
      ANTHROPIC_API_KEY_SECRET_ARN = var.anthropic_api_key_secret_arn
    }
  }

  tags = {
    Project     = "mdl-superset"
    Environment = var.env
    Component   = "calibration"
  }
}

# ---------------------------------------------------------------------------
# HTTP API Gateway (v2 — lower latency and cost than REST API)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "calibration" {
  name          = "mdl-calibration-api-${var.env}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"] # Tighten to your CloudFront domain in production
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }
}

# Cognito JWT Authorizer — validates tokens issued by your existing User Pool
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.calibration.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${var.cognito_user_pool_id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.calibration.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.calibration.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post" {
  api_id             = aws_apigatewayv2_api.calibration.id
  route_key          = "POST /calibrate"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.calibration.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.calibration.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.calibration.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Outputs — paste the invoke_url into your Superset config
# ---------------------------------------------------------------------------

output "calibration_api_url" {
  description = "Set this as CALIBRATION_API_URL in your Superset environment config"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/calibrate"
}

output "lambda_function_name" {
  value = aws_lambda_function.calibration.function_name
}
