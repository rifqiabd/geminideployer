# Analisis Kesiapan: Penggunaan Banyak Sekolah, Banyak Siswa & Guru

> Dokumen ini menilai kesiapan repo ini dipakai lintas **banyak sekolah** (multi-tenant),
> dengan banyak **guru** (peran & akun) dan banyak **siswa** (identitas, kelas, percobaan),
> seluruhnya di **Cloudflare** (Workers, KV, D1, R2).
>
> **Model distribusi yang dipilih: HYBRID + pendaftaran mandiri (self-service).**
> Artinya repo ini dipakai dua arah sekaligus:
> 1. **Lintasan A — instance publik:** satu domain milik pengelola, sekolah mendaftar sendiri
>    dan langsung mendapat ruangnya.
> 2. **Lintasan B — deploy sendiri:** sekolah (atau pihak yang membantu) mendeploy salinan di
>    akun Cloudflare sendiri untuk data yang benar-benar terpisah.
>
> Status kode saat ini: **single-tenant, single-admin**. Sangat layak untuk satu guru / satu
> sekolah. Untuk dua lintasan di atas dibutuhkan perubahan struktural, bukan sekadar tambah fitur.

---

## 1. Ringkasan eksekutif

| # | Temuan | Dampak | Prioritas |
| - | ------ | ------ | --------- |
| 1 | Sesi login = cookie statis berisi string literal `authenticated_user` | Akses admin bisa dipalsukan siapa pun yang tahu nilainya | **Kritis** |
| 2 | ~~Password admin hardcoded `admin123` dan tidak dibaca dari env~~ **RESOLVED (28 Sep 2026, plan-hardening-auth):** password kini dibaca dari env `APP_PASSWORD` dan wajib; fallback dihapus dari kode | Semua sekolah berbagi satu kredensial | **Kritis** |
| 3 | ~~Stored XSS di halaman rekap (`payload_json` + `user_id` tanpa escape)~~ **RESOLVED:** `escapeHtml()` dipakai pada `created_at`, `user_id`, `summary`, dan `JSON.stringify(payload)` di halaman rekap | Siswa bisa menjalankan skrip di browser guru | **Kritis** |
| 4 | Slug global dari judul → tabrakan antar guru/sekolah | Data kuis bisa tertimpa tanpa peringatan | Tinggi |
| 5 | Query D1 tanpa `LIMIT`, analitik dihitung ulang tiap request | Lambat + mahal begitu ada ribuan kiriman | Tinggi |
| 6 | Indeks aplikasi dibaca dari `KV list` + `get()` berurutan | Dashboard O(N), mentok ~1000 key, kena konsistensi eventual | Tinggi |
| 7 | Identitas siswa dari input bebas, tanpa kelas/daftar hadir | Tidak bisa cegah spam/peniruan, tidak bisa rekap per kelas | Tinggi |
| 8 | Tidak ada tenant & tidak ada pendaftaran mandiri | Sekolah tidak bisa melayani dirinya sendiri | Tinggi |
| 9 | Media jatuh ke KV kalau R2 tidak dipasang | KV bukan tempat binary: mahal & cepat habis kuota | Sedang |
| 10 | `/api/save/:slug` terbuka (CORS global, tanpa rate limit) | Bisa dibanjiri untuk membakar kuota D1 | Sedang |
| 11 | Edit soal tanpa versi (last-write-wins) + KV eventual | Dua guru bisa saling menimpa; siswa lihat versi basi | Sedang |

**Kesimpulan:** fondasi produknya sudah tepat (penilaian di server, editor soal, analisis
butir, koreksi esai). Yang belum ada adalah **lapisan tenant & identitas**, dan itu yang harus
dikerjakan lebih dulu sebelum sekolah lain diizinkan masuk.

**Catatan penting soal berbagi:** begitu tautan disebar ke banyak sekolah, setiap celah
keamanan di atas menjadi celah milik semua orang sekaligus. Karena itu Tahap 0 di roadmap
bersifat wajib sebelum promosi apa pun.

---

## 2. Arsitektur saat ini (peta cepat)

```
Cloudflare Worker (Hono) — src/index.ts
├─ /                        Dashboard admin (login 1 password)
├─ /p/:slug                 Halaman kuis siswa (tanpa login)
├─ /p/:slug/edit            Editor soal (mode JSON)
├─ /p/:slug/media           Panel gambar soal + generate AI
├─ /p/:slug/data            Rekap nilai + analisis butir soal
├─ /p/:slug/essay           Koreksi jawaban esai
├─ /api/deploy|delete|login|logout
└─ /api/save/:slug          Penerimaan jawaban siswa (penilaian di server)

Penyimpanan
├─ KV  STORAGE   html:<slug>, meta:<slug>, quiz:<slug>, quizsource:<slug>,
│                media:<slug>:<nama>, imggencfg:<slug>, imggen:<slug>:<menit>
├─ D1  DB        app_records(id, app_slug, user_id, payload_json, created_at)
└─ R2  MEDIA     OPSIONAL — kalau tidak dipasang, media disimpan di KV
```

Peran yang ada hari ini:

| Aktor | Cara masuk | Batas |
| ----- | ---------- | ----- |
| Admin/guru | 1 password bersama | Tidak ada pembeda antar sekolah atau antar guru |
| Siswa | Tanpa login | Nama diisi bebas di form, boleh kirim berkali-kali |

---

## 3. Analisis per dimensi

### 3.1 Tenant & autentikasi

- `APP_PASSWORD = 'admin123'` masih konstanta di `src/index.ts` dan **tidak dibaca dari
  `env`**, walau `.dev.vars.example` sudah menyuruh mengisinya. Semua sekolah yang memakai
  deployment sama berbagi satu kata sandi.
- `isAuthed()` (`src/auth.ts`) hanya membandingkan cookie dengan konstanta
  `authenticated_user`. Nilainya statis dan ada di repo, jadi siapa pun yang mengetahuinya bisa
  membuat cookie itu lewat JS (`document.cookie = ...`) — atribut `httpOnly` tidak menghalangi
  cookie yang **dibuat** dari JS. Tidak ada tanda tangan, tidak ada masa berlaku yang mengikat
  ke pengguna.
- Belum ada `school_id` di key KV maupun di tabel D1 → tidak ada isolasi data sama sekali.
  Ini bahaya terbesar untuk Lintasan A: satu query yang lupa difilter = data sekolah lain bocor.
- Beberapa rute memakai cek cookie langsung (`src/index.ts`) sementara yang lain memakai
  `isAuthed()` — dua sumber kebenaran yang mudah menyimpang saat peran ditambahkan.

### 3.2 Model data (D1)

`schema.sql` hanya berisi satu tabel:

```sql
CREATE TABLE app_records (
  id TEXT PRIMARY KEY, app_slug TEXT NOT NULL, user_id TEXT,
  payload_json TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_records_slug ON app_records(app_slug);
```

Konsekuensi:

- Tidak ada `school_id`, `class_id`, `assessment_id` nyata, `attempt_no`, atau status percobaan.
  Relasi sekolah → kelas → siswa → asesmen → kiriman tidak bisa dibentuk.
- Jawaban per soal menumpuk di dalam `payload_json` (blob JSON), sehingga analitik lintas
  kelas/sekolah mustahil tanpa membaca dan mengurai seluruh blob.
- Tidak ada `LIMIT`/pagination di query rekap (`src/index.ts`, `src/quiz-essay.ts`), padahal
  setiap baris di-`JSON.parse` di memori Worker.
- Analisis butir soal (`src/quiz-report.ts`) dihitung ulang setiap halaman dibuka dengan biaya
  O(seluruh kiriman). Semakin lama dipakai, semakin berat.

### 3.3 Penamaan & penyimpanan konten (KV)

- `sanitizeSlug(title)` menghasilkan namespace slug yang **global**. Dua guru di sekolah
  berbeda dengan judul sama akan saling menimpa `html:`, `meta:`, `quiz:`, dan `quizsource:`.
  Yang paling berbahaya: `quizsource:` menimpa sumber kebenaran editor soal.
- Kunci media `${slug}/${name}` (R2) dan `media:${slug}:${name}` (KV) mewarisi masalah yang sama.
- Dashboard membaca seluruh daftar aplikasi dari `STORAGE.list({ prefix: 'meta:' })`, lalu
  `get()` satu per satu ditambah `withMediaStats()` yang list/get lagi. Ini N+1 operasi KV.
- Editor soal menyimpan ke KV tanpa penanda versi: dua guru yang mengedit bersamaan → yang
  terakhir menulis menang; siswa bisa melihat HTML lama sampai KV konsisten.

### 3.4 Identitas siswa

- `userId = body.user || body.name || body.student_name || 'anonim'` (`src/index.ts`).
  Tidak ada daftar hadir, tidak ada kelas, tidak ada pembatasan jumlah percobaan.
- Akibat praktis: satu nama bisa dikirim berkali-kali, siswa bisa mengaku nama teman, dan dua
  siswa bernama sama tidak dapat dibedakan saat rekap. Guru tidak bisa membandingkan hasil antar
  kelas karena kelas tidak pernah tercatat.

### 3.5 Keamanan

1. **Sesi dapat dipalsukan** (lihat 3.1) — akar kepercayaan sistem.
2. **Stored XSS di halaman rekap**: tabel rekap menempelkan `JSON.stringify(payload, null, 2)`
   dan `user_id` mentah ke HTML. Nama siswa bebas teks, dan jawaban esai juga, sehingga siswa
   dapat menanam `<script>` yang berjalan di browser guru saat membuka Log Data. `escapeHtml()`
   sudah tersedia, tinggal diterapkan konsisten.
3. **Endpoint publik tanpa proteksi**: `/api/save/:slug` memakai `cors()` global tanpa rate
   limit/captcha. Penilaian aman (dihitung di server), tetapi tabel D1 bisa dibanjiri.
4. **Validasi unggahan sudah baik**: tipe file dari magic bytes, SVG ditolak, ada batas ukuran.
   Pertahankan.
5. **Pola rate limit sudah ada** di generate AI (6 gambar/menit, KV counter) — pola ini bisa
   dipakai ulang untuk `/api/save` dan pendaftaran sekolah.

### 3.6 Media

- `putMedia` otomatis jatuh ke KV bila binding R2 tidak dipasang. Untuk satu sekolah masih jalan;
  untuk banyak sekolah ini jalur biaya paling cepat membengkak (KV bukan penyimpanan binary:
  batas nilai ~25 MiB, ditagih per operasi, 1 tulis/detik/key).
- Konversi WebP + pengecilan di perangkat guru sudah tepat dan menghemat kuota. Pertahankan, dan
  tambahkan varian ukuran (thumbnail) untuk sekolah dengan koneksi lemah.

---

## 4. Batasan platform Cloudflare (patokan biaya & performa)

> Angka ini batas tingkatan gratis/tipikal; verifikasi ulang di dokumentasi Cloudflare sebelum
> dipakai untuk keputusan anggaran.

| Layanan | Batas yang perlu diperhatikan | Implikasi |
| ------- | ----------------------------- | --------- |
| Workers (gratis) | ~100k request/hari, CPU 10 ms/request | Render rekap besar menabrak batas CPU; paket Paid (~$5/bln) praktis wajib begitu beberapa sekolah aktif |
| Workers (paid) | CPU hingga 30 detik, kuota request jauh lebih besar | Beri ruang untuk rekap, tapi tetap jangan O(seluruh histori) |
| KV | ~1k tulis/hari & 100k baca/hari (gratis); value ~25 MiB; 1 tulis/detik/key | Setiap kiriman siswa = tulis D1 + baca KV; media di KV cepat habis |
| KV (konsistensi) | Eventual, list bisa telat | Jangan pakai KV list sebagai indeks utama |
| D1 | ~5 GB, ~5 juta baris dibaca/hari, ~100k baris ditulis/hari (gratis) | Bottleneck di **baris dibaca** karena rekap membaca semua baris |
| R2 | Penyimpanan objek murah, tanpa biaya keluar | Wajib untuk media pada skala banyak sekolah |

Bottleneck utama bukan kapasitas penyimpanan, melainkan **jumlah baris yang dibaca** dan
**jumlah tulis KV** — keduanya berakar pada pola akses data saat ini.

---

## 5. Model distribusi: hybrid + pendaftaran mandiri

### 5.1 Lintasan A — instance publik (sekolah mendaftar sendiri)

Yang harus ada supaya sekolah bisa melayani dirinya sendiri:

- Halaman depan publik (penjelasan singkat + pendaftaran sekolah).
- Pendaftaran: nama sekolah, email admin, verifikasi email, **Turnstile**.
- Sekolah = tenant. Admin sekolah mengundang guru lewat tautan undangan; guru membuat kelas dan
  asesmen; siswa masuk memakai **kode kelas** lalu memilih namanya dari daftar hadir.
- **Kuota per sekolah** (jumlah asesmen, kiriman/bulan, MB media, panggilan generate AI) yang
  ditampilkan ke guru, supaya satu sekolah tidak menghabiskan kuota milik semua orang — dan supaya
  batas Cloudflare tidak pernah muncul sebagai error mentah di depan guru.
- **Panel super-admin**: daftar sekolah, pemakaian, aktif/nonaktif, hapus data sekolah.
- **Anti-penyalahgunaan**: Turnstile, rate limit, verifikasi email wajib, batas pendaftaran baru
  per hari.
- **Uji isolasi tenant**: minimal satu tes otomatis yang membuktikan sekolah A tidak bisa membaca
  data sekolah B (lewat slug, id, atau media yang ditebak). Ini penjaga paling penting di Lintasan A.

### 5.2 Lintasan B — deploy sendiri

- Tombol **Deploy to Cloudflare** + wizard `/setup` saat pertama dibuka (membuat admin sekolah
  pertama + menyiapkan skema).
- Tanpa email/pihak ketiga: mode mandiri harus tetap berfungsi penuh (aktivasi manual saat setup).
- Dokumen "deploy dalam 5 menit" + checklist secret (`APP_PASSWORD`, `SESSION_SECRET`, opsi API
  gambar). Panduan guru sudah ada di `docs/panduan-pakai.md` dan bisa dipakai apa adanya.

### 5.3 Satu basis kode, bukan dua

Kuncinya: **bangun skema multi-tenant lebih dulu, lalu instance mandiri hanyalah deployment
dengan satu tenant di dalamnya.** Dengan begitu tidak ada dua basis kode yang harus dirawat
paralel:

- tabel inti selalu membawa `school_id`;
- middleware tenant mengambil `school_id` dari sesi, dan di deployment mandiri nilainya selalu
  satu sekolah yang sama;
- tidak ada fitur yang "hanya ada di instance publik" selain pendaftaran publik, kuota, dan panel
  super-admin — dan itu dipasang sebagai lapisan opsional yang dimatikan di mode mandiri.

### 5.4 Konsekuensi hukum & operasional (khusus Lintasan A)

Kamu menjadi pihak yang menyimpan **data anak-anak dari banyak sekolah**, jadi ini bukan sekadar
urusan teknis. Ini bukan nasihat hukum, tetapi daftar yang wajib dibahas sebelum go-public:

- **Dasar pemrosesan**: sekolah adalah pengendali data, kamu pemroses. Siapkan perjanjian
  pemrosesan data (DPA) ringkas yang disetujui saat pendaftaran sekolah.
- **Kebijakan privasi & syarat layanan** yang bisa dibaca guru, ditulis dengan bahasa sederhana.
- **Minimisasi data**: jangan meminta NISN, alamat, atau kategori data khusus. Nama + kelas sudah
  cukup untuk keperluan pembelajaran.
- **Retensi**: hapus otomatis setelah jangka waktu tertentu (mis. 12 bulan), dengan opsi sekolah
  memperpanjang atau menghapus lebih cepat.
- **Hak subjek data**: ekspor dan hapus data per siswa / per kelas / per sekolah — tersedia
  sebagai fitur, bukan permintaan manual ke kamu.
- **Notifikasi insiden**: punya prosedur dan catatan, karena keterlambatan notifikasi sering lebih
  mahal daripada insidennya sendiri (aturan UU PDP di Indonesia mengatur tenggat notifikasi).
- **Moderasi konten**: guru bisa mengunggah foto dan hasil AI. Sediakan mekanisme lapor & take-down,
  serta halaman kebijakan konten.
- **Dukungan**: kanal bantuan (email/WhatsApp) dan FAQ. Tanpa ini, jumlah sekolah akan tumbuh
  lebih cepat daripada kemampuanmu melayani.

### 5.5 Layanan pihak ketiga yang dibutuhkan

Dua kebutuhan yang paling cepat muncul, dengan opsi yang sudah saya telusuri lewat indeks layanan:

| Kebutuhan | Opsi yang ditelusuri | Catatan |
| --------- | -------------------- | ------- |
| Login & verifikasi guru/sekolah | **Magic Auth** (magic link, jalan di edge — cocok untuk Workers) | Alternatif: sesi sendiri di D1 + kode OTP via email, lebih murah dan lebih mudah dikontrol, tapi kamu menanggung sendiri alur keamanannya |
| Email transaksional (verifikasi, undangan, reset) | **Knock** (orkestrasi notifikasi via REST, aman di edge) | Alternatif: **AWS SES** lebih murah pada volume besar, tapi menuntut pengelolaan reputasi pengirim sendiri |

Pertimbangan tambahan yang perlu ditelusuri saat Fase 3: **login Google Workspace sekolah**
(banyak sekolah sudah punya akun `@sekolah.sch.id`, sehingga guru tidak perlu kata sandi baru).

---

## 6. Roadmap

Tahap 0 dan 1 bersifat serial dan wajib. Setelah itu Lintasan B dan A boleh berjalan paralel —
Lintasan B disarankan lebih dulu karena lebih cepat memberi manfaat dan risikonya jauh lebih kecil.

### Tahap 0 — Wajib sebelum disebar ke siapa pun

Tujuannya bukan fitur, tetapi memastikan tidak ada celah yang ikut tersebar.

- [ ] Pindahkan kata sandi ke secret: `npx wrangler secret put APP_PASSWORD`, baca dari `env`.
- [ ] Ganti cookie statis dengan **sesi bertanda tangan** (HMAC/`jose`) berisi
      `{ userId, schoolId, role }` + masa berlaku; satukan semua cek ke satu middleware.
- [ ] Terapkan `escapeHtml()` pada **semua** keluaran admin (tutup XSS tersimpan).
- [ ] Rate limit per IP di `/api/save/:slug` (pakai pola KV counter yang sudah ada).

### Tahap 1 — Fondasi bersama (satu basis kode)

- [ ] Skema multi-tenant: `schools → users(role) → classes → students → assessments → attempts
      → attempt_answers`, semua baris membawa `school_id`.
- [ ] Middleware tenant: setiap query disaring `school_id` dari sesi — **jangan** bergantung pada
      slug di URL.
- [ ] Pisahkan identitas dan URL: UUID untuk kunci KV (`quiz:<school>/<id>`), slug hanya untuk
      alamat yang enak dibaca, dengan pemeriksaan keunikan sebelum simpan.
- [ ] Pindahkan indeks aplikasi dari KV list ke tabel D1 dengan pagination.
- [ ] Tambahkan `LIMIT` di semua query rekap; pindahkan perhitungan analitik butir soal ke saat
      submit (atau Queue → pembaruan terbatas) dan simpan hasilnya.
- [ ] R2 untuk media, dengan kunci `school_id/assessment_id/slot`.

Hasil Tahap 1: deployment mandiri sudah aman dipakai satu sekolah.

### Tahap 2 — Lintasan B rilis (deploy sendiri)

- [ ] Wizard `/setup` pertama kali: buat admin sekolah + siapkan skema.
- [ ] Tombol Deploy to Cloudflare + dokumentasi "5 menit" + checklist secret.
- [ ] Mode mandiri berjalan penuh tanpa layanan pihak ketiga.

### Tahap 3 — Lintasan A rilis (instance publik, pendaftaran mandiri)

- [ ] Halaman depan publik + pendaftaran sekolah (verifikasi email + Turnstile).
- [ ] Peran `admin_sekolah` / `guru`, undangan guru, kode kelas, daftar hadir siswa,
      pengaturan jumlah percobaan.
- [ ] Kuota per sekolah + panel super-admin (daftar sekolah, pemakaian, aktif/nonaktif, hapus data).
- [ ] Tes isolasi tenant yang dijalankan otomatis.
- [ ] Analitik pemakaian per sekolah (Analytics Engine + tabel counter) sebagai dasar kuota.
- [ ] Dokumen kepatuhan: kebijakan privasi, syarat layanan, DPA, kebijakan konten, prosedur insiden.

### Tahap 4 — Skala & kepatuhan berkelanjutan

- [ ] Pagination di semua daftar; arsip rekap lama ke R2 (NDJSON) setelah periode retensi.
- [ ] Tenant per subdomain (`sekolah-a.domainmu.id`) memakai custom hostname, `school_id`
      di-resolve dari hostname.
- [ ] Varian ukuran gambar (thumbnail) + cache lebih agresif di tepi.
- [ ] Fitur self-service: ekspor & hapus data per siswa/kelas/sekolah.
- [ ] Observability: Workers Logs + peringatan saat pemakaian mendekati batas.

---

## 7. Biaya (perkiraan)

| Skenario | Beban |
| -------- | ----- |
| Lintasan B (sekolah mandiri) | Ditanggung sekolah: Workers Paid ~$5/bln + D1 + R2 sesuai pemakaian |
| Lintasan A (instance publik) | Ditanggung pengelola: satu akun menanggung semua sekolah. Puluhan hingga ~100 sekolah aktif dengan puluhan ribu kiriman/bulan umumnya masih di bawah belasan dolar/bulan **setelah** Tahap 1, karena baru media R2 + analitik saat submit yang membuat biaya tetap datar. Yang membengkak adalah KV bila media tetap di sana |

Risiko biaya terbesar di Lintasan A bukan softwarenya, melainkan **satu sekolah yang menghabiskan
kuota bersama** (terutama generate gambar AI dan media). Karena itu kuota per sekolah adalah fitur
inti, bukan pelengkap.

---

## 8. Prioritas mendesak

Kalau hanya boleh mengerjakan tiga hal lebih dulu:

1. **Cookie statis yang bisa dipalsukan** — akar kepercayaan sistem.
2. **Stored XSS di halaman rekap** — guru adalah pengguna paling berharga, dan saat ini bisa
   diserang oleh input siswa.
3. **Indeks aplikasi di D1 + `LIMIT` di semua query rekap** — kunci performa sekaligus biaya.

Ketiganya masuk Tahap 0–1, dan relevan untuk kedua lintasan. Setelah itu tenant & peran menjadi
pekerjaan yang jauh lebih aman untuk dimulai.

---

## 9. Peta kode yang menjadi titik perubahan

| Area | Berkas | Catatan |
| ---- | ------ | ------- |
| Auth & password | `src/index.ts`, `src/auth.ts` | Konstanta password, cek cookie ganda |
| Indeks aplikasi & rekap | `src/index.ts` | KV list N+1, `SELECT *` tanpa LIMIT, XSS di tabel |
| Koreksi esai | `src/quiz-essay.ts` | `SELECT *` tanpa LIMIT |
| Analisis butir soal | `src/quiz-report.ts` | Dihitung ulang tiap request |
| Editor soal | `src/quiz-editor.ts` | Tulis KV tanpa versi |
| Media | `src/media.ts`, `src/media-routes.ts` | Fallback KV, pola rate limit yang bisa dipakai ulang |
| Skema data | `schema.sql` | Satu tabel, tanpa tenant |
| Konfigurasi deploy | `wrangler.jsonc` | R2 masih opsional; secret belum dipakai untuk password |
| Alur siswa | `src/quiz-page.ts` | Nama siswa dari input bebas |
| Panduan (bisa jadi basis dukungan) | `docs/panduan-pakai.md` | Sudah lengkap untuk guru |
