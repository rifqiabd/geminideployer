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
dan totalnya sekitar 3,5 hari kerja — **sudah selesai semua**; lihat §1.

1. ~~Kerjakan auth T0 sampai T10 (bagian 1 di bawah).~~ **Selesai 28 Sep 2026**
   (kode + test + smoke + secret runtime terpasang di production & staging).
   Sisa: deploy kode ke production/staging.
2. ~~Smoke test di staging.~~ **Selesai** — 31 cek lolos, artefak test dihapus.
3. ~~Fase 0 Google CBT boleh dimulai (bagian 3 di bawah) setelah secret T0
   dipasang.~~ **T0 dipasang 28 Sep 2026**, tapi Fase 0 diputuskan DITUNDA
   sampai ada keputusan apakah CBT terdaftar diperlukan untuk pilot.
4. Item lain yang masih terbuka, berurutan:
   - rate limit `/api/save/:slug` + batas ukuran body JSON (§2)
   - `LIMIT` di query rekap + indeks aplikasi di D1 (§2, §6)
   - audit escape metadata/import TKA (§5 Gerbang P0)
   - kebijakan data minimum/retensi/ekspor/hapus (§5 Gerbang P0)

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
      menyusun kedua label dan menolak app yang dua stempelnya kosong. Tuntas
      lewat commit `257c41a`.

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
      `wrangler dev` memakai KV dan D1 sesuai flag binding-nya. Catatan 30 Sep
      2026: `STORAGE` kini `remote: false`, jadi `wrangler dev` menulis ke KV
      lokal; D1 lokal tetap store terpisah. Tanpa skema, semua
      route yang menyentuh D1 gagal dengan `D1_ERROR: no such table:
      app_records`. Perbaikannya satu perintah, tapi harus diketahui orang lain
      sebelum tes:
      `npx wrangler d1 execute gemini-db-staging --env staging --local --file schema.sql`
      (nama database di bawah `--env staging` adalah `gemini-db-staging`;
      `gemini-db` tidak resolve di env itu).

---

## 1. Hardening Auth — `docs/plan-hardening-auth.md`

> **Checkpoint:** T0–T10 SELESAI. Blok di bawah awalnya adalah rencana kerja
> yang belum dicentang (dokumen itu ditulis 27 Sep, sebelum eksekusi 28 Sep).
> Sejak 28 Sep 2026 seluruh kotaknya dicentang, jadi jangan lagi membacanya
> sebagai daftar pekerjaan tersisa. Bukti: `tests/auth.test.mjs` (55 test,
> dirangkai ke `npm test`), `npm run typecheck` bersih, dan smoke test staging
> 31 cek. Satu-satunya sisa: **deploy kode hardened ke production** (staging
> sudah versi `6208ac7b`).
>
> **Catatan alamat:** semua nomor baris `src/index.ts:NNN` di T2–T6 adalah
> alamat SEBELUM refactor `docs/plan-split-index.md` (28 Sep). Setelah
> index.ts menyusut ke 116 baris wiring, kode yang dimaksud kini ada di
> `src/auth-routes.ts`, `src/dashboard.ts`, `src/actions.ts`, dan
> `src/records.ts`. Alamat lama tidak resolve; pakai nama fungsi, bukan baris.

Status dokumen: **Selesai diimplementasikan 28 September 2026.** T1-T9 dan
T10 otomatis tuntas: sesi HMAC di `src/auth.ts`, fallback `admin123` dihapus,
rate limit login fail-closed, CSRF di 10 form + 7 call site fetch, CORS
allowlist, kunci `?kunci=1` → 404, `gen-config` tanpa `apiKey`,
`tests/auth.test.mjs` (55 test) dirangkai ke `npm test`, typecheck bersih,
dry-run deploy bersih, dan smoke test staging 31/31 lolos (login, cookie lama
ditolak, deploy dengan/tanpa CSRF, kunci jawaban, gen-config, rate limit 429
+ Retry-After, laporan, delete).

Kotak-kotak di bawah dipertahankan sebagai rujukan rinci; yang relevan semua
sudah `[x]` kecuali yang diberi catatan. Ini prasyarat sebelum pilot sekolah
dan prasyarat `docs/plan-google-cbt.md` Fase 0 — Fase 0 kini boleh dimulai.

### T0 — Env dan urutan deploy (WAJIB sebelum T1)

- [x] `npx wrangler secret put SESSION_SECRET` (nilai dari `openssl rand -base64 32`)
      — dieksekusi 28 Sep 2026 untuk production (`gemini-deployer`) dan
      staging (`gemini-deployer-staging`). Nilainya acak, tidak pernah dicetak
      ke layar, dan tersimpan di `.dev.vars` (gitignored).
- [x] `npx wrangler secret put APP_PASSWORD` (hapus `admin123`) — sama, acak
      32-hex, nilainya dibaca dari `.dev.vars`. **Catatan untuk guru:** password
      dashboard yang baru ada di file `.dev.vars` lokal, bukan lagi `admin123`;
      ganti sendiri kalau mau yang mudah dihafal.
- [x] Ulangi keduanya dengan `--env staging` — selesai.
- [x] Kode hardened **sudah di-deploy ke staging** (versi `6208ac7b`, 28 Sep
      2026) dan diverifikasi end-to-end: login dengan password yang disinkronkan,
      sandi salah ditolak 401, deploy app, upload gambar lewat header
      `X-CSRF-Token` (tanpa token = 403), gambar tersaji publik dengan cache
      1 jam, `gen-config` tanpa `apiKey`, hapus app — 12/12 cek lolos, artefak
      test dihapus. **Production masih menjalankan versi lama** sampai
      `npx wrangler deploy` dijalankan.
- [x] Tambah `SESSION_SECRET` ke `.dev.vars.example` (tanpa nilai nyata) dan ke
      `.dev.vars` lokal
- [x] Halaman 503 saat secret kosong memuat dua perintah `wrangler secret put`
      dalam bahasa Indonesia, supaya tidak ada lockout yang butuh tebakan
      (`secretSetupPage()` di `src/auth.ts`)

> Kode akan menolak boot login kalau salah satu secret kosong. T0 wajib selesai
> sebelum kode T1-T2 di-deploy, atau dashboard akan 503.

### T1 — `src/auth.ts`

> **Status: SELESAI 28 Sep 2026** — semua item di bawah ada di `src/auth.ts` dan
> diuji `tests/auth.test.mjs`. Nomor baris `src/index.ts` di T2-T6 adalah alamat
> SEBELUM refactor `docs/plan-split-index.md`; kode itu kini ada di
> `dashboard.ts`/`actions.ts`/`auth-routes.ts`/`records.ts`.

- [x] `signSession(secret, ttlSeconds, now)`
- [x] `verifySession(value, secret, now)`
- [x] `csrfFor(npc, secret)`
- [x] `verifyCsrfFromRequest(c, session, secret)`
- [x] `safeEqual(a, b)` waktu-tetap
- [x] `isAuthed(c)` berubah dari sync ke async
- [x] `requireAdmin(c)` — 401 JSON, atau redirect untuk request HTML
- [x] Hapus ekspor `AUTH_SESSION`, perbarui semua import lama
- [x] `safeSlug(raw)` tidak berubah
- [x] base64url + HMAC ditulis manual dengan `crypto.subtle` (tanpa `jose`)

### T2 — `src/index.ts`

- [x] Hapus `FALLBACK_PASSWORD` (`:33-34`)
- [x] Ganti kelima pembacaan cookie mentah dengan `requireAdmin`/`isAuthed`
      (`:256`, `:538`, `:1270`, `:1315`, `:1336`)
- [x] `/api/login`: 503 kalau konfigurasi kosong, verifikasi CSRF, `safeEqual`,
      pasang `auth_session` dari `signSession` (`:516-530`)
- [x] `/api/logout` tetap `GET`, hapus `auth_session` dan `auth_pre` (`:532-535`)
- [x] Sisipkan `<meta name="csrf-token">` sebelum `</head>` cabang authed
- [x] Sisipkan `_csrf` di lima form (`:811`, `:865`, `:930`, `:1011`, `:1133`)

### T3 — Rate limit `/api/login`, fail-closed

- [x] `loginfail:<sha256(ip)>:<minuteBucket>` TTL 120 d, cap 5/menit
- [x] `loginlock:<sha256(ip)>` TTL 900 d, diset setelah 10 kegagalan
- [x] `ip` dari `CF-Connecting-IP`, fallback `x-forwarded-for`
- [x] `sha256(ip)` lewat `crypto.subtle.digest` supaya IP tidak tersimpan mentah
- [x] Rate limit diperiksa **sebelum** membandingkan password
- [x] KV gagal → login ditolak 503 (fail-closed, bukan fail-open seperti
      `src/media-routes.ts:197-199`)
- [x] Respons 429 memuat header `Retry-After`

### T4 — CSRF

- [x] Lima form di `src/index.ts`
- [x] Lima form di `src/tka-studio.ts`
- [x] `src/index.ts:1133` — form delete dibangun dari string JS, token harus masuk
      ke string itu
- [x] `src/tka-studio.ts:747` — `multipart/form-data`, field `_csrf` tetap jalan
- [x] Lima call site POST di `src/media-routes.ts:702,719,754,854,877` via header
      `X-CSRF-Token` di inline JS
- [x] `src/media-routes.ts:819` adalah GET baca, tidak perlu token
- [x] `public/vendor/quiz-report.js` tidak memanggil `fetch`, tidak tersentuh

### T5 — CORS

- [x] Publik `/api/save/:slug`, `/api/submit/:slug`, `/media/:slug/:name` tetap
      `origin: '*'` dengan `allowCredentials: false`
- [x] Admin sisanya pakai allowlist `ALLOWED_ORIGINS` (koma), default tanpa
      header `Access-Control-Allow-Origin` sama sekali
- [x] `allowCredentials: true`, methods `GET, POST, OPTIONS`
- [x] Allow-Headers memuat `Content-Type` **dan** `X-CSRF-Token`, kalau tidak
      jalur `fetch` gagal saat preflight

### T6 — Kunci `?kunci=1`

- [x] `kunci=1` tanpa sesi → 404, bukan 403 (403 mengonfirmasi kunci memang ada)
- [x] `kunci=1` dengan sesi tetap seperti sekarang
- [x] `?print=1` tanpa `kunci` tetap publik
- [x] 3 baris di `src/index.ts:140-153`, sebelum `renderPrintSheet`
      (kini `src/public-app.ts:26-36` pasca-refactor)

### T7 — Hapus `apiKey` dari `gen-config`

- [x] Respons `GET /api/media/:slug/gen-config` kirim `hasKey: true`, bukan
      `apiKey`
- [x] Tambah `Cache-Control: no-store`
- [x] Semantik server: `apiUrl` terisi + `apiKey` kosong → **jaga** kunci lama
- [x] `apiUrl` kosong + `apiKey` kosong → hapus `imggencfg:<slug>`, kembali ke
      konfigurasi admin
- [x] `apiKey` terisi → ganti kunci (validasi `https://` + panjang)
- [x] UI `src/media-routes.ts:829` diisi placeholder "tersimpan" + indikator
      `hasKey`, bukan `cfg.apiKey`

> Tanpa perubahan semantik server, kunci BYOK guru hilang diam-diam begitu
> panel dibuka lalu disimpan. Regresi yang hanya muncul saat dipakai.

### T8 — Test

- [x] `tests/auth.test.mjs` baru
- [x] `tests/quiz.test.mjs` **tidak boleh disentuh** (dirty worktree + dipakai
      memverifikasi `docs/gemini-gem-prompt-full.md`)
- [x] Cookie legacy `authenticated_user` ditolak — regression guard terpenting
- [x] Token bertanda tangan rusak ditolak
- [x] Token yang ditandatangani `SESSION_SECRET` salah ditolak
- [x] `exp` lewat ditolak; `iat` di masa depan ditolak di luar toleransi 60 d
- [x] `v` selain 1 ditolak
- [x] `signSession` → `verifySession` berhasil pada TTL normal, gagal setelah `exp`
- [x] `csrfFor` deterministik per `npc`, berbeda antar `npc`
- [x] `verifyCsrf` menerima field `_csrf`, menerima header `X-CSRF-Token`,
      menolak keduanya salah
- [x] `safeEqual` benar untuk sama panjang, beda isi, beda panjang, string kosong

### T9 — Dokumentasi

- [x] `AGENTS.md:26` — baris fallback `admin123` jadi tidak valid
- [x] `docs/panduan-pakai.md:19,64` — masa berlaku sesi 7 hari + cara logout
- [x] `src/guide.ts:107,138` — sama, harus sinkron dengan markdown-nya
- [x] `docs/plan-google-cbt.md` bagian 4 dan 12 — tandai item auth selesai
- [x] `docs/analisis-resource.md:24` — tandai resolved, sudah tidak akurat karena
      password sudah dibaca dari env sejak `src/index.ts:538`
- [x] `docs/analisis-resource.md:25` — tandai resolved, `escapeHtml()` sudah
      dipakai di `src/index.ts:490-496`
- [x] `docs/strategi-publish-dan-sosialisasi.md` bagian 8 — centang Gerbang P0
- [x] `docs/peta-migrasi-frontend-backend.html:370-376` — koreksi klaim bahwa
      `kunci=1` tidak punya auth check

### T10 — Verifikasi

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npx wrangler dev --env staging` untuk alur login, deploy, delete, rename,
      panel gambar, TKA Studio, kunci jawaban — diverifikasi lewat smoke test
      otomatis 31 cek (login/CSRF/cookie lama/kunci jawaban/gen-config/rate
      limit/laporan/delete). Alur klik manual di UI TKA Studio dan unggah gambar
      belum disentuh smoke; logikanya sendiri sudah diganti dan di-typecheck.
- [x] Cek: cookie `auth_session=authenticated_user` buatan sendiri ditolak
- [x] Cek: `curl "/p/<slug>?print=1&kunci=1"` tanpa cookie → 404
- [x] Cek: `GET /api/media/<slug>/gen-config` tidak memuat `apiKey`
- [x] Cek: `POST /api/deploy` tanpa `_csrf` → 403

### Acceptance Criteria auth

> Terverifikasi lewat `tests/auth.test.mjs` (55 test, dirangkai ke `npm test`) dan
> smoke test staging 31 cek.

- [x] Cookie `auth_session=authenticated_user` buatan sendiri tidak memberi akses
- [x] Mengganti satu byte pada cookie membuat sesi tidak valid
- [x] Memalsukan `exp` atau `iat` tidak memperpanjang sesi
- [x] `SESSION_SECRET` salah membuat seluruh sesi tidak valid
- [x] `admin123` tidak pernah diterima, tidak ada konstanta fallback di kode
- [x] `/api/login` menolak setelah 5/menit, mengunci 15 menit setelah 10 gagal
- [x] `/p/<slug>?print=1&kunci=1` tanpa sesi → 404; `?print=1` tetap publik
- [x] `gen-config` tidak pernah memuat `apiKey`, dan menyimpan panel tanpa
      mengetik ulang kunci tidak menghapus kunci tersimpan
- [x] 10 form + 7 call site menolak POST tanpa token
- [x] `/api/*` admin tidak lagi mengirim `Access-Control-Allow-Origin: *`
- [x] `tests/auth.test.mjs` benar-benar dieksekusi oleh `npm test`

---

## 2. Temuan Terverifikasi di Luar Cakupan Auth

Terverifikasi di `docs/plan-hardening-auth.md:129-138`. Tidak ditutup oleh auth
plan. Sebagian besar juga masuk Gerbang P0.

- [x] `KEY` tidak terdefinisi di `src/quiz-page.ts` — **diperbaiki 28 Sep 2026**
      bersama fitur form identitas nama+kelas: submit kini menyimpan nama ke
      `NAME_KEY` dan kelas ke `CLASS_KEY` (kunci yang benar), bukan `KEY` yang
      tak terdefinisi.- [x] Batas media hanya saat `list()` di `src/media.ts` — **diperbaiki 28 Sep
      2026.** `listMediaNames()` (satu operasi list, tanpa baca isi) +
      `mediaWriteCapError()` kini dipasang di upload DAN generate AI (409
      sebelum kuota AI dibakar); overwrite slot yang sudah ada tetap
      diizinkan. Test di `tests/media-cap.test.mjs` (11 test). Pemantauan
      kuota KV lewat `npm run kv:usage[:staging]`: production 43 media
      (5,0 MB), staging 36 media (5,6 MB) — jauh dari 1 GB. **Catatan (30 Sep
      2026):** binding R2 kini AKTIF di `wrangler.jsonc` untuk production dan
      staging, jadi media baru tidak lagi masuk KV. Angka di atas adalah sisa
      media KV yang akan pindah ke R2 saat pertama dibaca; cek `npm run
      kv:usage` untuk melihat sisa migrasinya.
- [ ] Query rekap tanpa `LIMIT` — `SELECT *` penuh, analitik dihitung ulang tiap
      request. Pasca-refactor: `src/records.ts:183` (`/p/:slug/data`) dan
      `src/quiz-essay.ts:67`.
- [ ] `app_records` yatim — `/api/delete` menghapus KV dan media, tidak pernah
      menyentuh D1. Pasca-refactor: `src/actions.ts:230` (`/api/app/update`
      memang memindahkan `app_slug`; tidak ada `DELETE FROM app_records` di
      seluruh kodebase).
- [ ] Grading fail-open — spec yang gagal parse disimpan tanpa grading.
      Pasca-refactor: `src/records.ts` (`saveRecordHandler`).
- [ ] Rate limit `/api/save/:slug` — endpoint terbuka tanpa rate limit, bisa
      dibanjiri untuk membakar kuota D1. (P0)
- [ ] Batas ukuran payload — batas 8 MB hanya berlaku untuk media, body JSON
      butuh batas eksplisit sendiri. (P0)
- [x] **`/api/app/update` sudah failure-atomic** (ditemukan smoke test 28 Sep
      2026, dituntaskan lewat commit `257c41a`). Migrasi D1 (pindah
      `app_records` + sinkron `quiz_title`) dipindah ke **depan** penulisan KV
      dan dibungkus `try`/`catch`: kalau D1 gagal, handler balas 500 sebelum
      satu pun kunci KV baru ditulis, jadi slug lama tetap satu-satunya alamat
      yang hidup dan tidak ada `meta:<oldSlug>` yatim.
- [ ] **Dead code: `tka-studio-prompt.php` (1.654 baris / 88 KB).** Port-nya
      sudah lama jadi (`src/tka-studio.ts` + `public/vendor/tka-studio.js`),
      dan PHP tidak jalan di Worker. Dicek 30 Sep 2026: nol referensi dari
      `src/`, `public/`, `tests/`, `docs/`, `package.json`, `wrangler.jsonc`.
      Kandidat hapus; butuh keputusan pemilik repo karena ini file terbesar
      ketiga di repo.
- [x] **`docs/plan-split-index.html` dihapus** (30 Sep 2026) — duplikat ~95%
      dari `.md` tanpa generator sinkronisasi. Sejumlah klaim basi di dokumen
      lain juga dikoreksi pada putaran yang sama: `AGENTS.md` (R2 aktif, KV
      `remote: false`, daftar key lengkap), `docs/analisis-resource.md`
      (temuan 1/2/3/9 resolved, prioritas & peta kode diperbarui),
      `docs/plan-google-cbt.md` §4/§17, `docs/plan-hardening-auth.md`
      §8/§10.

---

## 3. Google CBT — Fase 0 `docs/plan-google-cbt.md`

Status dokumen: Disetujui, **DITUNDA sementara** (keputusan 28 Sep 2026).
Selaras dengan `docs/plan-google-cbt.md:3` ("belum diimplementasikan");
perbedaan kata hanya gaya, statusnya sama: tidak ada pekerjaan yang dimulai.
Prasyarat auth sudah selesai, tapi diprioritaskan dulu: perbaikan latensi
dashboard, form identitas nama+kelas, dan timer latihan klien — semuanya
sudah dikerjakan. Timer server-side untuk CBT tetap menunggu Fase 0-3 plan
ini bersama roster siswa.

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
- [x] CORS + CSRF (sudah dikerjakan di auth T4/T5)

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

> Sinkron dengan `docs/strategi-publish-dan-sosialisasi.md` §8. Item 1–3 dan 5
> sudah selesai 28 Sep 2026 (lihat §1 di atas); sisanya masih terbuka.

- [x] Sesi diverifikasi, bukan cookie statis (→ auth T1/T2)
- [x] Fallback `admin123` dihapus, secret tidak pernah di-commit (→ auth T0/T2)
- [x] Batasi akses dashboard, laporan, media, sumber (satu akun admin; kepemilikan
      per guru masih menunggu `docs/plan-google-cbt.md`)
- [x] Validasi + escape metadata/konten dinamis — **import TKA sudah beres**:
      `src/tka-studio.ts:46` punya `escapeHtml()` lokal dan dipakai pada
      `t.nama`, `t.tipe`, `t.template` (baris 227, 234–236).
- [ ] Audit ulang escape untuk title dashboard dan URL media kaya (sisanya,
      di luar TKA) — belum ada audit menyeluruh.
- [x] Cegah kebocoran kunci jawaban lewat print atau parameter URL (→ auth T6)
- [ ] Rate limit `/api/save/:slug` — endpoint publik masih terbuka.
- [x] Pembuatan soal AI sudah ber-rate-limit — `src/media-routes.ts:202-227`,
      `GEN_LIMIT_PER_MINUTE = 6`, key `imggen:<slug>:<bucket>`, balas 429.
      (Fail-open saat KV error, disengaja: bukan jalur keamanan.)
- [x] Callback auth — belum ada endpoint callback, jadi tidak ada yang perlu
      dibatasi sampai Google OAuth (CBT Fase 0) dikerjakan.
- [ ] Pengujian rute, autentikasi, KV, D1 — `tests/auth.test.mjs` menutup helper
      sesi, dan 10 berkas `npm test` mencakup perilaku UI (`dashboard-ui`,
      `record-detail`, `app-index`). Yang belum: harness HTTP `app.request()`
      dengan mock KV/D1 (direncanakan di CBT Fase 0).
- [ ] Tetapkan data minimum, retensi, hak akses, ekspor, penghapusan data
      (belum ada sama sekali)

### Gerbang P1 — wajib sebelum perluasan multi-sekolah

- [ ] Identitas guru + kepemilikan asesmen
- [ ] Namespace konten baru per pemilik atau asesmen
- [ ] Pembagian halaman, index, query laporan yang tidak membaca seluruh histori
- [x] R2 untuk media, atau strategi fallback yang jelas dan terukur — R2 aktif
      di production & staging (bucket terpisah); `npm run kv:usage[:staging]`
      mengukur sisa media KV, dan media pindah ke R2 saat pertama dibaca.
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
- [ ] Pindahkan indeks aplikasi dari KV list ke tabel D1 dengan pagination —
      **sebagian sudah jalan**: `src/app-index.ts:159-175` (`readD1Slugs`) sudah
      memakai `SELECT DISTINCT app_slug FROM app_records` sebagai jalur darurat
      saat kuota `list` KV habis, dan hasilnya dicerminkan ke R2. Yang belum:
      menjadikan D1 sebagai sumber utama + pagination.
- [ ] `LIMIT` di semua query rekap; analitik butir soal dihitung saat submit
- [x] ~~R2 untuk media dengan kunci `school_id/assessment_id/slot`~~ — **R2 sudah
      aktif** di production & staging (bucket terpisah, `wrangler.jsonc`), media
      baru ditulis ke R2. Sisa: kunci masih `<slug>/<name>`, bukan ber-namespace
      tenant — menunggu skema multi-tenant di atas.

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

- [x] Status di header `docs/plan-hardening-auth.md` dan
      `docs/plan-google-cbt.md` diperbarui dari "belum diimplementasikan"
      *(30 Sep 2026: banner status ditambahkan ke keduanya, dan
      `docs/analisis-resource.md`, `docs/plan-split-index.md`,
      `docs/plan-remember-result.md` ikut disinkronkan).*
- [x] `docs/plan-hardening-auth.md` — sitasi `file:line` yang basi sudah
      diberi banner historis (§10), karena `src/index.ts` menyusut ke 116 baris
      dan kode yang dirujuk pindah ke modul lain. Aturan berlaku: pakai nama
      fungsi, bukan nomor baris.
- [x] `docs/plan-google-cbt.md` bagian 4 dan 12 — bagian 4 diberi banner
      "sudah tidak berlaku" plus kondisi auth terkini; §17 dikoreksi soal
      `remote: false`.
- [x] Tiga file dirty worktree (`docs/plan-google-cbt.html`,
      `docs/plan-google-cbt.md`, `tests/quiz.test.mjs`) — **sudah tidak relevan
      per 30 Sep 2026**: ketiganya bersih di `git status`. Worktree yang dirty
      sekarang adalah hasil edit dokumentasi putaran 30 Sep, bukan tiga file itu.
