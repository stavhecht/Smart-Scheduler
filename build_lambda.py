"""
Build script for the Smart Scheduler Lambda deployment package.
Creates terraform/api_deployment.zip with all dependencies.

Usage:
    python build_lambda.py
"""

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
API_DIR = ROOT / "backend" / "api"
REQUIREMENTS = API_DIR / "requirements.txt"
BUILD_DIR = ROOT / "build_tmp"
OUTPUT_ZIP = ROOT / "terraform" / "api_deployment.zip"

# Files to include from backend/api (exclude dev/test artifacts)
EXCLUDE_PATTERNS = {".venv", "__pycache__", ".env", "*.pyc", ".pytest_cache", "setup_aws.py", "package", "Dockerfile", ".dockerignore"}

def matches_exclude(name: str) -> bool:
    import fnmatch
    return any(fnmatch.fnmatch(name, p) or name == p for p in EXCLUDE_PATTERNS)


def main():
    print("=== Smart Scheduler Lambda Build ===\n")

    # 1. Clean build dir
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir(parents=True)
    print(f"[1/4] Build directory: {BUILD_DIR}")

    # 2. Install requirements
    print(f"[2/4] Installing requirements from {REQUIREMENTS}...")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install",
         "-r", str(REQUIREMENTS),
         "--target", str(BUILD_DIR),
         "--quiet",
         "--platform", "manylinux2014_x86_64",
         "--python-version", "3.12",
         "--only-binary=:all:",
         "--implementation", "cp"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        # Fallback: install without platform constraints (works for pure Python packages)
        print("  Platform-specific install failed, falling back to standard install...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install",
             "-r", str(REQUIREMENTS),
             "--target", str(BUILD_DIR),
             "--quiet"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"ERROR: pip install failed:\n{result.stderr}")
            sys.exit(1)
    print(f"  Dependencies installed.")

    # 3. Copy API source files
    print(f"[3/4] Copying API source files from {API_DIR}...")
    for item in API_DIR.iterdir():
        if not matches_exclude(item.name):
            dest = BUILD_DIR / item.name
            if item.is_file():
                shutil.copy2(item, dest)
            elif item.is_dir():
                shutil.copytree(item, dest, ignore=shutil.ignore_patterns(*EXCLUDE_PATTERNS))
            print(f"  + {item.name}")

    # 4. Create ZIP
    print(f"[4/4] Creating {OUTPUT_ZIP}...")
    OUTPUT_ZIP.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUTPUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in BUILD_DIR.rglob("*"):
            if file_path.is_file():
                arcname = file_path.relative_to(BUILD_DIR)
                zf.write(file_path, arcname)

    size_mb = OUTPUT_ZIP.stat().st_size / (1024 * 1024)
    print(f"\n=== Build complete! ===")
    print(f"Output: {OUTPUT_ZIP}")
    print(f"Size:   {size_mb:.1f} MB")

    # Cleanup
    shutil.rmtree(BUILD_DIR)

if __name__ == "__main__":
    main()
