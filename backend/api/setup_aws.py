import boto3
import os
import sys

# AWS Configuration - Change region if needed
REGION = "us-east-1" 
TABLE_NAME = "SmartScheduler_V1"

def create_table():
    dynamodb = boto3.client('dynamodb', region_name=REGION)
    
    print(f"🚀 Creating DynamoDB Table: {TABLE_NAME} in {REGION}...")
    
    try:
        # Check if table exists
        existing_tables = dynamodb.list_tables()['TableNames']
        if TABLE_NAME in existing_tables:
            print(f"⚠️  Table {TABLE_NAME} already exists!")
            return

        # Create Table with Single-Table Design schema
        response = dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {'AttributeName': 'PK', 'KeyType': 'HASH'},  # Partition Key
                {'AttributeName': 'SK', 'KeyType': 'RANGE'}   # Sort Key
            ],
            AttributeDefinitions=[
                {'AttributeName': 'PK', 'AttributeType': 'S'},
                {'AttributeName': 'SK', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST' # Serverless pricing (On-Demand)
        )
        
        print("⏳ Table is being created, please wait...")
        waiter = dynamodb.get_waiter('table_exists')
        waiter.wait(TableName=TABLE_NAME)
        
        print(f"✅ Table {TABLE_NAME} created successfully!")
        print("You can now connect the application to AWS.")

    except Exception as e:
        print(f"❌ Error creating table: {e}")
        print("\nTip: Make sure you have AWS Credentials configured.")
        print("Run 'aws configure' or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env variables.")

if __name__ == "__main__":
    create_table()
