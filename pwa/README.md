# ZanTV Web (PWA)

Pemutar playlist IPTV (M3U) untuk laptop dan HP lewat browser. Bisa dipasang ke layar utama seperti aplikasi.

## Yang bisa diputar
- HLS (`.m3u8`), MPEG-TS (`.ts`), FLV, dan file video biasa (mp4/webm).
- DASH (`.mpd`) tanpa enkripsi. Stream ber-DRM sengaja tidak didukung.

## Batasan browser (penting)
- **CORS**: server stream harus mengizinkan diputar dari halaman web. Banyak stream IPTV tidak, sehingga gagal di browser walau jalan di VLC.
- **http vs https**: kalau ZanTV dibuka lewat https (misalnya Vercel), stream `http://` biasanya diblokir browser. ZanTV mencoba versi https otomatis.
- **Header khusus**: User-Agent/Referer dari `#EXTVLCOPT` tidak bisa diatur oleh halaman web.

## Menjalankan di laptop
```
cd pwa
python -m http.server 8080
```
Buka http://localhost:8080. Halaman di localhost juga bisa memutar stream http.

## Deploy ke Vercel
Taruh folder ini di repo (misalnya `F:/ZanTV/pwa`), lalu di Vercel pilih **Root Directory = `pwa`**. Tidak perlu build command.

## Tombol
| Tombol | Fungsi |
|---|---|
| ↑ / ↓ (saat pemutar terpilih), PageUp/PageDown, Channel +/- | Ganti channel |
| Angka | Lompat ke nomor channel |
| ← / → | Pindah antara kategori, daftar, dan pemutar |
| Enter | Putar / layar penuh |
| F | Layar penuh |
| S | Favorit |
| M | Suara |
| / | Cari |
Di HP: geser naik/turun di video untuk ganti channel, ketuk dua kali untuk layar penuh.

## Pustaka (sudah disertakan di `vendor/`)
hls.js 1.7.3 (Apache-2.0), mpegts.js 1.8.2 (Apache-2.0), dash.js 5.2.1 (BSD-3-Clause).

Kalau mengubah file aplikasi, naikkan `VERSION` di `sw.js` supaya pengguna mendapat versi baru.

## Khas Zandev (v1.1)
- Splash logo saat aplikasi dibuka (sekali per sesi, bisa dilewati dengan ketuk/tombol apa saja).
- Jam, weton (hari + pasaran), tanggal Hijriah (kalender Umm al-Qura), bulan dan tahun Jawa.
- Jadwal shalat dihitung di perangkat dengan metode Kemenag RI. Bawaan Surabaya; tombol lokasi untuk memakai GPS.
- Footer "Design × Code by Zandev".
Logika ini ada di `zan-sig.js` dan bisa dipakai ulang di proyek Zandev lain.
