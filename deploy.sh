#!/bin/bash
set -e

echo "🚀 [ZanTV] Updating from Git origin main..."
git checkout -- deploy.sh 2>/dev/null || true
git pull origin main

echo "🎨 [ZanTV] Deploying PWA Frontend to /var/www/zantv/..."
mkdir -p /var/www/zantv
cp -r pwa/* /var/www/zantv/
chown -R www-data:www-data /var/www/zantv 2>/dev/null || true

echo "⚙️ [ZanTV] Deploying API Backend to /opt/zantv-api/..."
mkdir -p /opt/zantv-api
cp -r api/* /opt/zantv-api/
chmod -R a+rX /opt/zantv-api 2>/dev/null || true
chown -R zantv:zantv /opt/zantv-api 2>/dev/null || true
if [ -d /var/www/zantv/api ]; then
  cp -r api/* /var/www/zantv/api/ 2>/dev/null || true
fi
if [ -d /opt/zantv-repo/api ]; then
  cp -r api/* /opt/zantv-repo/api/ 2>/dev/null || true
fi
if [ -f api/zantv-api.service ]; then
  cp api/zantv-api.service /etc/systemd/system/zantv-api.service 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
fi

echo "🎬 [ZanTV] Ensuring FFmpeg is installed for DVB/MP2 Live Audio Remux..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ffmpeg || true
fi

echo "🔄 [ZanTV] Restarting Backend API Service (cleaning stuck port 8090) & Reloading Nginx..."
systemctl stop zantv-api 2>/dev/null || true
pkill -9 -f "/opt/zantv-api/server.js" 2>/dev/null || true
pkill -9 -f "zantv.*server.js" 2>/dev/null || true
fuser -k 8090/tcp 2>/dev/null || true
sleep 1
systemctl start zantv-api 2>/dev/null || systemctl restart zantv-api 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

echo "✅ [ZanTV] Selesai! Versi terbaru v1.7.54 sudah aktif."
