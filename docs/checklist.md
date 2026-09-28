# Checklist Gabungan Semua Rencana

Dihimpun dari `docs/plan-hardening-auth.md`, `docs/plan-google-cbt.md`,
`docs/analisis-resource.md`, `docs/strategi-publish-dan-sosialisasi.md`, dan
`docs/plan/panel-konteks-soal-di-slot-gambar.md`.

Status repo dicek ulang pada 28 September 2026. `[x]` berarti sudah selesai dan
terverifikasi, `[ ]` berarti belum.

**Asal setiap item ditulis dalam kurung** supaya tidak ada pekerjaan yang terhitung
dua kali — beberapa item muncul di dua dokumen sekaligus.

## Urutan Kerja Berikutnya

Urutan ini tidak boleh diacak. Urutan 1-11 adalah isi `docs/plan-hardening-auth.md`
dan totalnya sekitar 3,5 hari kerja.

1. Kerjakan auth T0 sampai T10 (bagian 1 di bawah).
2. Smoke test di staging.
3. Barulah pertimbangkan Fase 0 Google CBT.
4. Item lain (bagian 3-6) menunggu keputusan apakah CBT terdaftar benar-benar
   dibutuhkan untuk pilot sekolah pertama.

---

## 0. Sudah Selesai

### Slug, publish, dan publish path JSON-only — commit `e212039`

- [x] `randomSlugSuffix()` di `src/quiz-util.ts` — sufiks acak 4 karakter, huruf
      pertama, tanpa `i l o 0 1`.
- [x] `uniqueSlug()` di `src/index.ts` — enam percobaan, cek `meta:<candidate>`,
      cadangan timestamp base36.
- [x] `POST /api/deploy` mengecek bentrok slug sebelum menyimpan.
- [x] `quiz.slug` ditulis ulang ke slug final supaya penilaian server dan editor
      tidak menyimpang dari URL.
- [x] Publish dialihkan ke `/?app=<slug>` dan dashboard membuka panel detail.
- [x] Jalur publish HTML/React dihapus total: form mode, pill jenis kode,
      `cleanGeminiMarkdown()`, `wrapReactComponent()`, dan branch `/api/deploy`.
- [x] App lawas `akidah-akhlak-kelas-1` dibiarkan jalan: `/p/:slug` tetap
      menyajikan `html:<slug>`, rename tetap menyalin kodenya, tombol Edit Soal
      dan Koreksi Esai disembunyikan.
- [x] `POST /api/app/update` tetap menolak slug bentrok (400), bukan auto-suffix.
- [x] `tests/slug.test.mjs` dibuat dan dirangkai ke `npm test`.

### Tanggal sidebar — commit `f1885a2`

- [x] `parseStamp()` menolak tanggal lama dan ISO penuh.
- [x] `relTime()` — "Hari ini", "Kemarin", "N hari lalu", plus label tanggal.
- [x] `stampNow()` dipakai di `updated_at` rename dan editor soal.
- [x] `created_at` tidak lagi di-reset saat publish ulang.
- [x] `tests/meta-date.test.mjs` dibuat dan dirangkai.
- [x] Tanggal dibuat disembunyikan permanen di sidebar dan hanya muncul saat
      hover, di sebelah kiri tombol aksi (`margin-right:62px` supaya tidak
      tertutup). Label "Diubah ..." dipindah dari span inline ke tooltip
      `title="Dibuat ... · Diubah ..."`. `modSpan()` dihapus; `modTitle()` kini
      menyusun kedua label dan menolak app yang dua stempelnya kosong.
      *Belum di-commit.*

### Dokumen dan threat model — commit `d3df0ad`, `b396798`

- [x] `docs/plan-hardening-auth.md` ditulis (sesi HMAC, hapus fallback, CSRF,
      kunci jawaban, BYOK).
- [x] Model ancaman realistis untuk pilot satu sekolah, plus koreksi 30+
      referensi `file:line` yang bergeser.
- [x] `docs/gemini-gem-prompt-full.md` — bagian MODE B dihapus, bagian 7
      (kontrak penilaian di server) masuk sebagai gantinya.
- [x] `docs/gemini-gem-prompt.md` — tabel gambar dan aturan HTML/React dihapus.
- [x] `docs/panduan-pakai.md` dan `src/guide.ts` — alur publish ditulis ulang
      JSON-only, ditambah penjelasan bentrok slug.

### Verifikasi

- [x] `npm test` — tiga suite lulus.
- [x] `npm run typecheck` — bersih.
- [x] `npx wrangler deploy --dry-run` — bundle 432,99 KiB tanpa error.

### Housekeeping

- [x] Tiga file dirty bawaan di worktree tidak ikut ter-stage dan tidak
      di-revert: `docs/plan-google-cbt.html`, `docs/plan-google-cbt.md`,
      `tests/quiz.test.mjs`.
- [x] **Smoke test staging dijalankan** lewat `npx wrangler dev --env staging`
      (port 8791), lalu server dimatikan dan semua artefak test dihapus. Lolos:
      collision slug (3 publish dengan slug sama → `smoke-kolisi`,
      `smoke-kolisi-hc6y`, `smoke-kolisi-n9z9`, semua 302 ke `/?app=<slug>`),
      spec di `quiz:<slug>` ikut slug final, `quizsource:<slug>` tetap
      menyimpan slug mentah guru, app legacy `/p/` tetap 200 dengan `?print=1`
      dilewati, rename legacy menyalin `html` apa adanya lalu link lama 404,
      rename ke slug bentrok 400, submit lewat `/api/save` dan `/api/submit`
      dua-duanya regrading di server (`score: 100`, `lulus: true`), dan laporan
      `/p/:slug/data` menampilkan 2 rekaman plus analisis butir soal.
- [x] **D1 lokal staging sudah diberi skema** (28 September 2026).
      `npx wrangler d1 execute gemini-db-staging --env staging --local --file
      schema.sql` dijalankan dan diverifikasi: tabel `app_records` (5 kolom) dan
      index `idx_records_slug` ada, 0 baris. Catatan untuk orang berikutnya:
      `wrangler dev` memakai KV remote (ada flag `remote: true`) tapi D1
      **lokal**, karena binding `DB` tidak punya flag itu. Tanpa skema, semua
      route yang menyentuh D1 gagal dengan `D1_ERROR: no such table:
      app_records`. Perbaikannya satu perintah, tapi harus diketahui orang lain
      sebelum tes:
      `npx wrangler d1 execute gemini-db-staging --env staging --local --file schema.sql`
      (nama database di bawah `--env staging` adalah `gemini-db-staging`;
      `gemini-db` tidak resolve di env itu).

---

## 1. Hardening Auth — `docs/plan-hardening-auth.md`

Status dokumen: Disetujui, belum diimplementasikan. Ini prasyarat sebelum pilot
sekolah dan prasyarat `docs/plan-google-cbt.md` Fase 0.

### T0 — Env dan urutan deploy (WAJIB sebelum T1)

- [ ] `npx wrangler secret put SESSION_SECRET` (nilai dari `openssl rand -base64 32`)
- [ ] `npx wrangler secret put APP_PASSWORD` (hapus `admin123`)
- [ ] Ulangi keduanya dengan `--env staging`
- [ ] Tambah `SESSION_SECRET` ke `.dev.vars.example` (tanpa nilai nyata) dan ke
      `.dev.vars` lokal
- [ ] Halaman 503 saat secret kosong memuat dua perintah `wrangler secret put`
      dalam bahasa Indonesia, supaya tidak ada lockout yang butuh tebakan

> Kode akan menolak boot login kalau salah satu secret kosong. T0 wajib selesai
> sebelum kode T1-T2 di-deploy, atau dashboard akan 503.

### T1 — `src/auth.ts`

- [ ] `signSession(secret, ttlSeconds, now)`
- [ ] `verifySession(value, secret, now)`
- [ ] `csrfFor(npc, secret)`
- [ ] `verifyCsrfFromRequest(c, session, secret)`
- [ ] `safeEqual(a, b)` waktu-tetap
- [ ] `isAuthed(c)` berubah dari sync ke async
- [ ] `requireAdmin(c)` — 401 JSON, atau redirect untuk request HTML
- [ ] Hapus ekspor `AUTH_SESSION`, perbarui semua import lama
- [ ] `safeSlug(raw)` tidak berubah
- [ ] base64url + HMAC ditulis manual dengan `crypto.subtle` (tanpa `jose`)

### T2 — `src/index.ts`

- [ ] Hapus `FALLBACK_PASSWORD` (`:33-34`)
- [ ] Ganti kelima pembacaan cookie mentah dengan `requireAdmin`/`isAuthed`
      (`:256`, `:538`, `:1270`, `:1315`, `:1336`)
- [ ] `/api/login`: 503 kalau konfigurasi kosong, verifikasi CSRF, `safeEqual`,
      pasang `auth_session` dari `signSession` (`:516-530`)
- [ ] `/api/logout` tetap `GET`, hapus `auth_session` dan `auth_pre` (`:532-535`)
- [ ] Sisipkan `<meta name="csrf-token">` sebelum `</head>` cabang authed
- [ ] Sisipkan `_csrf` di lima form (`:811`, `:865`, `:930`, `:1011`, `:1133`)

### T3 — Rate limit `/api/login`, fail-closed

- [ ] `loginfail:<sha256(ip)>:<minuteBucket>` TTL 120 d, cap 5/menit
- [ ] `loginlock:<sha256(ip)>` TTL 900 d, diset setelah 10 kegagalan
- [ ] `ip` dari `CF-Connecting-IP`, fallback `x-forwarded-for`
- [ ] `sha256(ip)` lewat `crypto.subtle.digest` supaya IP tidak tersimpan mentah
- [ ] Rate limit diperiksa **sebelum** membandingkan password
- [ ] KV gagal → login ditolak 503 (fail-closed, bukan fail-open seperti
      `src/media-routes.ts:197-199`)
- [ ] Respons 429 memuat header `Retry-After`

### T4 — CSRF

- [ ] Lima form di `src/index.ts`
- [ ] Lima form di `src/tka-studio.ts`
- [ ] `src/index.ts:1133` — form delete dibangun dari string JS, token harus masuk
      ke string itu
- [ ] `src/tka-studio.ts:747` — `multipart/form-data`, field `_csrf` tetap jalan
- [ ] Lima call site POST di `src/media-routes.ts:702,719,754,854,877` via header
      `X-CSRF-Token` di inline JS
- [ ] `src/media-routes.ts:819` adalah GET baca, tidak perlu token
- [ ] `public/vendor/quiz-report.js` tidak memanggil `fetch`, tidak tersentuh

### T5 — CORS

- [ ] Publik `/api/save/:slug`, `/api/submit/:slug`, `/media/:slug/:name` tetap
      `origin: '*'` dengan `allowCredentials: false`
- [ ] Admin sisanya pakai allowlist `ALLOWED_ORIGINS` (koma), default tanpa
      header `Access-Control-Allow-Origin` sama sekali
- [ ] `allowCredentials: true`, methods `GET, POST, OPTIONS`
- [ ] Allow-Headers memuat `Content-Type` **dan** `X-CSRF-Token`, kalau tidak
      jalur `fetch` gagal saat preflight

### T6 — Kunci `?kunci=1`

- [ ] `kunci=1` tanpa sesi → 404, bukan 403 (403 mengonfirmasi kunci memang ada)
- [ ] `kunci=1` dengan sesi tetap seperti sekarang
- [ ] `?print=1` tanpa `kunci` tetap publik
- [ ] 3 baris di `src/index.ts:140-153`, sebelum `renderPrintSheet`

### T7 — Hapus `apiKey` dari `gen-config`

- [ ] Respons `GET /api/media/:slug/gen-config` kirim `hasKey: true`, bukan
      `apiKey`
- [ ] Tambah `Cache-Control: no-store`
- [ ] Semantik server: `apiUrl` terisi + `apiKey` kosong → **jaga** kunci lama
- [ ] `apiUrl` kosong + `apiKey` kosong → hapus `imggencfg:<slug>`, kembali ke
      konfigurasi admin
- [ ] `apiKey` terisi → ganti kunci (validasi `https://` + panjang)
- [ ] UI `src/media-routes.ts:829` diisi placeholder "tersimpan" + indikator
      `hasKey`, bukan `cfg.apiKey`

> Tanpa perubahan semantik server, kunci BYOK guru hilang diam-diam begitu
> panel dibuka lalu disimpan. Regresi yang hanya muncul saat dipakai.

### T8 — Test

- [ ] `tests/auth.test.mjs` baru
- [ ] `tests/quiz.test.mjs` **tidak boleh disentuh** (dirty worktree + dipakai
      memverifikasi `docs/gemini-gem-prompt-full.md`)
- [ ] Cookie legacy `authenticated_user` ditolak — regression guard terpenting
- [ ] Token bertanda tangan rusak ditolak
- [ ] Token yang ditandatangani `SESSION_SECRET` salah ditolak
- [ ] `exp` lewat ditolak; `iat` di masa depan ditolak di luar toleransi 60 d
- [ ] `v` selain 1 ditolak
- [ ] `signSession` → `verifySession` berhasil pada TTL normal, gagal setelah `exp`
- [ ] `csrfFor` deterministik per `npc`, berbeda antar `npc`
- [ ] `verifyCsrf` menerima field `_csrf`, menerima header `X-CSRF-Token`,
      menolak keduanya salah
- [ ] `safeEqual` benar untuk sama panjang, beda isi, beda panjang, string kosong

### T9 — Dokumentasi

- [ ] `AGENTS.md:26` — baris fallback `admin123` jadi tidak valid
- [ ] `docs/panduan-pakai.md:19,64` — masa berlaku sesi 7 hari + cara logout
- [ ] `src/guide.ts:107,138` — sama, harus sinkron dengan markdown-nya
- [ ] `docs/plan-google-cbt.md` bagian 4 dan 12 — tandai item auth selesai
- [ ] `docs/analisis-resource.md:24` — tandai resolved, sudah tidak akurat karena
      password sudah dibaca dari env sejak `src/index.ts:538`
- [ ] `docs/analisis-resource.md:25` — tandai resolved, `escapeHtml()` sudah
      dipakai di `src/index.ts:490-496`
- [ ] `docs/strategi-publish-dan-sosialisasi.md` bagian 8 — centang Gerbang P0
- [ ] `docs/peta-migrasi-frontend-backend.html:370-376` — koreksi klaim bahwa
      `kunci=1` tidak punya auth check

### T10 — Verifikasi

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npx wrangler dev --env staging` untuk alur login, deploy, delete, rename,
      panel gambar, TKA Studio, kunci jawaban
- [ ] Cek: cookie `auth_session=authenticated_user` buatan sendiri ditolak
- [ ] Cek: `curl "/p/<slug>?print=1&kunci=1"` tanpa cookie → 404
- [ ] Cek: `GET /api/media/<slug>/gen-config` tidak memuat `apiKey`
- [ ] Cek: `POST /api/deploy` tanpa `_csrf` → 403

### Acceptance Criteria auth

- [ ] Cookie `auth_session=authenticated_user` buatan sendiri tidak memberi akses
- [ ] Mengganti satu byte pada cookie membuat sesi tidak valid
- [ ] Memalsukan `exp` atau `iat` tidak memperpanjang sesi
- [ ] `SESSION_SECRET` salah membuat seluruh sesi tidak valid
- [ ] `admin123` tidak pernah diterima, tidak ada konstanta fallback di kode
- [ ] `/api/login` menolak setelah 5/menit, mengunci 15 menit setelah 10 gagal
- [ ] `/p/<slug>?print=1&kunci=1` tanpa sesi → 404; `?print=1` tetap publik
- [ ] `gen-config` tidak pernah memuat `apiKey`, dan menyimpan panel tanpa
      mengetik ulang kunci tidak menghapus kunci tersimpan
- [ ] 10 form + 7 call site menolak POST tanpa token
- [ ] `/api/*` admin tidak lagi mengirim `Access-Control-Allow-Origin: *`
- [ ] `tests/auth.test.mjs` benar-benar dieksekusi oleh `npm test`

---

## 2. Temuan Terverifikasi di Luar Cakupan Auth

Terverifikasi di `docs/plan-hardening-auth.md:129-138`. Tidak ditutup oleh auth
plan. Sebagian besar juga masuk Gerbang P0.

- [ ] `KEY` tidak terdefinisi di `src/quiz-page.ts:746` — `localStorage.setItem(KEY, name)`
      error tertelan `catch` kosong, jadi nama siswa tidak tersimpan saat submit.
- [ ] Batas media hanya saat `list()` di `src/media.ts:137,146` —
      `MAX_MEDIA_PER_APP = 200` dipakai sebagai `limit`, bukan write cap; upload
      ke-201 dan seterusnya sukses tapi tak terlihat.
- [ ] Query rekap tanpa `LIMIT` di `src/index.ts:264` dan `src/quiz-essay.ts:67` —
      `SELECT *` penuh, analitik dihitung ulang tiap request.
- [ ] `app_records` yatim di `src/index.ts:1314-1334` — `/api/delete` menghapus KV
      dan media, tidak pernah menyentuh D1.
- [ ] Grading fail-open di `src/index.ts:230-232` — spec yang gagal parse disimpan
      tanpa grading.
- [ ] Rate limit `/api/save/:slug` — endpoint terbuka tanpa rate limit, bisa
      dibanjiri untuk membakar kuota D1. (P0)
- [ ] Batas ukuran payload — batas 8 MB hanya berlaku untuk media, body JSON
      butuh batas eksplisit sendiri. (P0)
- [ ] **`/api/app/update` tidak failure-atomic** (ditemukan smoke test 28 Sep 2026).
      `html:<newSlug>` ditulis di `src/index.ts:1416` dan `meta:<newSlug>` di
      `:1419`, tapi migrasi D1 di `:1458` baru jalan belakangan. Saat D1 gagal,
      handler balas 500 **setelah** alamat baru sudah hidup: slug lama dan baru
      sama-sama serve, `meta:<oldSlug>` tidak pernah dihapus, dan redirect ke
      dashboard tidak terjadi. Harus dibungkus `try`/`catch` dengan pesan jelas,
      atau langkah D1 dipindah ke depan penulisan KV. (P1)

---

## 3. Google CBT — Fase 0 `docs/plan-google-cbt.md`

Status dokumen: Disetujui, belum diimplementasikan. **Menunggu auth plan selesai
lebih dulu** — Fase 0 menyusut drastis setelah T0-T10, karena sesi HMAC, CORS,
dan CSRF sudah menjadi fondasinya.

- [ ] Direktori `migrations/` + npm script `db:migrate:local` dan
      `db:migrate:remote`, jalankan yang lokal
- [ ] Harness tes HTTP di `tests/helpers/` — mock KV (get/put/delete/list dengan
      dukungan `prefix` dan cursor) + mock D1 (prepare/bind/run/first/all plus
      simulasi unique constraint) + helper `callRoute(app, method, path, body, cookie)`
- [ ] `jose` sebagai dependency tunggal untuk ID token + JWKS (verifikasi JWT
      tidak ditulis tangan)
- [ ] Helper session, resolusi user, normalisasi email
- [ ] Google OAuth authorization-code flow dengan PKCE, `state`, dan `nonce`
      server-side (KV TTL 10 menit) atau cookie HttpOnly bertanda tangan
- [ ] Verifikasi ID token: signature via JWKS, `iss`, `aud`, `exp`, `nonce`,
      `email_verified`
- [ ] Hapus `/api/login` password bersama sepenuhnya
- [ ] Satukan auth lewat middleware baru
- [ ] Tabel `users` dan `auth_sessions` lewat `migrations/0001_auth_cbt.sql`
- [ ] CORS + CSRF (sudah dikerjakan di auth T4/T5)

---

## 4. Google CBT — Fase 1 sampai 5 (Tertunda)

Hanya relevan kalau mode CBT terdaftar benar-benar dipakai. Tidak perlu untuk
pilot dengan link publik.

### Fase 1 — Ownership assessment

- [ ] Tabel `assessments` + owner lookup
- [ ] Namespace KV untuk konten baru
- [ ] Batasi dashboard dan mutation ke owner/admin
- [ ] Tampilkan assessment legacy public tanpa memindahkan owner
- [ ] `DELETE /api/assessments/:id` yang owner-scoped dan membersihkan attempt

### Fase 2 — Roster dan assigned gate

- [ ] Tabel `assessment_students`
- [ ] Form roster + validasi email
- [ ] Login gate pada link assigned
- [ ] Tolak akun Google yang emailnya tidak terdaftar
- [ ] Kunci `?print=1` dan `?kunci=1` pada mode assigned
- [ ] `GET /media/:slug/:name` mode-aware dengan cache privat untuk assigned

### Fase 3 — Attempt lifecycle

- [ ] Tabel `quiz_attempts` dan `quiz_drafts`
- [ ] Start/resume, duration, deadline, autosave ber-throttle, lazy expiry,
      submit idempotent
- [ ] Simpan content version saat attempt dimulai
- [ ] Ubah fail-open grading: kegagalan = attempt belum finalized
- [ ] Dual-read laporan: `GET /p/:slug/data` dan `GET /p/:slug/essay` membaca
      `quiz_attempts` untuk assigned dan `app_records` untuk public
- [ ] `POST /api/quiz/:slug/essay` menulis `result_json` dengan conditional update
- [ ] `result_json` berbentuk sama dengan payload `app_records` supaya
      `computeItemAnalysis` dipakai utuh

### Fase 4 — UI dan kompatibilitas

- [ ] Halaman login + status session
- [ ] Timer/autosave UI sesuai aturan throttle
- [ ] Perbaiki cleanup localStorage (termasuk bug `KEY` undefined) + retry submit
- [ ] Pertahankan public quiz flow dan legacy report
- [ ] Filter/pagination report

### Fase 5 — Validasi dan rollout

- [ ] `npm test` + `npm run typecheck`
- [ ] `db:migrate:local`, lalu `db:migrate:remote` untuk staging
- [ ] Daftarkan redirect URI Google untuk production dan staging
- [ ] Uji dengan dua guru dan 30 siswa
- [ ] Pastikan guru hanya melihat assessment miliknya
- [ ] Pastikan link public lama tetap terbuka
- [ ] Aktifkan assigned mode bertahap setelah smoke test

---

## 5. Gerbang Rilis `docs/strategi-publish-dan-sosialisasi.md`

### Gerbang P0 — wajib sebelum pilot bersama sekolah

- [ ] Sesi diverifikasi, bukan cookie statis (→ auth T1/T2)
- [ ] Fallback `admin123` dihapus, secret tidak pernah di-commit (→ auth T0/T2)
- [ ] Batasi akses dashboard, laporan, media, sumber, kepemilikan
- [ ] Validasi + escape seluruh metadata dan konten dinamis — title, URL media
      kaya, import TKA (sebagian sudah beres; audit ulang)
- [ ] Cegah kebocoran kunci jawaban lewat print atau parameter URL (→ auth T6)
- [ ] Rate limit endpoint publik, pembuatan soal AI, callback auth (→ auth T3
      untuk login; sisanya belum)
- [ ] Pengujian rute, autentikasi, KV, D1 (→ auth T8 sebagian; harness HTTP
      belum)
- [ ] Tetapkan data minimum, retensi, hak akses, ekspor, penghapusan data
      (belum ada sama sekali)

### Gerbang P1 — wajib sebelum perluasan multi-sekolah

- [ ] Identitas guru + kepemilikan asesmen
- [ ] Namespace konten baru per pemilik atau asesmen
- [ ] Pembagian halaman, index, query laporan yang tidak membaca seluruh histori
- [ ] R2 untuk media, atau strategi fallback yang jelas dan terukur
- [ ] Pantau error, biaya, latensi, pemakaian AI
- [ ] SOP dukungan, insiden, pencadangan, pemulihan

### Gerbang P2 — untuk mode CBT terdaftar

- [ ] Google OAuth dengan state, nonce, PKCE, verifikasi token
- [ ] Roster siswa + sesi sisi server
- [ ] Timer server + percobaan yang tidak bisa diubah dari klien
- [ ] Autosave, melanjutkan, submit idempotent, hasil sesuai kebijakan rilis

---

## 6. Tahap 1 `docs/analisis-resource.md`

Seri dan wajib setelah Tahap 0. Butuh keputusan tenant lebih dulu.

- [ ] Skema multi-tenant: `schools → users(role) → classes → students →
      assessments → attempts → attempt_answers`, semua baris ada `school_id`
- [ ] Middleware tenant: setiap query disaring `school_id` dari sesi, jangan
      bergantung pada slug di URL
- [ ] Pisahkan identitas dan URL: UUID untuk kunci KV (`quiz:<school>/<id>`),
      slug hanya untuk alamat enak dibaca, cek keunikan sebelum simpan
- [ ] Pindahkan indeks aplikasi dari KV list ke tabel D1 dengan pagination
- [ ] `LIMIT` di semua query rekap; analitik butir soal dihitung saat submit
- [ ] R2 untuk media dengan kunci `school_id/assessment_id/slot`

---

## 7. Ditunda

- [ ] `docs/plan/panel-konteks-soal-di-slot-gambar.md` — panel "Konteks soal"
      mengambang per kartu slot di `/p/<slug>/media`. Hanya menyentuh markup dan
      inline JS di `src/media-routes.ts`. Tidak bersinggungan dengan auth plan.
- [ ] Pemecahan admin jadi SPA (`docs/peta-migrasi-frontend-backend.html`) —
      ditunda sesuai keputusan.

---

## 8. Konsistensi Dokumen

Tertunda sampai auth plan selesai, tapi paling mudah terlupa karena tidak
terlihat dari kode:

- [ ] Status di header `docs/plan-hardening-auth.md` dan
      `docs/plan-google-cbt.md` diperbarui dari "belum diimplementasikan"
- [ ] `docs/plan-hardening-auth.md:443` — semua sitasi `file:line` diverifikasi
      terhadap 27 September 2026. Kalau `src/index.ts` atau
      `src/media-routes.ts` berubah lagi, hitung ulang.
- [ ] `docs/plan-google-cbt.md` bagian 4, 12, dan 19 — bagian 19 menyatakan plan
      itu sumber kebenaran, jadi status basi di dokumen lain akan menyesatkan
- [ ] Tiga file dirty worktree (`docs/plan-google-cbt.html`,
      `docs/plan-google-cbt.md`, `tests/quiz.test.mjs`) masih belum di-commit.
      Putuskan dulu: commit terpisah atau buang.
