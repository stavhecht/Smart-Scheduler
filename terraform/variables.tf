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


locals {
  lab_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type    = string
  sensitive = true
  default = ""
}

variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "frontend_url" {
  description = "Amplify frontend URL (used for CORS and Lambda FRONTEND_URL env var)"
  type        = string
  default     = "https://main.dndn8x61u1xu5.amplifyapp.com"
}
