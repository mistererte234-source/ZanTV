# ZanTV

Pemutar playlist IPTV (M3U) berbasis web/PWA untuk laptop dan HP, dengan login dan peran admin/user.

- `pwa/`: tampilan aplikasi (HTML, CSS, JavaScript). Dipasang di `/var/www/zantv`.
- `api/`: server login dan playlist (Node.js 18+, tanpa dependensi). Dipasang di `/opt/zantv-api` sebagai service `zantv-api`.

Stream ber-DRM sengaja tidak didukung. Isi playlist dikelola admin lewat aplikasi dan disimpan di server, bukan di repo ini.

## Fitur
- HLS, DASH tanpa DRM, MPEG-TS, FLV; ganti channel pakai panah/remote, OSD nomor channel, favorit, riwayat.
- Login: admin mengelola playlist dan pengguna, user hanya menonton.
- Khas Zandev: splash logo, jam, weton, tanggal Hijriah dan Jawa, jadwal shalat metode Kemenag RI.

## Update di VPS
```
# tampilan
cp -r pwa/* /var/www/zantv/ && chown -R www-data:www-data /var/www/zantv
# server API
cp api/server.js /opt/zantv-api/ && systemctl restart zantv-api
```
Naikkan `VERSION` di `pwa/sw.js` dan angka `?v=` di `pwa/index.html` setiap kali mengubah tampilan.

Design × Code by Zandev — https://zandev.id
