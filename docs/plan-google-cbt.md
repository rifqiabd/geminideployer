# Rencana Implementasi Google Login & CBT Terdaftar

Status: **Disetujui — belum diimplementasikan** (prasyarat auth sudah selesai 28 Sep 2026 lewat `docs/plan-hardening-auth.md`; OAuth, ownership, roster, dan attempt di plan ini masih belum dimulai)
Tanggal: 25 September 2026
Revisi: 26 September 2026 (verifikasi terhadap codebase, koreksi factual §4, penambahan migration tooling, test harness, endpoint admin, throttle autosave, rollback)
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
- Mode baru default ke `public`, dan assigned mode hanya diaktifkan eksplisit per assessment, sehingga ada kill switch saat rollout.
- Verifikasi ID token memakai library `jose`, bukan implementasi JWT sendiri.
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
- Migration tooling: direktori `migrations/`, npm script untuk local dan remote, dan keputusan status file `schema.sql`.
- Harness tes HTTP: helper `app.request()` dengan mock KV dan mock D1, dipakai bersama oleh seluruh test baru.
- Endpoint admin untuk manajemen role guru dan escape hatch bootstrap.

### Tidak termasuk pada fase pertama

- Proctoring kamera, webcam, atau deteksi kecurangan.
- Login Google Workspace khusus domain sekolah; daftar email tetap dipakai.
- Multi-sekolah dengan billing, kuota per tenant, atau super-admin multi-tenant.
- Pemindahan otomatis seluruh kuiz lama ke owner tertentu.
- Fitur berbagi kuiz antar guru.
- Collaboration real-time pada satu soal.
- Migrasi aplikasi HTML/React lama menjadi CBT.
- Multi-attempt untuk siswa. `max_attempts` tetap ada di skema dan di-constraint ke `1` pada fase pertama.
- Cron Trigger untuk menandai attempt expired. Expired dihitung lazy saat request, bukan oleh scheduler.

## 4. Kondisi Saat Ini

> **Status per 28 September 2026:** temuan autentikasi di bagian ini sudah
> ditangani oleh `docs/plan-hardening-auth.md` (sesi HMAC, hapus fallback,
> CSRF, CORS allowlist, rate limit login, kunci `?kunci=1`, `apiKey` BYOK).
> Teks asli dipertahankan sebagai konteks historis — jangan dipakai sebagai
> gambaran kode saat ini. Temuan ownership/attempt (bagian konten, student
> flow, penyimpanan) masih berlaku dan baru ditutup oleh Fase 1-3 plan ini.

### Autentikasi

> **Sudah tidak berlaku (30 Sep 2026).** Seluruh butir di bawah menggambarkan
> kode SEBELUM `docs/plan-hardening-auth.md` dieksekusi. Sesi kini HMAC
> bertanda tangan, `admin123` dihapus, `/api/login` ber-rate-limit fail-closed,
> CORS dipecah dua lapis, semua form ber-CSRF, dan `?kunci=1` tanpa sesi → 404.
> Dipertahankan untuk riwayat; **jangan** dipakai sebagai gambaran kode saat ini.

- ~~`src/auth.ts:11-13` (`isAuthed`) hanya membandingkan cookie dengan literal `authenticated_user`.~~
- ~~`src/index.ts:537-556` memakai satu password bersama dan masih memiliki fallback `admin123` (`index.ts:34`).~~
- ~~Tidak ada Hono auth middleware. Pemeriksaan auth terpecah menjadi dua gaya:~~
  - ~~`isAuthed(c)` di 13 route~~ / ~~`getCookie(c, 'auth_session')` mentah di 5 route~~
- ~~`/api/login` tidak punya rate limit maupun CAPTCHA.~~
- ~~`app.use('/api/*', cors())` (`index.ts:37`) dipanggil tanpa argumen.~~
- ~~`/api/deploy`, `/api/delete`, dan `/api/app/update` adalah HTML form biasa tanpa token CSRF.~~

**Kondisi sekarang yang relevan untuk Fase 0–3:** auth sudah lewat
`getSession()`/`requireAdmin`, tapi masih **satu akun admin bersama** — belum ada
identitas, role, atau ownership. Itu bagian yang belum ditutup dan memang
menjadi isi Fase 0–1 plan ini.

### Konten dan kuiz

- Konten memakai key global seperti `html:<slug>`, `meta:<slug>`, `quiz:<slug>`, dan `quizsource:<slug>`. `meta:` tidak menyimpan owner; `saveApp` (`index.ts:94-106`) hanya menulis `{ title, slug, type, created_at, size }`.
- `POST /api/deploy` (`index.ts:1296-1344`) menyimpan hasil deploy tanpa owner. Tidak ada route `generate` di `index.ts`; pembuatan gambar AI ada di `POST /api/media/:slug/generate` (`media-routes.ts:171`) dan juga tanpa owner.
- Dashboard membaca seluruh daftar key `meta:` (`index.ts:563-567`) dengan satu `STORAGE.get` per key secara serial dan tanpa cursor pagination, sehingga tidak dapat memisahkan kuiz setiap guru.
- `/api/delete` (`index.ts:1346-1362`) menghapus key KV dan media saja. Tidak ada `DELETE` D1 di seluruh codebase, sehingga `app_records` milik app yang dihapus menjadi yatim.

### Student flow

- `src/quiz-page.ts:329-330` meminta nama bebas dari siswa, dan nama itu menjadi `user_id` di D1 dari body request: `body.user || body.name || body.student_name || 'anonim'` (`index.ts:205`).
- Draft browser memakai `localStorage` dengan key `quiz-attempt:<slug>` dan `quiz-student-name:<slug>` (`quiz-page.ts:381-382`), bukan attempt server. UUID yang dikembalikan server tidak pernah disimpan atau dipakai klien.
- `src/index.ts:196-268` (`saveRecordHandler`, dipakai bersama oleh `/api/save/:slug` dan `/api/submit/:slug`) membuat UUID baru di `:204` dan melakukan `INSERT` tanpa upsert di `:256-259`, sehingga retry selalu menambah row. Grading sudah dihitung ulang di server (`:215-216`), tetapi fail-open: spec yang gagal parse akan menyimpan payload mentah tanpa grading (`:251-253`).
- Draft tidak pernah dihapus setelah submit sukses; banner resume bisa muncul kembali.
- `quiz-page.ts:746` memakai identifier `KEY` yang tidak terdefinisi, sehingga `ReferenceError` tertelan `catch` kosong dan nama tidak tersimpan saat submit.
- Belum ada deadline server, maksimal attempt, resume resmi, atau idempotency.
- `?print=1&kunci=1` mengekspos kunci jawaban lewat `GET /p/:slug` (`index.ts:167-183`) yang sama sekali tidak punya auth check. Link di dashboard (`index.ts:1073,1244`) bukan gate.

### Penyimpanan

- `schema.sql:1-9` hanya memiliki `app_records` (5 kolom, 1 index). Tidak ada direktori `migrations/` dan tidak ada migration runner; `package.json` hanya punya `test` dan `typecheck`.
- Belum ada tabel user, session, assessment, roster, attempt, atau draft.
- Tidak ada foreign key, transaksi, atau batch query D1 di seluruh codebase; semua write adalah `prepare().run()` tunggal. Unique constraint dan conditional update untuk `quiz_attempts` akan menjadi pemakaian pertama fitur-fitur tersebut.
- `STORAGE` memakai `remote: true` di production maupun staging saat dokumen ini ditulis (`wrangler.jsonc:34,51`); **sejak 30 Sep 2026 nilainya `false`** (lihat §17). `wrangler d1 execute --local` selalu store terpisah dari KV.
- Data lama harus tetap dapat dibaca oleh route public dan laporan.

### Media dan laporan

- `GET /media/:slug/:name` (`media-routes.ts:69-91`) sepenuhnya publik tanpa auth karena halaman kuis siswa meng-embed gambar. Header `Cache-Control: public, max-age=3600` membuat cache bersama ikut menyimpan konten tersebut.
- `MAX_MEDIA_PER_APP = 200` (`media.ts:30`) hanya dipakai sebagai `limit` pada `list()`, bukan sebagai write cap (`media.ts:92-109`). Upload ke-201 dan seterusnya berhasil tetapi tidak terlihat oleh `listMedia`, `deleteAllMedia`, dan `moveAllMedia`.
- `GET /api/media/:slug/gen-config` (`media-routes.ts:252-267`) mengembalikan `apiKey` BYOK plaintext ke sesi mana pun yang lolos auth.
- Semua submission hanya ada di D1 `app_records`; KV tidak menyimpan submission.
- Dua pembaca laporan, `GET /p/:slug/data` (`index.ts:276-532`) dan `GET /p/:slug/essay` (`quiz-essay.ts:39-262`), membaca `app_records` saja. `POST /api/quiz/:slug/essay` menulis ulang seluruh `payload_json` (`quiz-essay.ts:337-339`) dan mensyaratkan `payload.answers` (`:299-301`).
- Dependency total hanya `hono`. Tidak ada library JWT/JWKS, `crypto.subtle` tidak pernah dipakai, dan subpath `hono/jwt`, `hono/csrf`, `hono/rate-limiter` sudah tersedia tapi belum diimpor.
- Tidak ada HTTP test harness. `tests/quiz.test.mjs` memakai helper `check()` buatan sendiri, hanya mengimpor modul pure, dan tidak pernah mengimpor `src/index.ts` atau route HTTP apa pun. Tidak ada mock KV maupun mock D1.

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

Migration baru dibuat pada `migrations/` dan diterapkan ke database lokal, staging, lalu production. Rinciannya di sub-bagian Migration tooling.

### Migration tooling

- `migrations/` menjadi sumber kebenaran skema. `schema.sql` tetap dipertahankan sebagai baseline legacy `app_records` dan tidak lagi diedit manual setelah fase 0.
- Dua file migration, bukan satu file besar: `migrations/0001_auth_cbt.sql` (users, auth_sessions, assessments) dan `migrations/0002_cbt_runtime.sql` (assessment_students, quiz_attempts, quiz_drafts). Pemisahan ini membuat migration auth bisa di-rollback tanpa menyentuh tabel runtime CBT.
- Dua npm script baru: `db:migrate:local` (`wrangler d1 migrations apply gemini-db --local`) dan `db:migrate:remote` (tanpa `--local`). Keduanya melacak migration yang sudah diterapkan, jadi aman dijalankan berulang dan cukup sekali per environment.
- Sebelum `db:migrate:local` pertama, `schema.sql` tetap dipakai untuk membuat `app_records` di D1 lokal, karena kedua store itu terpisah.
- Migration tidak pernah menghapus atau mengubah tabel `app_records`.

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
| `show_result` | Apakah hasil boleh dibuka siswa, lihat sub-bagian `show_result` |
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

Index yang dibutuhkan: `(user_id, status)` untuk resolusi attempt aktif, `(assessment_id, submitted_at)` untuk laporan.

Status `expired` tidak pernah ditulis oleh scheduler. Statusnya dihitung lazy: setiap pembacaan attempt memeriksa `expires_at` terhadap `now` dan, bila sudah lewat, menjalankan conditional update `in_progress` → `expired` sebelum mengembalikan jawaban. Catatan: attempt yang sudah `expired` masih boleh di-submit dalam grace window 5 menit untuk memfinalisasi jawaban terakhir (§9).

### `quiz_drafts`

| Kolom | Fungsi |
|---|---|
| `attempt_id` | Primary key dan relasi attempt |
| `answers_json` | Jawaban yang tersimpan |
| `flags_json` | Tandai ragu |
| `revision` | Versi draft untuk konflik multi-tab |
| `updated_at` | Waktu autosave terakhir |

Batas ukuran `answers_json` diperiksa di server saat autosave, dengan batas longgar 512 KB. Kalau lewat, request ditolak 413 dan browser menyimpan jawaban secara lokal sambil menampilkan peringatan; autosave berikutnya tetap mencoba. `answers_json` untuk kuis esai panjang bisa jadi sumber row terbesar, jadi batas ini diukur terhadap payload `app_records` terbesar yang sudah ada sebelum nilainya ditetapkan permanen.

### Legacy `app_records`

- `app_records` tetap dipertahankan untuk public/legacy submission.
- Data CBT authoritative berada di `quiz_attempts`.
- Laporan harus dapat membaca kedua sumber tanpa mengubah format payload lama.
- Bentuk payload `quiz_attempts.result_json` sengaja dibuat sama dengan payload `app_records` (`{ student_name, quiz_title, answers, grading, summary, ... }`) supaya `computeItemAnalysis` (`quiz-report.ts:173`) dan renderer laporan dapat dipakai tanpa perubahan. Kedua sumber harus menghasilkan objek dengan bentuk yang sama agar item analysis tidak terpecah menjadi dua implementasi.
- Konflik yang harus diselesaikan eksplisit di Fase 3, bukan disamarkan di dalam reader:
  - `GET /p/:slug/data` dan `GET /p/:slug/essay` saat ini membaca `app_records` saja. Keduanya perlu dual-read: assessment `public` dari `app_records`, assessment `assigned` dari `quiz_attempts`.
  - `POST /api/quiz/:slug/essay` menulis ulang seluruh `payload_json` dan mensyaratkan `payload.answers` (`quiz-essay.ts:299-301,337-339`). Untuk attempt CBT, jalur ini menulis `result_json` dengan conditional update dan tidak boleh menimpa draft yang sedang tersimpan autosave.

### `show_result`

- `show_result = false` berarti `/api/attempts/:id/result` mengembalikan 403 dan halaman siswa menampilkan status "sudah dikumpulkan, menunggu nilai guru", bukan skor kosong atau nol.
- `show_result = true` berarti siswa melihat hasil attempt miliknya sendiri saja; guru melihat semua attempt pada assessment-nya.
- `show_result` tidak pernah diperhitungkan dari nilai yang dikirim browser.

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

- `ADMIN_EMAILS` dibaca dari env dan hanya menentukan role `admin` saat user pertama kali dibuat. Nilai ini tidak pernah ditulis dari client.
- Escape hatch wajib ada karena `ADMIN_EMAILS` yang salah atau kosong akan mengunci semua orang dari dashboard. Jalur pemulihan didokumentasikan di `docs/panduan-pakai.md`:
  ```text
  npx wrangler d1 execute gemini-db --remote --command "UPDATE users SET role='admin' WHERE email='guru@sekolah.id'"
  ```
- Admin dapat menambah email guru melalui panel internal.
- Guru tidak otomatis menjadi teacher hanya karena login Google.
- Semua akun Google boleh login secara umum, tetapi akses CBT tetap memerlukan row roster.
- Email dinormalisasi lowercase dan dibandingkan sebagai exact match.
- Role `student` tidak pernah ditulis dari client. `assessment_students` adalah satu-satunya sumber kebenaran.

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
| `GET /api/teachers` | Admin | Daftar user role guru |
| `POST /api/users/:id/role` | Admin | Ubah role user |
| `DELETE /api/assessments/:id` | Owner/Admin | Hapus assessment baru beserta attempt-nya |

Route lama `/api/save/:slug` dan `/api/submit/:slug` hanya boleh digunakan untuk assessment public/legacy. Route tersebut tidak boleh membuat attempt CBT baru.

`/api/delete` yang ada sekarang (`index.ts:1346`) tetap global dan tidak punya owner check, karena hanya melayani legacy. Ia tidak dihapus, tetapi hanya menerima slug yang tidak terdaftar di `assessments`. Assessment baru memakai `DELETE /api/assessments/:id`, yang owner-scoped dan sekaligus menghapus `assessment_students`, `quiz_attempts`, dan `quiz_drafts` milik assessment tersebut. Untuk legacy, `app_records` tetap tidak ikut terhapus, mengikuti perilaku sekarang.

## 9. Lifecycle CBT

1. Guru membuat assessment dengan mode `assigned`.
2. Guru menambahkan roster email siswa.
3. Guru mengatur duration, deadline, `max_attempts`, dan release hasil.
4. Siswa login Google dan memulai akses.
5. Worker membuat attempt dengan `started_at` dan `expires_at` server-side.
6. Browser menampilkan timer berdasarkan `server_now` dan deadline yang dikembalikan Worker. Timer hanya menampilkan sisa waktu; keputusan submit tetap dibuat server.
7. Answers di-autosave ke local cache dan D1 dengan throttle (lihat di bawah).
8. Setiap request draft memeriksa session, attempt, deadline, dan revision.
9. Submit yang berhasil mengubah status menjadi `submitted` dengan conditional update.
10. Submit ulang dengan attempt yang sama mengembalikan hasil yang sama tanpa membuat row kedua.
11. Setelah deadline, attempt dihitung `expired` secara lazy. Jawaban terakhir tetap dapat difinalisasi dalam grace window 5 menit; setelah itu submit mengembalikan 409.
12. Guru dapat melihat hasil setelah policy mengizinkan.

### Throttle autosave

Autosave tidak berjalan per keystroke. Aturannya:

- Debounce 3 detik setelah perubahan terakhir, plus flush paksa saat `blur`, `visibilitychange`, dan `pagehide`.
- Draft lokal (`localStorage`) ditulis pada setiap perubahan; D1 hanya menerima hasil debounce.
- Draft lokal memakai key yang memuat attempt ID, bukan slug saja, sehingga draft lama tidak terbaca sebagai attempt yang sekarang.
- Setiap flush mengirim `revision` monoton. Response berisi revision server; revision yang lebih rendah diabaikan dan draft lokal di-merge, bukan ditimpa.
- Kalau flush gagal karena jaringan, state `menyimpan`/`gagal` ditampilkan di UI dan flush diulang dengan backoff. Draft lokal tetap menjadi sumber pemulihan.
- Setelah submit sukses, localStorage untuk attempt tersebut dihapus di `finally`, bukan hanya di jalur sukses.

### Batas attempt

`max_attempts` di-constraint ke `1` pada fase pertama. Satu siswa satu attempt valid per assessment. Kolom dan constraint `(assessment_id, user_id, attempt_number)` tetap disiapkan agar attempt kedua tidak memerlukan perubahan skema.

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
- Field name disembunyikan pada mode assigned, karena display name diambil dari `users` dan roster.

### Halaman kuis

File utama: `src/quiz-page.ts` dan `public/vendor/quiz.css`.

- Tambahkan timer server-authoritative.
- Tambahkan status autosave dan retry.
- Simpan draft dengan attempt ID.
- Hapus `localStorage` attempt setelah submit berhasil, di blok `finally` supaya tetap bersih saat submit gagal lalu diulang.
- Perbaiki bug `KEY` undefined di `quiz-page.ts:746`.
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
- Media assessment baru memakai prefix yang memuat assessment ID, sehingga resolusi `slug → assessment → content_prefix` memungkinkan route media bersifat mode-aware. Key `media:<slug>:<name>` yang ada sekarang tidak diubah dan tetap dibaca untuk legacy.

### Media pada mode assigned

`GET /media/:slug/:name` (`media-routes.ts:69-91`) hari ini sengaja publik supaya halaman kuis siswa bisa meng-embed gambar. Pada mode assigned, route ini harus:

- Resolve slug ke assessment lebih dulu. Assessment `public` atau slug legacy dilayani seperti sekarang.
- Assessment `assigned` memerlukan session yang lolos gate roster; selain itu 401/403.
- Mengirim `Cache-Control: private, no-store` alih-alih `public, max-age=3600`, karena cache bersama akan membocorkan konten assigned ke pihak lain. Ini juga membatalkan cache lama untuk URL yang sama, jadi slug assigned sebaiknya tidak pernah memakai slug yang sudah pernah dipakai public.
- Placeholder 404 tetap served inline seperti sekarang agar halaman siswa tidak rusak.

## 12. Hardening Wajib

Sebelum mode assigned diaktifkan:

1. Hapus static cookie `authenticated_user` dari `src/auth.ts`. **[Selesai 28 Sep 2026 — plan-hardening-auth: cookie statis ditolak, diganti sesi HMAC.]**
2. Hapus fallback password `admin123` dari `index.ts:34`, dan hapus `/api/login` password bersama sepenuhnya. **[Sebagian selesai 28 Sep 2026 — fallback admin123 sudah dihapus, `SESSION_SECRET`+`APP_PASSWORD` wajib; `/api/login` password masih dipakai sampai Fase 0 ini menggantinya dengan Google OAuth.]**
3. Satukan semua pemeriksaan admin melalui middleware/session resolver baru. Kelima pembacaan cookie mentah (`index.ts:277,559,1297,1347,1368`) harus hilang, dan `isAuthed` yang tersisa harus versi session-aware. **[Selesai 28 Sep 2026 — plan-hardening-auth: semua pemeriksaan lewat `getSession()`/`requireAdmin`/guard per modul; cookie mentah tidak ada lagi.]**
4. Jangan menerima role, email, score, atau deadline dari client sebagai authoritative.
5. Ganti `app.use('/api/*', cors())` (`index.ts:37`) dengan konfigurasi eksplisit: origin allowlist dari env, `allowCredentials` dengan origin konkret (bukan `*`), dan method/header yang dibatasi. Endpoint auth, assessment, dan attempt tidak boleh menerima origin liar. **[Selesai 28 Sep 2026 — plan-hardening-auth T5: endpoint publik siswa tetap `*`, sisanya allowlist `ALLOWED_ORIGINS`.]**
6. Tambahkan token CSRF pada tiga form POST yang ada (`/api/deploy`, `/api/delete`, `/api/app/update`) atau ganti ke `fetch` dengan header custom. `SameSite=Lax` sendiri tidak cukup sebagai satu-satunya proteksi. **[Selesai 28 Sep 2026 — plan-hardening-auth T4: bukan cuma tiga form, semua 10 form + 7 call site fetch kini wajib token CSRF.]**
7. Validasi ukuran dan format payload di setiap endpoint baru. Batas 8 MB hanya berlaku untuk media; body JSON perlu batas sendiri yang eksplisit.
8. Hentikan fail-open grading. Pada CBT, kegagalan `gradeSubmission` berarti attempt belum finalized dan submit mengembalikan 503 tanpa menulis row. Perilaku fail-open yang ada di `index.ts:251-253` dipertahankan hanya untuk legacy `/api/save/:slug` dan `/api/submit/:slug`, dan harus dianotasi sebagai legacy di kode.
9. Kunci `?print=1` dan `?print=1&kunci=1` di `index.ts:167-183` pada mode assigned. Penyesuaian dilakukan di server, bukan dengan menyembunyikan link di dashboard. **[Lebih ketat sejak 28 Sep 2026 — plan-hardening-auth T6: `kunci=1` tanpa sesi admin dijawab 404 untuk SEMUA mode, jadi mode assigned tinggal mewarisi.]**
10. Pastikan guru A tidak dapat mengakses report, media, source, assessment, atau attempt guru B. Untuk media, lihat §11 karena route-nya publik.
11. Hapus `apiKey` plaintext dari response `GET /api/media/:slug/gen-config` (`media-routes.ts:252-267`); cukup kirim flag "sudah terisi" atau bagian tersamar, dan paksa `Cache-Control: no-store` supaya `apiKey` tidak tersimpan di cache browser atau proxy. **[Selesai 28 Sep 2026 — plan-hardening-auth T7: respons kini `hasKey`, no-store, dan simpan tanpa mengetik ulang kunci mempertahankan kunci lama.]**
12. Ubah `GET /api/media/:slug/gen-config` menjadi POST-only, karena endpoint yang mengembalikan secret tidak boleh dipicu lewat GET yang bisa di-cache atau di-prerefetch. **[Diputuskan TIDAK dikerjakan — plan-hardening-auth T7: setelah `apiKey` dihapus, respons GET tidak lagi berisi secret, jadi churn POST-only tidak perlu.]**
13. Escape semua nilai dinamis di report, editor, roster, dan attempt list. Nama siswa dan display name berasal dari input eksternal.
14. Tambahkan rate limit untuk endpoint public, `/api/login`, OAuth callback, dan endpoint attempt. Mekanisme yang sudah ada (`media-routes.ts:185-196`, key `imggen:<slug>:<minuteBucket>`) dapat dijadikan pola, tetapi fail-open pada KV error harus diubah menjadi fail-closed untuk endpoint auth.

## 13. Fase Implementasi

### Fase 0 — Tooling dan fondasi auth

Fase ini sengaja lebih banyak dari UI karena dua hal harus berdiri lebih dulu.

- Tambahkan `migrations/` plus npm script `db:migrate:local` dan `db:migrate:remote`, dan jalankan yang lokal.
- Bangun harness tes HTTP: helper env dengan mock KV (get/put/delete/list dengan dukungan `prefix` dan cursor) dan mock D1 (prepare/bind/run/first/all plus simulasi unique constraint), lalu helper `callRoute(app, method, path, body, cookie)`. Taruh di `tests/helpers/`.
- Tambahkan `jose` sebagai dependency tunggal untuk ID token dan JWKS. Verifikasi JWT tidak ditulis tangan.
- Buat helper session, resolusi user, dan normalisasi email.
- Implementasikan Google OAuth authorization-code flow dengan PKCE, `state`, dan `nonce` yang disimpan server-side (KV, TTL 10 menit) atau di cookie HttpOnly bertanda tangan.
- Verifikasi ID token: signature via JWKS, `iss`, `aud`, `exp`, `nonce`, dan `email_verified`.
- Ganti password login lama: hapus `FALLBACK_PASSWORD` (`index.ts:34`) dan route `/api/login`.
- Satukan auth lewat middleware baru; hapus kelima pembacaan cookie mentah di `index.ts`.
- Tambahkan tabel `users` dan `auth_sessions` lewat `migrations/0001_auth_cbt.sql`.
- Perbaiki CORS dan tambahkan proteksi CSRF pada tiga form POST lama.

Hasil: guru dapat login via Google, dashboard lama tetap terpanggil, dan test HTTP bisa ditulis.

### Fase 1 — Ownership assessment

- Tambahkan tabel assessments dan owner lookup.
- Namespace KV untuk konten baru.
- Batasi dashboard dan mutation ke owner/admin.
- Tampilkan assessment legacy public tanpa memindahkan owner.
- Tambahkan `DELETE /api/assessments/:id` yang owner-scoped dan membersihkan attempt-nya.

Hasil: guru dapat membuat dan mengelola kuiznya sendiri.

### Fase 2 — Roster dan assigned gate

- Tambahkan assessment_students.
- Tambahkan form roster dan validasi email.
- Tambahkan login gate pada link assigned.
- Tolak akun Google yang emailnya tidak terdaftar.
- Kunci `?print=1` dan `?print=1&kunci=1` pada mode assigned di `index.ts:167-183`.
- Jadikan `GET /media/:slug/:name` mode-aware dengan cache privat untuk assigned.

Hasil: siswa hanya dapat masuk ke CBT yang terdaftar.

### Fase 3 — Attempt lifecycle

- Tambahkan quiz_attempts dan quiz_drafts.
- Implementasikan start/resume, duration, deadline, autosave ber-throttle, lazy expiry, dan submit idempotent.
- Simpan content version saat attempt dimulai.
- Ubah fail-open grading: kegagalan pada attempt berarti belum finalized.
- Dual-read laporan: `GET /p/:slug/data` dan `GET /p/:slug/essay` membaca `quiz_attempts` untuk assessment assigned dan `app_records` untuk yang public.
- Ubah `POST /api/quiz/:slug/essay` agar menulis `result_json` dengan conditional update untuk attempt CBT, dan tidak menimpa draft yang sedang autosave.
- Pastikan `result_json` berbentuk sama dengan payload `app_records` supaya `computeItemAnalysis` dipakai utuh.

Hasil: satu siswa hanya memiliki satu attempt CBT yang valid, dan esai CBT bisa dikoreksi guru.

### Fase 4 — UI dan kompatibilitas

- Tambahkan login page dan status session.
- Tambahkan timer/autosave UI sesuai aturan throttle di §9.
- Perbaiki cleanup localStorage (termasuk bug `KEY` undefined di `quiz-page.ts:746`) dan retry submit.
- Pertahankan public quiz flow dan legacy report.
- Tambahkan filter/pagination report.

Hasil: guru dan siswa dapat menggunakan alur end-to-end.

### Fase 5 — Validasi dan rollout

- Jalankan `npm test` dan `npm run typecheck`.
- Jalankan `db:migrate:local`, lalu `db:migrate:remote` untuk staging.
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
ALLOWED_ORIGINS
OAUTH_STATE_KV
```

Penjelasan singkat:

- `SESSION_SECRET` menandatangani cookie state/nonce OAuth dan cookie session browser. `token_hash` yang disimpan di D1 adalah SHA-256 dari token opaque, bukan hasil HMAC, jadi `SESSION_SECRET` bukan sumber token melainkan sumber tanda tangan cookie.
- `ALLOWED_ORIGINS` dipakai untuk CORS allowlist. Nilai kosong berarti hanya origin yang sama dengan `APP_URL`, bukan `*`.
- `OAUTH_STATE_KV` adalah namespace KV baru khusus state dan nonce OAuth dengan TTL, supaya tidak bercampur dengan `STORAGE` (yang sejak 30 Sep 2026 memakai `remote: false`).

Urutan pemasangan per environment (ganti nama env untuk staging):

```text
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler kv namespace create OAUTH_STATE
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put APP_URL
npx wrangler secret put ALLOWED_ORIGINS
```

`GOOGLE_CLIENT_ID` dan `ADMIN_EMAILS` boleh berupa var biasa, tapi tetap dipasang lewat secret agar tidak ikut ter-commit di `wrangler.jsonc`.

Google OAuth redirect URI harus sama persis dengan callback Worker pada environment yang digunakan. Callback yang diharapkan:

```text
/auth/google/callback
```

Production dan staging memakai OAuth client terpisah dengan callback registration terpisah. `STORAGE` production dan staging juga sudah terpisah (`wrangler.jsonc:34,51`), jadi keduanya harus punya client, secret, dan namespace `OAUTH_STATE` sendiri.

## 15. Pengujian

Perintah wajib:

```text
npm test
npm run typecheck
```

Harness yang dipakai test baru: `tests/helpers/` berisi mock KV, mock D1 dengan simulasi unique constraint, dan `callRoute(app, method, path, body, cookie)`. Semua test di bawah memerlukan `app` yang diimpor dari `src/index.ts`, jadi harness adalah prasyarat, bukan pelengkap.

Test yang perlu ditambahkan:

- Google state, nonce, PKCE, signature, issuer, audience, expiry, dan `email_verified`.
- Callback yang dipakai ulang dua kali ditolak.
- Callback dengan `state` yang tidak cocok ditolak dan tidak membuat session.
- Cookie session menerapkan flag `HttpOnly`, `Secure`, dan `SameSite=Lax`.
- `SESSION_SECRET` yang salah membuat cookie tidak valid.
- Bootstrap `ADMIN_EMAILS`: email pertama yang cocok menjadi admin, email berikutnya tidak otomatis jadi admin.
- Guru A tidak dapat membaca atau mengubah assessment guru B.
- Legacy public quiz tetap dapat dibuka dan disubmit.
- Legacy `/api/save/:slug` dan `/api/submit/:slug` tetap dapat dipakai assessment public dan ditolak untuk slug yang terdaftar di `assessments`.
- `/api/delete` menolak slug yang terdaftar di `assessments`, dan `DELETE /api/assessments/:id` hanya bisa oleh owner atau admin.
- Account Google yang tidak ada di roster ditolak dari CBT.
- Guru hanya melihat assessment miliknya.
- Timer dimulai sekali dan tidak reset setelah reload.
- Draft ditolak setelah submit atau setelah deadline lewat grace window.
- Draft yang hilang `revision` tertinggal ditolak atau di-merge, bukan menimpa revision lebih baru.
- Dua submit bersamaan menghasilkan satu attempt final.
- Retry submit mengembalikan hasil yang sama.
- Score dan deadline dari client tidak dipercaya.
- Kunci jawaban tidak bocor pada assigned mode, termasuk lewat `?print=1&kunci=1`.
- Guru A tidak dapat memanggil `?print=1&kunci=1` untuk assessment assigned guru B.
- Media pada assessment assigned menolak request tanpa session, dan memakai `Cache-Control: private`.
- Media pada assessment public tetap publik dan tidak berubah perilakunya.
- Laporan CBT hanya menampilkan attempt milik assessment yang diminta.
- Dual-read laporan: assessment public membaca `app_records`, assessment assigned membaca `quiz_attempts`, dan keduanya menghasilkan bentuk payload yang sama untuk `computeItemAnalysis`.
- Essay grading pada attempt CBT tidak menimpa draft yang sedang autosave.
- `show_result = false` membuat `/api/attempts/:id/result` mengembalikan 403, bukan skor kosong.
- `show_result = true` hanya membuka hasil attempt milik siswa yang meminta.
- Error grading tidak menulis final record pretending success.
- Rate limit pada `/api/login` dan OAuth callback aktif, dan fail-closed saat KV error.
- CORS menolak origin yang tidak ada di `ALLOWED_ORIGINS` untuk endpoint `/api/*` yang rely cookie.

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
- `npm test` dan `npm run typecheck` lulus, dan test auth/CBT baru benar-benar dieksekusi lewat harness HTTP, bukan hanya unit test modul pure.

## 17. Milestone deployment

1. `migrations/` dan npm script migration, lalu `db:migrate:local`.
2. Harness tes HTTP di `tests/helpers/` dengan mock KV dan D1.
3. Google OAuth client untuk local/staging.
4. Namespace `OAUTH_STATE` dibuat, lalu secret staging terpasang.
5. Smoke test dua guru.
6. Smoke test satu siswa terdaftar dan satu email tidak terdaftar.
7. Uji 30 siswa dengan timer dan autosave.
8. Deploy production.
9. Verifikasi link public legacy setelah deploy.
10. Aktifkan assigned mode bertahap per assessment, bukan per environment.

### Peringatan store lokal

> **Koreksi (30 Sep 2026):** `STORAGE` kini memakai `remote: false` di
> `wrangler.jsonc` untuk production maupun staging — diubah setelah kuota
> harian KV free (1.000 tulis/hari) habis oleh sesi `wrangler dev` yang
> terhubung ke namespace produksi. Paragraf di bawah adalah kondisi saat
> dokumen ini ditulis; yang masih benar hanyalah pemisahan store.

Saat dokumen ini ditulis, `STORAGE` memakai `remote: true` di kedua env (`wrangler.jsonc:34,51`). Konsekuensi untuk rollout:

- Smoke test yang menyentuh data (OAuth/CBT) tetap harus lewat **deploy staging**, bukan `wrangler dev`, supaya key state dan session tidak menyentuh data sekolah nyata. Alasan utamanya bukan lagi "`wrangler dev` menulis ke KV production", melainkan karena production dan staging punya binding terpisah dan hanya staging yang boleh dimutasi saat pengujian.
- `db:migrate:local` tidak menyentuh D1 production maupun staging, jadi aman dijalankan kapan saja.

### Rollback

- `mode` default assessment baru adalah `public`. Assigned mode hanya diaktifkan eksplisit per assessment, jadi kegagalan pada satu assessment tidak berdampak ke quiz public lain.
- Kill switch: guru/admin dapat mengubah `mode` kembali ke `public` lewat `PUT /api/assessments/:id` tanpa menghapus attempt. Attempt yang sudah ada tetap terbaca di laporan.
- Migration tidak bersifat destruktif pada fase pertama, jadi rollback codebase cukup deploy ulang versi sebelumnya. Tabel yang terlanjur dibuat dibiarkan.
- Credentials bocor: cabut seluruh session lewat `UPDATE auth_sessions SET revoked_at = datetime('now') WHERE revoked_at IS NULL`, lalu rotasi `GOOGLE_CLIENT_SECRET` dan `SESSION_SECRET`.

## 18. Keputusan tetap

- Auth tetap satu backend di Worker.
- Guru dan siswa memakai provider Google yang sama.
- Semua Google boleh login, tetapi akses CBT memakai roster.
- Guru terdaftar hanya mengelola kuiz baru miliknya.
- Kuiz lama tetap public.
- CBT baru dimulai dengan aturan ketat dan satu attempt.
- Tidak menambah backend auth terpisah pada fase pertama.
- Verifikasi JWT memakai `jose`, bukan implementasi sendiri. Dependensi yang ditambahkan hanya `jose`.
- `auth_sessions` tetap di D1. Konsekuensinya setiap request terautentikasi menambah satu D1 read; ini diterima karena target 30 siswa.
- Expired attempt dihitung lazy saat request, tanpa Cron Trigger.
- `max_attempts` di-constraint ke 1 sampai fase berikutnya.

## 19. Catatan dokumen

- `docs/plan-google-cbt.md` adalah sumber kebenaran.
- `docs/plan-google-cbt.html` **bukan** hasil generate dari markdown. Itu dokumen companion yang ditulis tangan: 15 bagian bernomor, digabung dan diringkas, dengan hero, sidebar daftar isi, dan kartu `ok`/`info`/`warn`. Isinya intentional berbeda dari markdown, misalnya html menggabungkan §2 dan §3 menjadi satu bagian dan menulis "Roster dan access gate" di tempat markdown menulis "Roster dan assigned gate".
- Konsekuensinya: html tidak bisa "di-regenerate". Setiap kali plan berubah, html harus diperbarui manual, dan setiap perbedaan harus disengaja. Kalau suatu saat html tidak lagi bernilai, lebih baik hapus daripada membiarkannya menyesatkan.
- `docs/panduan-pakai.md`/`.html` dan `docs/analisis-resource.md`/`.html` perlu diperiksa sendiri: kalau keduanya memang hasil generate, catat perintah generate-nya di sini. Jangan diasumsikan polanya sama dengan plan.
- Dokumen user-facing (`docs/panduan-pakai.md`, `src/guide.ts`) ditulis dalam bahasa Indonesia dan harus ikut diperbarui saat alur login berubah.
- `tests/quiz.test.mjs` memverifikasi isi `docs/gemini-gem-prompt-full.md`, tapi `docs/plan-google-cbt.md` **tidak** diverifikasi test sama sekali. Plan tidak punya regression test; edit manual harus menjaga citation `file:line` tetap akurat.
