@echo off
echo Installing Python dependencies...

pip install -r requirements.txt
echo Done.



%~dp0\venv\Scripts\activate.bat %~dp0\venv\ & streamlit run %~dp0\HOME.py --server.port 8505

pause