#!/usr/bin/env bash
# Smart Scheduler - Build & Deploy Script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PYTHON="/usr/bin/python3"
export BUILD_DIR="/tmp/lambda_build_$$"
export ZIP_OUT="$SCRIPT_DIR/terraform/api_deployment.zip"

echo "=== Building Lambda deployment package ==="
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Install Python dependencies natively for AWS Lambda Linux
"$PYTHON" -m pip install -q -r "$SCRIPT_DIR/backend/api/requirements.txt" -t "$BUILD_DIR" --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.12

# Copy API source files
cp "$SCRIPT_DIR/backend/api/"*.py "$BUILD_DIR/"

# Create zip
"$PYTHON" - << 'PYEOF'
import zipfile, os, sys
build_dir = os.environ.get('BUILD_DIR', '/tmp/lambda_build')
out = os.environ.get('ZIP_OUT', './terraform/api_deployment.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(build_dir):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            if not f.endswith('.pyc'):
                full = os.path.join(root, f)
                arcname = os.path.relpath(full, build_dir)
                z.write(full, arcname)
print(f"  Created {out} ({os.path.getsize(out) // 1024} KB)")
PYEOF

echo "=== Deploying with Terraform ==="
cd "$SCRIPT_DIR/terraform"
terraform init -upgrade -reconfigure 2>/dev/null || terraform init
terraform apply -auto-approve

echo ""
echo "=== Deploy complete ==="
API_URL=$(terraform output -raw api_endpoint_url 2>/dev/null || echo "N/A")
echo "API URL: $API_URL"
