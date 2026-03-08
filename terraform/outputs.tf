output "dynamodb_table_name" {
  value = aws_dynamodb_table.smart_scheduler_table.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.smart_scheduler_table.arn
}
