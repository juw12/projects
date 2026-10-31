@echo off

title Teman Sehat (biarkan jendela ini terbuka saat pertama memasang)

cd /d "%~dp0..\web"

echo.

echo  Teman Sehat berjalan di http://localhost:8765/

echo  Di Edge/Chrome: klik ikon "Pasang aplikasi" di kolom alamat.

echo  Setelah terpasang, aplikasi tetap bisa dibuka offline.

echo  Tutup jendela ini untuk menghentikan server.

echo.

start "" "http://localhost:8765/"

where python >nul 2>nul && (python -m http.server 8765 --bind 127.0.0.1 & goto :eof)

where py >nul 2>nul && (py -m http.server 8765 --bind 127.0.0.1 & goto :eof)

echo Python tidak ditemukan. Install Python dari https://www.python.org/ lalu jalankan lagi.

pause

