# Real API deployment package

resource "aws_lambda_function" "api_handler" {
  filename      = "${path.module}/api_deployment.zip"
  function_name = "smart_scheduler_api"
  role          = var.lab_role_arn  # Using the pre-existing LabRole
  handler       = "main.handler"    # Mangum wraps FastAPI for Lambda
  runtime       = "python3.12"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.smart_scheduler_table.name
    }
  }

  source_code_hash = filebase64sha256("${path.module}/api_deployment.zip")
}

# API Gateway HTTP API (Allowed in AWS Academy)
resource "aws_apigatewayv2_api" "api_gateway" {
  name          = "smart_scheduler_api_gw"
  protocol_type = "HTTP"
  target        = aws_lambda_function.api_handler.arn

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["date", "keep-alive", "content-type", "authorization"]
    allow_methods     = ["*"]
    allow_origins     = ["*"]
    expose_headers    = ["date", "keep-alive"]
    max_age           = 86400
  }

  lifecycle {
    ignore_changes = [target]
  }
}

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api_gateway.execution_arn}/*/*"
}

output "api_endpoint_url" {
  value = aws_apigatewayv2_api.api_gateway.api_endpoint
}
