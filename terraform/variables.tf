variable "aws_region" {
  description = "AWS Region"
  type        = string
  default     = "us-east-1"
}

variable "table_name" {
  description = "DynamoDB Table Name"
  type        = string
  default     = "SmartScheduler_V1"
}

variable "lab_role_arn" {
  description = "ARN of the existing LabRole for Lambda execution"
  type        = string
}
