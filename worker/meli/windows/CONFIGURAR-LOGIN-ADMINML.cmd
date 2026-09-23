@echo off
title Configurar Login AdminML
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-login-adminml.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel configurar o login do AdminML.
  pause
)
