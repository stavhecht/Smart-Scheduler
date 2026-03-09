# API Gateway is now configured with explicit routes + JWT Authorizer.
# This replaces the previous "quick create" approach that used `target`
# and couldn't support per-route authorization.

# --- Lambda Function ---
resource "aws_lambda_function" "api_handler" {
  filename      = "${path.module}/api_deployment.zip"
  function_name = "smart_scheduler_api"
  role          = var.lab_role_arn
  handler       = "main.handler"
  runtime       = "python3.12"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.smart_scheduler_table.name
      # Set SEED_DEMO_DATA = "true" here only if you want legacy demo data seeded
    }
  }

  source_code_hash = filebase64sha256("${path.module}/api_deployment.zip")
}

# --- API Gateway HTTP API (explicit, no target shortcut) ---
resource "aws_apigatewayv2_api" "api_gateway" {
  name          = "smart_scheduler_api_gw"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["date", "keep-alive", "content-type", "authorization"]
    allow_methods     = ["*"]
    allow_origins     = ["*"]
    expose_headers    = ["date", "keep-alive"]
    max_age           = 86400
  }
}

# $default stage with auto-deploy (equivalent to what "target" created before)
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api_gateway.id
  name        = "$default"
  auto_deploy = true
}

# Lambda proxy integration (payload format 2.0 is needed for JWT claims in requestContext)
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api_gateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api_handler.invoke_arn
  payload_format_version = "2.0"
}

# --- Cognito JWT Authorizer ---
# This is what validates the Bearer token on every protected request.
# API Gateway checks the token against Cognito and injects the user's
# claims (sub, email, etc.) into the Lambda event automatically.
resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id           = aws_apigatewayv2_api.api_gateway.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.client.id]
    issuer   = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.user_pool.id}"
  }
}

# --- Protected Routes (require valid JWT) ---
# ANY /{proxy+} catches all /api/* requests
resource "aws_apigatewayv2_route" "protected" {
  api_id             = aws_apigatewayv2_api.api_gateway.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

# --- Public Route (no auth – for health checks) ---
resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.api_gateway.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# --- Lambda Permission ---
resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke_V2"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api_gateway.execution_arn}/*/*"
}

output "api_endpoint_url" {
  value = aws_apigatewayv2_api.api_gateway.api_endpoint
}
