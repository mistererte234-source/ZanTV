#!/bin/bash
set -e

echo "🚀 [ZanTV] Updating from Git origin main..."
git checkout -- deploy.sh 2>/dev/null || true
git pull origin main

echo "🎨 [ZanTV] Deploying PWA Frontend to /var/www/zantv/..."
cp -r pwa/* /var/www/zantv/
chown -R www-data:www-data /var/www/zantv 2>/dev/null || true

echo "⚙️ [ZanTV] Deploying API Backend to /opt/zantv-api/..."
mkdir -p /opt/zantv-api
cp -r api/* /opt/zantv-api/ 2>/dev/null || true

echo "🎬 [ZanTV] Ensuring FFmpeg is installed for DVB/MP2 Live Audio Remux..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ffmpeg || true
fi

echo "🔄 [ZanTV] Restarting Backend API Service & Reloading Nginx..."
systemctl restart zantv-api 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

echo "✅ [ZanTV] Selesai! Versi terbaru v1.7.51 sudah aktif."
