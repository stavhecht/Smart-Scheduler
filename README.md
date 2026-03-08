# Smart Scheduler - Fair Schedule Management System

A schedule management system based on a fairness algorithm, built with modern technologies and ready for cloud deployment.

## 🚀 Technologies

*   **Frontend**: React, Vite, Premium Dark Mode UI (Vanilla CSS).
*   **Backend**: Python FastAPI (AWS Lambda ready).
*   **Infrastructure**: AWS Amplify, Terraform, API Gateway, DynamoDB.

## 🛠️ Local Development

The simplest way to run the system is using Docker Compose:

1.  Ensure Docker Desktop is running.
2.  Run the following command in the main directory:

```bash
docker-compose up --build
```

The system will be available at: **[http://localhost](http://localhost)**
(The Frontend runs on port 80 and communicates with the Backend automatically).

## ☁️ AWS Deployment

The system is configured for AWS deployment using Terraform and AWS Amplify.

### Frontend: AWS Amplify
1.  Connect your GitHub repository to AWS Amplify.
2.  Set the build settings to point to the `frontend/` directory.

### Backend: Terraform
1.  Navigate to the `/terraform` directory.
2.  Run `terraform init` and `terraform apply`.
3.  This will provision Lambda, API Gateway, and DynamoDB.

## 📁 Project Structure

*   `/frontend` - Client-side code (React).
*   `/backend` - Server-side code (FastAPI).
*   `/terraform` - Infrastructure as Code definitions.
*   `docker-compose.yml` - Local orchestration.
