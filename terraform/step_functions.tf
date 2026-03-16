# ---------------------------------------------------------------------------
# Smart Scheduler - AWS Step Functions State Machine
#
# Implements the "Social Fairness Algorithm" orchestration workflow:
#   FetchParticipantData → GenerateCandidateSlots → CalculateFairnessScores
#   → (Choice) CheckOptimizationNeeded → [ReshuffleSlots] → StoreResults
#
# Uses Express Workflow (synchronous, < 5 min) so the API can await results.
# ---------------------------------------------------------------------------

resource "aws_sfn_state_machine" "scheduler" {
  name     = "SmartSchedulerWorkflow"
  role_arn = var.lab_role_arn
  type     = "EXPRESS"

  definition = jsonencode({
    Comment = "Smart Scheduler: Fairness-based meeting slot optimization workflow"
    StartAt = "FetchParticipantData"

    States = {
      # --- State 1: Fetch participant fairness states from DynamoDB ---
      FetchParticipantData = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action    = "fetch_participants"
          "payload.$"   = "$"
        }
        ResultPath = "$"
        Retry = [
          {
            ErrorEquals     = ["Lambda.ServiceException", "Lambda.TooManyRequestsException"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2
          }
        ]
        Next = "GenerateCandidateSlots"
      }

      # --- State 2: Generate candidate time slots within date range ---
      GenerateCandidateSlots = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "generate_slots"
          "payload.$" = "$"
        }
        ResultPath = "$"
        Retry = [
          {
            ErrorEquals     = ["Lambda.ServiceException"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2
          }
        ]
        Next = "CalculateFairnessScores"
      }

      # --- State 3: Score all slots using the Social Fairness Algorithm ---
      CalculateFairnessScores = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "calculate_fairness"
          "payload.$" = "$"
        }
        ResultPath = "$"
        Next       = "CheckOptimizationNeeded"
      }

      # --- State 4: Choice — activate Dynamic Reshuffling Engine? ---
      CheckOptimizationNeeded = {
        Type = "Choice"
        Choices = [
          {
            Variable       = "$.optimization_needed"
            BooleanEquals  = true
            Next           = "ReshuffleSlots"
          }
        ]
        Default = "StoreResults"
        Comment = "Activate Reshuffling Engine when avg score < 75"
      }

      # --- State 5 (conditional): Dynamic Reshuffling Engine ---
      ReshuffleSlots = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "reshuffle_slots"
          "payload.$" = "$"
        }
        ResultPath = "$"
        Next       = "StoreResults"
        Comment    = "Re-selects best slots when fairness scores are too low"
      }

      # --- State 6: Persist ranked slots to DynamoDB ---
      StoreResults = {
        Type     = "Task"
        Resource = aws_lambda_function.api_handler.arn
        Parameters = {
          sfn_action  = "store_results"
          "payload.$" = "$"
        }
        ResultPath = "$"
        End        = true
      }
    }
  })

  logging_configuration {
    level                  = "OFF"
    include_execution_data = false
  }

  tags = {
    Project     = "Smart-Scheduler"
    Environment = "Dev"
    Component   = "Orchestration"
  }
}

# Allow Step Functions to invoke the Lambda function
resource "aws_lambda_permission" "sfn_invoke" {
  statement_id  = "AllowStepFunctionsInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "states.amazonaws.com"
  source_arn    = aws_sfn_state_machine.scheduler.arn
}

output "state_machine_arn" {
  description = "ARN of the Smart Scheduler Step Functions state machine"
  value       = aws_sfn_state_machine.scheduler.arn
}
