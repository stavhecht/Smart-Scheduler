resource "aws_dynamodb_table" "smart_scheduler_table" {
  name           = var.table_name
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "PK"
  range_key      = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttlExpiry"
    enabled        = true
  }

  tags = {
    Project     = "Smart-Scheduler"
    Environment = "Dev"
  }
}
