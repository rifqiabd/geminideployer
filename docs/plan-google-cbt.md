# Rencana Implementasi Google Login & CBT Terdaftar

Status: **Disetujui — belum diimplementasikan**
Tanggal: 25 September 2026
Target awal: satu sekolah, sekitar 30 siswa

## 1. Ringkasan Keputusan

- Menggunakan **satu backend Cloudflare Worker** untuk guru, siswa, kuiz, dan autentikasi.
- Guru dan siswa sama-sama dapat login menggunakan Google OAuth.
- Semua akun Google dapat menyelesaikan login, tetapi hak akses tetap dibatasi:
  - Guru harus terdaftar sebagai guru atau admin oleh admin.
  - Siswa harus terdaftar pada roster CBT tertentu.
- Guru hanya dapat mengelola kuiz baru yang dia buat atau generate sendiri.
- Kuiz lama tetap public dan tidak dipindahkan menjadi milik guru.
- Kuiz baru dapat dipublikasikan dalam dua mode:
  - **Public/practice**: dapat dibuka melalui link seperti sekarang.
  - **Assigned/CBT**: wajib login Google dan email siswa harus ada di roster.
- Mode CBT menggunakan aturan satu kali pengerjaan, timer server, autosave, submit yang idempotent, dan hasil yang disembunyikan sampai guru mengizinkannya.
- Tidak membuat backend autentikasi terpisah.

## 2. Tujuan

1. Mengganti password statis dengan identitas Google yang benar-benar diverifikasi server.
2. Memberikan setiap guru akses ke kuiz miliknya tanpa dapat mengubah kuiz guru lain.
3. Membolehkan siswa login dengan akun Google yang sudah didaftarkan admin untuk CBT.
4. Membuat lifecycle CBT yang aman dari manipulasi timer, identitas, dan submit berulang.
5. Mempertahankan kompatibilitas link public dan aplikasi lama.

## 3. Batas Kerja

### Termasuk

- OAuth authorization-code Google dengan state, nonce, dan PKCE.
- Session server-side yang dapat dicabut.
- Role `admin`, `teacher`, dan `student`.
- Email guru terdaftar dan email siswa per assessment.
- Ownership untuk kuiz baru.
- Mode public dan assigned pada kuiz baru.
- D1 migration untuk auth, assessment, roster, attempt, dan draft.
- Timer server, autosave D1, resume attempt, dan submit idempotent.
- UI login Google untuk guru dan siswa.
- Pengaturan akses, durasi, deadline, dan maksimal percobaan di editor.
- Pagination/filter pada laporan CBT.
- Tes auth, ownership, timer, roster, attempt, dan kompatibilitas public.

### Tidak termasuk pada fase pertama

- Proctoring kamera, webcam, atau deteksi kecurangan.
- Login Google Workspace khusus domain sekolah; daftar email tetap dipakai.
- Multi-sekolah dengan billing, kuota per tenant, atau super-admin multi-tenant.
- Pemindahan otomatis seluruh kuiz lama ke owner tertentu.
- Fitur berbagi kuiz antar guru.
- Collaboration real-time pada satu soal.
- Migrasi aplikasi HTML/React lama menjadi CBT.

## 4. Kondisi Saat Ini

### Autentikasi

- `src/auth.ts:9-12` hanya membandingkan cookie dengan literal `authenticated_user`.
- `src/index.ts:537-556` memakai satu password bersama dan masih memiliki fallback `admin123`.
- Beberapa route admin memeriksa cookie secara langsung, sehingga mudah terjadi ketidakkonsistenan.

### Konten dan kuiz

- Konten memakai key global seperti `html:<slug>`, `meta:<slug>`, `quiz:<slug>`, dan `quizsource:<slug>`.
- `src/index.ts:1296-1343` menyimpan hasil deploy/generate tanpa owner.
- Dashboard saat ini membaca seluruh daftar key `meta:` sehingga tidak dapat memisahkan kuiz setiap guru.

### Student flow

- `src/quiz-page.ts:329-330` meminta nama bebas dari siswa.
- Draft browser memakai `localStorage`, bukan attempt server.
- `src/index.ts:194-271` membuat UUID dan row baru pada setiap submit.
- Belum ada deadline server, maksimal attempt, resume resmi, atau idempotency.
- `?print=1&kunci=1` dapat mengekspos kunci jawaban pada halaman public.

### Penyimpanan

- `schema.sql:1-9` hanya memiliki `app_records`.
- Belum ada tabel user, session, assessment, roster, attempt, atau draft.
- Data lama harus tetap dapat dibaca oleh route public dan laporan.

## 5. Arsitektur Target

```text
Browser guru/siswa
        |
        v
Cloudflare Worker (Hono)
  |- Google OAuth + session server-side
  |- Authorization guru/siswa
  |- Public quiz compatibility
  |- CBT attempt lifecycle
  |- Server-side grading
  |
  +--> D1
  |     |- users
  |     |- auth_sessions
  |     |- assessments
  |     |- assessment_students
  |     |- quiz_attempts
  |     `- quiz_drafts
  |
  `--> KV
        |- Konten legacy public
        `- Konten baru namespaced per owner/assessment/version
```

### Prinsip auth

- Browser tidak boleh mengirimkan email, role, score, deadline, atau status attempt sebagai sumber kebenaran.
- Worker memverifikasi ID token Google, claim, state, nonce, dan PKCE.
- Session aplikasi yang diberikan ke browser bukan token Google mentah.
- Guru dan siswa memakai session dengan role yang berbeda secara logis; walaupun keduanya berasal dari provider yang sama.

### Prinsip ownership

- Semua assessment baru memiliki `owner_user_id`.
- Guru hanya dapat membaca dan mengubah assessment dengan `owner_user_id` yang sama.
- Admin dapat melihat seluruh assessment dan dapat menetapkan role/transfer ownership.
- Konten baru memakai prefix namespace, misalnya `owned:<owner_id>:<assessment_id>:<version>:...`.
- Record legacy tanpa assessment D1 tetap dibaca melalui key lama.

## 6. Model Data D1

Migration baru akan dibuat pada `migrations/0001_auth_cbt.sql` dan diterapkan ke database lokal, staging, lalu production.

### `users`

| Kolom | Fungsi |
|---|---|
| `id` | UUID internal |
| `google_sub` | Stable Google subject, unique |
| `email` | Email normalized, unique |
| `display_name` | Nama tampilan dari Google |
| `role` | `admin`, `teacher`, atau `student` |
| `created_at` | Waktu pembuatan |
| `updated_at` | Waktu perubahan profil/role |

### `auth_sessions`

| Kolom | Fungsi |
|---|---|
| `id` | UUID session |
| `token_hash` | SHA-256 dari random opaque token, unique |
| `user_id` | User pemilik session |
| `scope` | `staff` atau `student` |
| `expires_at` | Masa berlaku |
| `revoked_at` | Waktu pencabutan, nullable |
| `created_at` | Waktu pembuatan |

### `assessments`

| Kolom | Fungsi |
|---|---|
| `id` | UUID assessment |
| `owner_user_id` | Guru/admin pembuat |
| `slug` | URL public, unique untuk assessment baru |
| `title` | Judul tampilan |
| `mode` | `public` atau `assigned` |
| `content_prefix` | Prefix key KV untuk konten |
| `content_version` | Versi source/spec yang immutable |
| `duration_seconds` | Durasi attempt, nullable untuk public |
| `max_attempts` | Default `1` untuk CBT |
| `opens_at` | Waktu mulai akses |
| `due_at` | Batas akhir akses |
| `show_result` | Apakah guru boleh membuka hasil |
| `created_at` | Waktu pembuatan |
| `updated_at` | Waktu perubahan |

### `assessment_students`

| Kolom | Fungsi |
|---|---|
| `id` | UUID roster |
| `assessment_id` | Assessment yang boleh diakses |
| `email` | Email Google yang diizinkan |
| `display_name` | Nama roster |
| `class_name` | Kelas opsional |
| `active` | Status aktif/nonaktif |
| `created_at` | Waktu pendaftaran |

Unique constraint: satu email hanya satu row per assessment.

### `quiz_attempts`

| Kolom | Fungsi |
|---|---|
| `id` | UUID attempt |
| `assessment_id` | Assessment yang dikerjakan |
| `user_id` | Identitas hasil login server |
| `attempt_number` | Nomor percobaan |
| `status` | `in_progress`, `submitted`, atau `expired` |
| `started_at` | Waktu mulai server |
| `expires_at` | Deadline server |
| `submitted_at` | Waktu submit berhasil |
| `content_version` | Snapshot versi yang sedang dikerjakan |
| `result_json` | Hasil grading server, nullable |
| `created_at` | Waktu pembuatan |

Unique constraint: `(assessment_id, user_id, attempt_number)`.

### `quiz_drafts`

| Kolom | Fungsi |
|---|---|
| `attempt_id` | Primary key dan relasi attempt |
| `answers_json` | Jawaban yang tersimpan |
| `flags_json` | Tandai ragu |
| `revision` | Versi draft untuk konflik multi-tab |
| `updated_at` | Waktu autosave terakhir |

### Legacy `app_records`

- `app_records` tetap dipertahankan untuk public/legacy submission.
- Data CBT authoritative berada di `quiz_attempts`.
- Laporan harus dapat membaca kedua sumber tanpa mengubah format payload lama.
- Essay grading CBT diarahkan ke `quiz_attempts`, bukan hanya `app_records`.

## 7. Alur Google Login

### Guru/admin

1. Guru membuka halaman dashboard atau halaman login.
2. Worker membuat random `state`, `nonce`, dan PKCE verifier.
3. Browser diarahkan ke Google authorization endpoint.
4. Callback menerima authorization code.
5. Worker menukar code di server dan memverifikasi ID token serta JWKS.
6. Worker memvalidasi issuer, audience, expiry, nonce, `email_verified`, dan policy email guru.
7. Worker membuat session opaque dan menyimpan hash token di D1.
8. Browser menerima cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
9. Dashboard hanya menampilkan assessment milik user tersebut, kecuali role admin.

### Siswa

1. Siswa membuka link CBT.
2. Jika belum login, Worker mengarahkan ke Google login.
3. Setelah login, Worker mencari email pada `assessment_students`.
4. Email yang tidak terdaftar mendapat halaman akses ditolak dan tidak membuat attempt.
5. Jika terdaftar, Worker membuat atau melanjutkan attempt yang masih aktif.
6. Identitas yang disimpan ke attempt berasal dari session server, bukan dari input browser.

### Kontrol email

- `ADMIN_EMAILS` digunakan untuk bootstrap role admin.
- Admin dapat menambah email guru melalui panel internal.
- Guru tidak otomatis menjadi teacher hanya karena login Google.
- Semua akun Google boleh login secara umum, tetapi akses CBT tetap memerlukan row roster.
- Email dinormalisasi lowercase dan dibandingkan sebagai exact match.

## 8. Endpoint yang Direncanakan

| Endpoint | Akses | Fungsi |
|---|---|---|
| `GET /auth/google` | Public | Mulai OAuth |
| `GET /auth/google/callback` | Public | Verify callback dan buat session |
| `GET /api/logout` | Public | Cabut session |
| `GET /api/me` | Login | Ambil user, role, dan scope |
| `GET /api/assessments` | Guru/Admin | Daftar assessment milik user |
| `POST /api/assessments` | Guru/Admin | Buat assessment baru |
| `PUT /api/assessments/:id` | Owner/Admin | Ubah metadata, mode, dan aturan |
| `POST /api/assessments/:id/roster` | Owner/Admin | Tambah roster siswa |
| `DELETE /api/assessments/:id/roster/:rosterId` | Owner/Admin | Nonaktifkan/hapus roster |
| `GET /api/assessments/:slug/access` | Public | Resolusi mode public atau assigned |
| `POST /api/assessments/:slug/attempts` | Siswa | Mulai atau resume attempt |
| `GET /api/attempts/:id` | Pemilik attempt | Status, server time, deadline, draft |
| `PATCH /api/attempts/:id/draft` | Pemilik attempt | Autosave draft |
| `POST /api/attempts/:id/submit` | Pemilik attempt | Finalisasi idempotent |
| `GET /api/attempts/:id/result` | Pemilik/guru sesuai policy | Ambil hasil |
| `GET /api/assessments/:id/results` | Owner/Admin | Laporan hasil |

Route lama `/api/save/:slug` dan `/api/submit/:slug` hanya boleh digunakan untuk assessment public/legacy. Route tersebut tidak boleh membuat attempt CBT baru.

## 9. Lifecycle CBT

1. Guru membuat assessment dengan mode `assigned`.
2. Guru menambahkan roster email siswa.
3. Guru mengatur duration, deadline, `max_attempts`, dan release hasil.
4. Siswa login Google dan memulai akses.
5. Worker membuat attempt dengan `started_at` dan `expires_at` server-side.
6. Browser menampilkan timer berdasarkan `server_now` dan deadline yang dikembalikan Worker.
7. Answers di-autosave ke local cache dan D1.
8. Setiap request draft memeriksa session, attempt, deadline, dan revision.
9. Submit yang berhasil mengubah status menjadi `submitted` dengan conditional update.
10. Submit ulang dengan attempt yang sama mengembalikan hasil yang sama tanpa membuat row kedua.
11. Setelah deadline, attempt ditandai expired dan jawaban terakhir tetap dapat difinalisasi secara aman.
12. Guru dapat melihat hasil setelah policy mengizinkan.

## 10. Perubahan Frontend

### Dashboard guru

File utama: `src/index.ts` dan template HTML dashboard.

- Ganti form password dengan tombol Google.
- Tampilkan daftar assessment milik guru.
- Tampilkan badge `Public` atau `CBT`.
- Tambahkan action untuk membuat roster, mengatur durasi, dan membuka laporan.

### Editor kuiz

File utama: `src/quiz-editor.ts` dan `public/vendor/quiz-editor.js`.

- Simpan operational settings terpisah dari `QuizSpec`.
- Tambahkan pilihan mode public/assigned.
- Tambahkan duration, deadline, max attempts, dan release result.
- Jangan memasukkan ID siswa, deadline, atau secret ke JSON soal.

### Student gate

- Halaman assigned menampilkan login Google jika belum authenticated.
- Setelah login, server menentukan apakah email terdaftar.
- Halaman CBT tidak mempercayai name field dari browser.
- Nama dan email untuk report berasal dari session/roster server.

### Halaman kuis

File utama: `src/quiz-page.ts` dan `public/vendor/quiz.css`.

- Tambahkan timer server-authoritative.
- Tambahkan status autosave dan retry.
- Simpan draft dengan attempt ID.
- Hapus `localStorage` attempt setelah submit berhasil.
- Nonaktifkan form setelah status submitted/expired.
- Tidak menampilkan kunci jawaban pada assigned mode sebelum policy mengizinkan.
- Mempertahankan flow public lama agar link existing tidak rusak.

## 11. Ownership Konten Baru

- Assessment baru menyimpan `owner_user_id` dan `content_prefix`.
- Deploy/generate baru menulis metadata ke D1 dan konten ke KV dengan prefix owner/assessment.
- Guru tidak boleh membuat atau mengubah assessment dengan ID milik guru lain.
- Slug global tetap menjadi fallback khusus legacy public.
- Admin dapat melihat, menonaktifkan, atau mentransfer assessment jika diperlukan di fase berikutnya.
- TKA dan media legacy tidak ikut diubah menjadi milik guru pada fase pertama.

## 12. Hardening Wajib

Sebelum mode assigned diaktifkan:

1. Hapus static cookie `authenticated_user` dari `src/auth.ts`.
2. Hapus fallback password `admin123` dari `src/index.ts`.
3. Satukan semua pemeriksaan admin melalui middleware/session resolver.
4. Jangan menerima role, email, score, atau deadline dari client sebagai authoritative.
5. Batasi CORS dan validasi ukuran/format payload.
6. Hentikan fail-open grading pada CBT; error berarti attempt belum finalized.
7. Kunci endpoint print/kunci pada assigned mode.
8. Pastikan guru A tidak dapat mengakses report, media, source, atau assessment guru B.
9. Escape semua nilai dinamis di report, editor, dan roster.
10. Tambahkan rate limit untuk endpoint public dan OAuth callback.

## 13. Fase Implementasi

### Fase 0 — Fondasi auth

- Buat helper session dan normalisasi user.
- Implementasikan Google OAuth authorization-code flow.
- Verifikasi ID token/JWKS, state, nonce, PKCE, dan claim.
- Ganti password login lama.
- Tambahkan tabel users, auth_sessions, dan config secrets.

Hasil: guru dapat login dan dashboard lama tetap dapat dipanggil.

### Fase 1 — Ownership assessment

- Tambahkan tabel assessments dan owner lookup.
- Namespace KV untuk konten baru.
- Batasi dashboard dan mutation ke owner/admin.
- Tampilkan assessment legacy public tanpa memindahkan owner.

Hasil: guru dapat membuat dan mengelola kuiznya sendiri.

### Fase 2 — Roster dan assigned gate

- Tambahkan assessment_students.
- Tambahkan form roster dan validasi email.
- Tambahkan login gate pada link assigned.
- Tolak akun Google yang emailnya tidak terdaftar.

Hasil: siswa hanya dapat masuk ke CBT yang terdaftar.

### Fase 3 — Attempt lifecycle

- Tambahkan quiz_attempts dan quiz_drafts.
- Implementasikan start/resume, duration, deadline, autosave, expiry, dan submit idempotent.
- Simpan content version saat attempt dimulai.
- Adaptasi grading, essay grading, dan reports ke attempt canonical state.

Hasil: satu siswa hanya memiliki satu attempt CBT yang valid.

### Fase 4 — UI dan kompatibilitas

- Tambahkan login page dan status session.
- Tambahkan timer/autosave UI.
- Perbaiki cleanup localStorage dan retry submit.
- Pertahankan public quiz flow dan legacy report.
- Tambahkan filter/pagination report.

Hasil: guru dan siswa dapat menggunakan alur end-to-end.

### Fase 5 — Validasi dan rollout

- Jalankan test lokal dan typecheck.
- Jalankan migration lokal lalu staging.
- Daftarkan redirect URI Google untuk production dan staging.
- Uji dengan dua guru dan 30 siswa.
- Pastikan guru hanya melihat assessment miliknya.
- Pastikan link public lama tetap terbuka.
- Aktifkan assigned mode bertahap setelah smoke test.

## 14. Konfigurasi Deployment

Nilai berikut disimpan sebagai secret/variable Cloudflare, bukan di repository:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET
ADMIN_EMAILS
APP_URL
```

Google OAuth redirect URI harus sama persis dengan callback Worker pada environment yang digunakan. Callback yang diharapkan:

```text
/auth/google/callback
```

Production dan staging sebaiknya memakai OAuth client atau callback registration yang terpisah.

## 15. Pengujian

Perintah wajib:

```text
npm test
npm run typecheck
```

Test yang perlu ditambahkan:

- Google state, nonce, PKCE, signature, issuer, audience, expiry, dan `email_verified`.
- Guru A tidak dapat membaca atau mengubah assessment guru B.
- Legacy public quiz tetap dapat dibuka dan disubmit.
- Account Google yang tidak ada di roster ditolak dari CBT.
- Guru hanya melihat assessment miliknya.
- Timer dimulai sekali dan tidak reset setelah reload.
- Draft ditolak setelah submit atau deadline.
- Dua submit bersamaan menghasilkan satu attempt final.
- Retry submit mengembalikan hasil yang sama.
- Score dan deadline dari client tidak dipercaya.
- Kunci jawaban tidak bocor pada assigned mode.
- Laporan CBT hanya menampilkan attempt milik assessment yang diminta.
- Error grading tidak menulis final record pretending success.

## 16. Acceptance Criteria

- Guru login melalui Google dan dapat membuat assessment baru.
- Guru hanya melihat kuiz yang ia buat/generate sendiri.
- Guru dapat mengubah metadata dan operational settings kuiz miliknya.
- Guru dapat menambah/menghapus email siswa pada assessment miliknya.
- Siswa dapat login dengan Google dan hanya email terdaftar yang dapat memulai CBT.
- Attempt siswa memiliki deadline server yang tidak dipengaruhi jam browser.
- Jawaban tersimpan otomatis dan dapat dipulihkan.
- Submit berulang tidak menghasilkan nilai ganda.
- Hasil CBT tidak tampil sebelum policy guru mengizinkan.
- Kuiz lama tetap public dan tidak rusak.
- `npm test` dan `npm run typecheck` lulus.

## 17. Milestone deployment

1. Migration D1 lokal.
2. Google OAuth client untuk local/staging.
3. Secret staging terpasang.
4. Smoke test dua guru.
5. Smoke test satu siswa terdaftar dan satu email tidak terdaftar.
6. Uji 30 siswa dengan timer dan autosave.
7. Deploy production.
8. Verifikasi link public legacy setelah deploy.

## 18. Keputusan tetap

- Auth tetap satu backend di Worker.
- Guru dan siswa memakai provider Google yang sama.
- Semua Google boleh login, tetapi akses CBT memakai roster.
- Guru terdaftar hanya mengelola kuiz baru miliknya.
- Kuiz lama tetap public.
- CBT baru dimulai dengan aturan ketat dan satu attempt.
- Tidak menambah backend auth terpisah pada fase pertama.
