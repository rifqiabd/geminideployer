# Rencana Refaktor `src/index.ts` (Pemisahan Modul Rute)

Status: **Selesai dieksekusi** — 28 September 2026
Lingkup: pemecahan berkas `src/index.ts` menjadi modul-modul kecil, mengikuti pola registrar yang sudah ada. **Bukan** pemisahan frontend/backend dan **bukan** penambahan build step.

## Hasil Eksekusi (ringkas)

- `src/index.ts` menyusut dari ±2.000 baris menjadi **116 baris** (hanya wiring: tipe `Bindings`, middleware CORS, pemasangan registrar, `export default`).
- Enam modul baru dibuat (lihat Bagian 3). Rute, urutan registrar, dan urutan middleware CORS **tidak berubah**.
- Verifikasi: `npm run typecheck` bersih, `npm test` (5 berkas) hijau, dan smoke test rute 17/17 lewat `app.request()` dengan KV/D1 tiruan (Bagian 5).

## 1. Ringkasan Keputusan

- `src/index.ts` dulu ±2.000 baris dan menjadi satu-satunya berkas yang menabrak pola proyek: semua area fitur lain sudah memisahkan diri lewat fungsi registrar (`media-routes.ts`, `quiz-editor.ts`, `quiz-essay.ts`, `guide.ts`, `tka-studio.ts`), sedangkan `index.ts` menggabungkan wiring, dashboard, rekap, auth, dan aksi dalam satu berkas.
- Pemecahan dilakukan **hanya memindahkan kode**, tanpa mengubah perilaku, tanpa mengubah rute, tanpa mengubah urutan middleware, dan tanpa menambah dependensi.
- Pemisahan frontend/backend (SPA atau pre-build step) **ditolak** untuk proyek ini — alasannya di Bagian 2.
- Kompromi opsional (Fase B): ekstrak JS/CSS inline dashboard ke `public/vendor/`, ikut pola `quiz-editor.js` dsb. Ini tahap terpisah dan boleh dilewati.

## 2. Kenapa Tidak Dipisah Frontend/Backend

1. **Menabrak aturan "tanpa build"** — SPA memerlukan bundler; `AGENTS.md` melarang menambah build/CI tanpa permintaan eksplisit.
2. **CSRF dan sesi menempel di rendering server** — token CSRF diinjeksi ke meta tag dan setiap form, halaman login vs dashboard dirender kondisional di server. Pindah ke SPA berarti merancang ulang seluruh alur auth, bukan sekadar memindahkan kode.
3. **Tidak ada jaring pengaman** — suite tes (`tests/*.mjs`) tidak menyentuh rute HTTP/KV/D1 sama sekali. Menulis ulang dashboard ±1.000 baris tanpa regresi tes berisiko tinggi dengan manfaat kecil (audiens: satu sekolah).
4. **Pemisahan "frontend" sebenarnya sudah ada** — `public/vendor/quiz-editor.js`, `quiz-essay.js`, `tka-studio.js` adalah shell server tipis + JS browser yang mengelola UI sendiri. Itu pemisahan yang cukup tanpa build step.

## 3. Peta Pemecahan (Fase A) — hasil aktual

| Berkas | Isi yang dipindah dari `index.ts` | Baris |
|---|---|---|
| `src/index.ts` (tersisa) | tipe `Bindings`, middleware CORS dua lapis (`adminCors`, `adminOriginAllowed`), pemasangan semua registrar, `export default app` | 116 |
| `src/dashboard.ts` | `GET /` (form login, sidebar, detail app, print modal, edit modal, inline JS dashboard), helper `modData` | 1.087 |
| `src/records.ts` | `saveRecordHandler` (`/api/save/:slug` + alias `/api/submit/:slug`), `GET /p/:slug/data` (rekap + antrean esai + analisis butir) | 369 |
| `src/actions.ts` | `POST /api/deploy`, `POST /api/delete`, `POST /api/app/update`, helper privat `sanitizeSlug`, `uniqueSlug`, `saveApp` | 302 |
| `src/auth-routes.ts` | `POST /api/login`, `GET /api/logout`, konstanta rate limit, `SESSION_TTL_SECONDS`, `sha256Hex`, `clientIp` | 125 |
| `src/public-app.ts` | `GET /p/:slug` (naskah siswa + mode cetak) | 56 |
| `src/admin-shared.ts` | `errorPage`, `denyAdminRequest` | 50 |

Catatan penempatan (beda dari draf awal):

- Draf awal menyebut `admin-guard.ts` untuk `denyAdminRequest`. Saat eksekusi, `errorPage` juga dibutuhkan lintas modul (`actions.ts`, `auth-routes.ts`), jadi keduanya digabung ke **`admin-shared.ts`**.
- Rute `GET /p/:slug` **tidak tercantum** di draf awal. Ditempatkan di **`public-app.ts`** supaya `records.ts` tetap fokus pada data kiriman/rekap, bukan penyajian halaman.
- `sanitizeSlug`, `uniqueSlug`, `saveApp` tetap **privat di `actions.ts`** — hanya dipakai `/api/deploy` dan `/api/app/update`.
- Tiap modul mendeklarasikan tipe binding minimalnya sendiri (pola yang sudah dipakai `registerMediaRoutes`, `registerTkaStudioRoutes`), sehingga tidak ada modul yang mengimpor `Bindings` dari `index.ts` (menghindari impor melingkar).

## 4. Jebakan yang Harus Dijaga

1. **Urutan middleware CORS tidak boleh berubah.** `app.use('/api/save/*', ...)`, `/api/submit/*`, `/media/*` (publik, `origin: '*'`) harus terdaftar **sebelum** `app.use('/studio/*', adminCors)` dan `app.use('/api/*', adminCors)`. Middleware ini tetap di `index.ts`, jadi urutannya utuh.
2. **Semua registrar menerima `app` yang sama** — pola yang sudah dipakai `registerMediaRoutes(app)` dst.; berkas baru mengikuti pola yang persis sama (`registerDashboardRoutes(app)`, `registerAuthRoutes(app)`, ...). Urutan pemanggilan registrar disamakan dengan urutan definisi rute lama.
3. **Import berekstensi `.ts`** — pemecahan ini **tidak menambah satu pun modul yang diimpor tes**, jadi aturan ekstensi `.ts` tidak berubah.
4. **Template literal raksasa** — dashboard (±1.000 baris HTML dalam satu template string) dipindah utuh, tidak dipecah-percah.
5. **`parseBody()` di-cache per request** — perilaku CSRF (`denyAdminRequest` membaca body untuk token) bergantung pada itu; cara pembacaan body tidak diubah saat memindah.

## 5. Verifikasi

Karena tes otomatis tidak menjangkau rute HTTP, verifikasi dilakukan berlapis:

1. `npm run typecheck` — bersih.
2. `npm test` — kelima berkas tes hijau (quiz, meta-date, slug, auth, media-cap).
3. **Smoke test rute** lewat `app.request()` (Bun, KV/D1 tiruan, tanpa network) — 17/17 cek lulus:
   - `GET /p/<missing>` → 404; `GET /p/<slug>` → 200 dari KV.
   - `POST /api/save/<slug>` dan alias `/api/submit/<slug>` → 200 `success`, baris D1 ter-`INSERT`.
   - `GET /` tanpa sesi → form login + cookie `auth_pre`; dengan sesi → 200.
   - `GET /p/<slug>/data` tanpa sesi → 302; `POST /api/deploy` tanpa sesi → 401.
   - Preflight `OPTIONS /api/...`: origin di luar allowlist → tanpa `Access-Control-Allow-Origin`; origin terdaftar → header muncul.
   - `POST /api/login` password salah → 401; benar → 302 + cookie sesi; `POST /api/deploy` dengan sesi + CSRF → 302, `html:`/`quiz:` tertulis ke KV.
4. Smoke test manual lewat `npx wrangler dev --env staging` (KV remote) tetap disarankan sekali sebelum deploy produksi.

## 6. Fase B (Opsional, Terpisah): Ekstrak Aset Dashboard

Tanpa mengubah struktur rute:

- Ekstrak inline JS dashboard (±200 baris: `showDetail`, print modal, edit modal, `filterApps`, deep-link `?app=`) menjadi `public/vendor/dashboard.js`.
- Konsolidasikan token desain yang saat ini terduplikasi antara dashboard dan halaman rekap (`:root` variabel `--bg/--surface/--accent` dll.) — kandidat: dipindah ke `public/vendor/quiz.css` atau berkas `teacher.css` baru.
- Manfaat: mengikuti pola aset yang sudah ada, memangkas `dashboard.ts` drastis, tetap nol build step.
- Perhatian: template dashboard menyuntik nilai dinamis (`authCsrf`, `APPDATA`) ke JS — setelah ekstraksi, nilai itu harus tetap tersedia ke `dashboard.js` lewat `window.APPDATA`/meta tag seperti pola yang sudah dipakai `quiz-report.js`.
