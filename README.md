# Vala Transfer Bot

CLI bot untuk login ke beberapa akun Vala memakai `username + privateKey`, lalu mengirim `CC` (`Amulet`) antar akun yang ada di `accounts.json`.

Bot ini sekarang mendukung `session reuse`:

- jika `accounts.json` berisi `sessionToken`, bot akan mencoba reuse sesi Vala itu lebih dulu
- jika `accounts.json` berisi `cookieHeader`, bot akan parse cookie itu dan mengambil `sessionToken` dari sana bila ada
- jika sesi masih valid, bot bisa langsung baca balance dan lanjut transfer tanpa prompt passkey
- jika sesi sudah kadaluarsa, bot akan fallback ke flow login lama

## File input

- `config.json`
- `accounts.json`
- `transfers.json`

Contoh template tersedia di:

- `config.example.json`
- `accounts.example.json`
- `transfers.example.json`

Untuk repo GitHub, file real berikut sebaiknya tetap lokal saja dan tidak di-commit:

- `accounts.json`

Repo ini sudah disiapkan dengan `.gitignore` agar private key dan `sessionToken` dari `accounts.json` tidak ikut ter-push. `config.json` dan `transfers.json` boleh ikut di-commit kalau memang tidak berisi data sensitif.

## Menjalankan

```bash
npm install
```

```bash
node src/index.js
```

Atau:

```bash
npm start
```

## Mode transfer

Mode default bot sekarang adalah `internal-round-robin`:

- tujuan transfer diambil otomatis dari akun lain yang berhasil login
- bot tidak akan kirim ke akun sendiri
- pengirim dipilih ulang setiap ronde berdasarkan balance terkini dan kuota sukses per akun
- jika satu akun balance-nya kurang dari minimum amount, bot akan pindah ke akun lain yang masih cukup
- amount dibuat random di range yang kamu tentukan
- jumlah transfer per akun dibatasi oleh config

Field penting di `config.json`:

```json
{
  "transferMode": "internal-round-robin",
  "maxTransfersPerAccount": 10,
  "minTransferAmount": 0.3,
  "maxTransferAmount": 2,
  "transferAmountPrecision": 2
}
```

Kalau suatu saat mau balik ke mode manual, ubah:

```json
{
  "transferMode": "manual"
}
```

dan isi `transfers.json` seperti biasa.

## Format akun

Contoh field yang didukung per akun:

```json
{
  "name": "wallet-1",
  "username": "your_username",
  "privateKey": "0xYOUR_PRIVATE_KEY",
  "partyId": "optional_party_id_from_browser_state",
  "sessionToken": "optional_session_token_cookie_value",
  "cookieHeader": "optional_full_cookie_header_like_sessionToken=..."
}
```

Minimalnya tetap `username + privateKey`. Untuk mode session reuse, isi salah satu:

- `sessionToken`
- `cookieHeader`

Kalau dua-duanya diisi, bot tetap akan memakai cookie yang tersedia dan memvalidasinya ke `/api/auth/me`.

## Chrome Extension

Folder ekstensi ada di:

- `extension/vala-cookie-exporter`

Fungsinya:

- membaca cookie `sessionToken` dari `vala-wallet.cc`
- membaca semua cookie Vala menjadi satu `cookieHeader`
- mengambil `username` dan `partyId` dari tab Vala aktif
- menyalin snippet JSON siap tempel ke `accounts.json`

### Cara pakai

1. Login dulu ke `https://vala-wallet.cc` di Chrome dan approve passkey.
2. Buka `chrome://extensions`.
3. Aktifkan `Developer mode`.
4. Klik `Load unpacked`.
5. Pilih folder `vala-bot/extension/vala-cookie-exporter`.
6. Buka tab `https://vala-wallet.cc/dashboard`.
7. Klik ekstensi `Vala Session Exporter`.
8. Tekan `Refresh` bila perlu, lalu pakai tombol `Copy` yang kamu butuhkan.

Hasil paling praktis untuk bot biasanya:

- `Copy` pada `accounts.json Snippet`, lalu tempel ke `accounts.json`
- atau `Copy` pada `Session Token`, lalu isi field `sessionToken` manual

## Catatan

- Bot ini memakai flow private-key login Vala yang dipetakan dari frontend `vala-wallet.cc`.
- Session auth dikelola dengan cookie jar lokal per akun.
- Untuk `session reuse`, isi `sessionToken` atau `cookieHeader` dari browser setelah login sukses.
- `partyId` boleh diisi juga untuk membantu bootstrap state akun, tetapi bot tetap akan mencoba sinkron dari server.
- Verifikasi pasca submit masih bersifat best-effort lewat refresh balance dan history.
- Mode `internal-round-robin` memerlukan minimal 2 akun yang berhasil login dan punya `partyId` valid.
