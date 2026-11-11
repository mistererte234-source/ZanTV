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
| M | Suara mati / nyala |
| + / − | Volume naik / turun (di mana saja) |
| ↑ / ↓ saat film/VOD | Volume naik / turun |
| ← / → saat film/VOD | Mundur / maju 10 detik (ditekan berkali-kali = dijumlahkan) |
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

## Sumber playlist contoh
Playlist **tidak** disimpan di repo ini (lihat `.gitignore`: `playlists/`, `*.m3u`).
Unggah lewat menu admin (Playlist -> Tambah -> Unggah file / tempel teks).

Sumber yang sudah diuji (Indonesia, iptv-org):
`https://iptv-org.github.io/iptv/countries/id.m3u`

Hasil audit 176 channel: 117 balas HTTP 200, semuanya mengirim header CORS,
98 di antaranya HTTPS. Yang bisa diputar di browser tanpa header tambahan: 71.
Tiga hal yang harus dipenuhi agar jalan di web: HTTP 200, ada header
`Access-Control-Allow-Origin`, dan URL `https://` (bukan `http://`).

## Memori tontonan (v1.7.52)
- Posisi terakhir film, episode series, dan short drama disimpan otomatis (`zan-resume.js`): di perangkat (localStorage) dan di akun (`/api/progress`, berkas `progress.json` di folder data server), jadi lanjut nonton juga berlaku antar laptop dan HP.
- Film dianggap tamat di 5% terakhir (maksimal 5 menit) dan hilang dari "Lanjut Nonton". Series otomatis membuka episode berikutnya.
- Volume (0-100%) diingat per perangkat. Di iPhone/iPad volume tetap lewat tombol fisik karena Safari tidak mengizinkan halaman web mengaturnya.
