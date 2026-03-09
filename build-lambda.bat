@echo off
REM build-lambda.bat
REM Rebuilds the api_deployment.zip for AWS Lambda.
REM Run this from the root of the Smart-Scheduler project after any backend change.
REM Then run: cd terraform && terraform apply

echo [1/3] Copying Python source files into /backend/api/package/ ...
copy /Y backend\api\main.py          backend\api\package\main.py
copy /Y backend\api\db.py            backend\api\package\db.py
copy /Y backend\api\models.py        backend\api\package\models.py
copy /Y backend\api\fairness_engine.py backend\api\package\fairness_engine.py

echo [2/3] Zipping package directory -> terraform/api_deployment.zip ...
powershell -NoProfile -Command ^
  "Compress-Archive -Path 'backend\api\package\*' -DestinationPath 'terraform\api_deployment.zip' -Force"

echo [3/3] Cleaning up copied files ...
del backend\api\package\main.py
del backend\api\package\db.py
del backend\api\package\models.py
del backend\api\package\fairness_engine.py

echo.
echo Done! terraform\api_deployment.zip is ready.
echo Next step: cd terraform ^&^& terraform apply
