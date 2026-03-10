#!/usr/bin/env python3
import requests
import json
from datetime import datetime, timedelta

# Get a test token
API_URL = "https://du2fhsjyhl.execute-api.us-east-1.amazonaws.com/health"

# First, let's check if the API is alive
try:
    resp = requests.get(API_URL)
    print(f"Health check: {resp.status_code}")
    print(f"Response: {resp.json()}")
except Exception as e:
    print(f"Health check failed: {e}")

print("\n" + "="*60)
print("Note: Cannot fully test without valid JWT token from Cognito")
print("The user needs to test via the web interface")
print("="*60)
