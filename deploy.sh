#!/bin/bash
set -e

echo "🚀 [ZanTV] Updating from Git origin main..."
git pull origin main

echo "🎨 [ZanTV] Deploying PWA Frontend to /var/www/zantv/..."
cp -r pwa/* /var/www/zantv/
chown -R www-data:www-data /var/www/zantv 2>/dev/null || true

echo "⚙️ [ZanTV] Deploying API Backend to /opt/zantv-api/..."
mkdir -p /opt/zantv-api
cp -r api/* /opt/zantv-api/ 2>/dev/null || true

echo "🔄 [ZanTV] Restarting Backend API Service & Reloading Nginx..."
systemctl restart zantv-api 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

echo "✅ [ZanTV] Selesai! Versi terbaru v1.7.37 sudah aktif."
