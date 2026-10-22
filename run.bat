@echo off
chcp 65001 >nul
title Google Form Auto-Filler Server
cd /d "%~dp0"

echo ==================================================
echo   KHỞI ĐỘNG GOOGLE FORM AUTO-FILLER
echo ==================================================
echo.

if exist "AutoFillForm.exe" (
    echo Đang khởi chạy ứng dụng độc lập AutoFillForm.exe...
    start "" "AutoFillForm.exe"
    exit /b
)

where python >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
    ) else (
        echo [LỖI] Chưa tìm thấy Python hoặc file AutoFillForm.exe!
        echo Vui lòng cài đặt Python hoặc tải lại file AutoFillForm.exe.
        pause
        exit /b
    )
)

echo [1/2] Đang kiểm tra và cập nhật các thư viện...
pip install -r requirements.txt >nul 2>&1
echo.
echo [2/2] Đang khởi động Server...
echo Trình duyệt sẽ tự động mở địa chỉ: http://127.0.0.1:5000
echo.
timeout /t 1 >nul
start http://127.0.0.1:5000
python app.py

pause
