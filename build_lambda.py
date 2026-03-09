#!/usr/bin/env python3
"""Build Lambda deployment zip from backend/api source."""
import os, sys, shutil, subprocess, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(ROOT, ".build_lambda")
ZIP_OUT   = os.path.join(ROOT, "terraform", "api_deployment.zip")
API_DIR   = os.path.join(ROOT, "backend", "api")

print("=== Building Lambda package ===")
shutil.rmtree(BUILD_DIR, ignore_errors=True)
os.makedirs(BUILD_DIR)

# Install dependencies
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                       "-r", os.path.join(API_DIR, "requirements.txt"),
                       "-t", BUILD_DIR])

# Copy source files
for f in os.listdir(API_DIR):
    if f.endswith(".py"):
        shutil.copy(os.path.join(API_DIR, f), os.path.join(BUILD_DIR, f))

# Create zip
with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(BUILD_DIR):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for fname in files:
            if not fname.endswith(".pyc"):
                full = os.path.join(root, fname)
                z.write(full, os.path.relpath(full, BUILD_DIR))

print(f"Created {ZIP_OUT} ({os.path.getsize(ZIP_OUT)//1024} KB)")
shutil.rmtree(BUILD_DIR, ignore_errors=True)
