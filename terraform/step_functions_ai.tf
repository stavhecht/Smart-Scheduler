# ---------------------------------------------------------------------------
# Smart Scheduler – Async AI Fairness State Machine
#
# Runs the AI-powered fairness audit AFTER the sync slot-generation workflow.
# Implemented as a STANDARD workflow (async, long-running) because:
#   - It calls the OpenAI API (variable latency, retries needed)
#   - It must not block the user-facing meeting-create response
#   - It writes a separate AISCORE record that the frontend polls
#
# Flow:
#   AIFetchContext → AIScoreMeeting → AIStoreScore
#                 ↘             ↘
#                  ↘            (Catch) → RecordError → End
#                   ↘
#                    (Catch on fetch)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "ai_fairness_sfn" {
  name              = "/aws/states/SmartSchedulerFairnessAI"
  retention_in_days = 14
  tags = {
    Project   = "Smart-Scheduler"
    Component = "AI-Fairness"
  }
}

resource "aws_sfn_state_machine" "fairness_ai" {
  name     = "SmartSchedulerFairnessAI"
  role_arn = local.lab_role_arn
  type     = "STANDARD"

  definition = jsonencode({
    Comment = "Async AI fairness audit — runs gpt-4o-mini after slot generation"
    StartAt = "AIFetchContext"

    States = {
      # --- 1. Load historical fairness + Google Calendar context ---
      AIFetchContext = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "ai_fetch_context"
          "payload.$" = "$"
        }
        ResultPath = "$"
        TimeoutSeconds = 30
        Retry = [
          {
            ErrorEquals     = ["Lambda.ServiceException", "Lambda.TooManyRequestsException", "States.Timeout"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "RecordError"
            ResultPath  = "$.errorInfo"
          }
        ]
        Next = "AIScoreMeeting"
      }

      # --- 2. Call OpenAI gpt-4o-mini agent ---
      AIScoreMeeting = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "ai_score_meeting"
          "payload.$" = "$"
        }
        ResultPath = "$"
        TimeoutSeconds = 60
        Retry = [
          {
            ErrorEquals     = ["Lambda.ServiceException", "States.Timeout"]
            IntervalSeconds = 5
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "RecordError"
            ResultPath  = "$.errorInfo"
          }
        ]
        Next = "AIStoreScore"
      }

      # --- 3. Persist verdict + history ---
      AIStoreScore = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "ai_store_score"
          "payload.$" = "$"
        }
        ResultPath = "$"
        TimeoutSeconds = 15
        End = true
      }

      # --- Catch-all: write an error marker so the frontend stops polling ---
      RecordError = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "ai_record_error"
          "payload.$" = "$"
        }
        End = true
      }
    }
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.ai_fairness_sfn.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  tags = {
    Project     = "Smart-Scheduler"
    Environment = "Dev"
    Component   = "AI-Fairness"
  }
}

# Allow this state machine to invoke the same Lambda
resource "aws_lambda_permission" "sfn_ai_invoke" {
  statement_id  = "AllowStepFunctionsAIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "states.amazonaws.com"
  source_arn    = aws_sfn_state_machine.fairness_ai.arn
}

output "ai_fairness_state_machine_arn" {
  description = "ARN of the async AI fairness state machine"
  value       = aws_sfn_state_machine.fairness_ai.arn
}
