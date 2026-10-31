# ZanTV API

Server kecil untuk login dan playlist ZanTV. Hanya modul bawaan Node.js (butuh Node 18 ke atas), tanpa `npm install`.

## Peran
- **admin**: menambah, memperbarui, menghapus playlist; membuat dan menghapus pengguna; mengatur ulang kata sandi.
- **user**: hanya menonton playlist yang disediakan admin dan mengganti kata sandinya sendiri.

## Data
Disimpan di `/var/lib/zantv`: `db.json` (akun, sesi, daftar playlist) dan folder `playlists/`.
Kata sandi disimpan sebagai hash scrypt. Sesi berlaku 30 hari, cookie HttpOnly + Secure + SameSite=Strict.

## Perintah akun (jalankan sebagai user zantv)
```
sudo -u zantv ZANTV_DATA=/var/lib/zantv node /opt/zantv-api/server.js add-user <nama> <admin|user>
sudo -u zantv ZANTV_DATA=/var/lib/zantv node /opt/zantv-api/server.js passwd <nama>
sudo -u zantv ZANTV_DATA=/var/lib/zantv node /opt/zantv-api/server.js list-users
sudo -u zantv ZANTV_DATA=/var/lib/zantv node /opt/zantv-api/server.js del-user <nama>
```
Perubahan dari perintah ini langsung terbaca server tanpa restart.

## Pengamanan yang ada
- Login dibatasi 5 kali gagal per IP, lalu dikunci 10 menit.
- Permintaan yang mengubah data wajib membawa header `X-ZanTV: 1` (melindungi dari CSRF).
- Saat admin menambah playlist dari alamat, server menolak alamat yang menuju jaringan internal (localhost, IP privat).

## Batasan
Login melindungi aplikasi dan daftar playlist. Alamat stream di dalam playlist tetap bisa dilihat oleh pengguna yang sudah masuk (misalnya lewat developer tools), dan alamat itu bisa dibuka tanpa ZanTV.
