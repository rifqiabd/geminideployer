# Rencana Hardening Autentikasi (Sesi Bertanda Tangan)

Status: **Selesai diimplementasikan (28 September 2026)** — T1-T9 dikerjakan sesuai dokumen ini, `tests/auth.test.mjs` (55 test) dirangkai ke `npm test`. T0 runtime (pemasangan secret di Cloudflare) dan T10 smoke test manual masih menunggu eksekusi oleh manusia; lihat `docs/checklist.md` bagian 1.
Target deployment: satu sekolah, sekitar 30 siswa
Ketersediaan repo: **private** (remote GitHub membalas 404 tanpa autentikasi, dicek 27 Sep 2026)
Dokumen induk auth/CBT: `docs/plan-google-cbt.md` (tetap sumber kebenaran untuk Fase 0-5)

## 1. Ringkasan Keputusan

- Mengganti cookie statis `auth_session=authenticated_user` dengan **sesi stateless bertanda tangan HMAC-SHA256**.
- **Tidak** memakai Google OAuth, **tidak** menambah tabel D1, **tidak** menambah tenant atau `school_id`, dan **tidak** menambah dependensi npm.
- Sesi disimpan penuh di dalam cookie yang ditandatangani, sehingga tidak ada D1 read per request dan tidak perlu migration.
- Fallback `admin123` dihapus permanen. `APP_PASSWORD` dan `SESSION_SECRET` menjadi wajib; kalau salah satu belum diset, route admin menjawab 503 dengan instruksi setup, bukan memakai password default.
- Rate limit di `/api/login` memakai pola counter KV yang sudah ada (`src/media-routes.ts:188-196`), tetapi diubah menjadi **fail-closed**.
- Token CSRF diturunkan dari nonce yang sudah ada di payload sesi, jadi tidak butuh penyimpanan tambahan. Diterima lewat field `_csrf` (form HTML) maupun header `X-CSRF-Token` (jalur `fetch`).
- CORS dipecah: endpoint publik siswa tetap `origin: '*'` tanpa kredensial, endpoint admin memakai allowlist eksplisit.
- `?print=1&kunci=1` dikunci di server sehingga kunci jawaban tidak bocor tanpa sesi.
- `apiKey` plaintext dihapus dari respons `GET /api/media/:slug/gen-config`.
- Verifikasi memakai `npm test` dan `npm run typecheck`. Harness tes HTTP (mock KV/D1) **tidak** dikerjakan di dokumen ini.

Dokumen ini adalah salah satu prasyarat `docs/plan-google-cbt.md` Fase 0. Setelah selesai, Fase 0 tinggal menambah Google OAuth di atas fondasi yang sudah ada, bukan membangun dari nol.

### Konteks risiko: apa yang sebenarnya bisa terjadi

Repo ini private, jadi sponsor serangan yang biasanya kita bayangkan — orang yang menemukan repo di Google, pastebin, atau packet sniffer — tidak relevan di sini. Yang tersisa adalah **kegagalan konfigurasi** dan **kebiasaan pemakaian**, dan untuk pilot satu sekolah itu sudah lebih dari cukup.

#### Skenario yang paling mungkin terjadi

| # | Skenario | Kenapa realistis | Dampak | Ditutup oleh |
|---|---|---|---|---|
| 1 | `admin123` tetap aktif karena `APP_PASSWORD` lupa diisi saat deploy | Domain `*.workers.dev` bisa ditebak dari nama proyek, dan `admin123` adalah tebakan paling pertama yang akan dicoba. Ini bukan serangan yang rumit, ini sekadar lupa mengisi satu variabel. | Admin penuh: publish, ganti judul, hapus semua kiriman, buka kunci jawaban | T1, T2 |
| 2 | Komputer lab dipakai bersama, sesi tidak pernah kedaluwarsa | Cookie sekarang berupa literal permanen tanpa masa berlaku. Guru login sekali di komputer kelas; siapa pun yang memakai komputer itu berikutnya langsung punya akses admin, tanpa batas waktu. | Akses admin tanpa jejak siapa yang masuk | T1, T2 (tetap wajib logout manual) |
| 3 | Murid menambahkan `&kunci=1` pada link kuis | Pola `/p/<slug>` sudah dibagikan ke teman atau muncul di grup chat. Menambahkan satu parameter tidak butuh trik apa pun. | Kunci jawaban terbuka tanpa login | T6 |
| 4 | Dua kelas membuat kuis dengan judul sama | `sanitizeSlug()` hanya membersihkan judul, jadi "Ulangan Harian" dari kelas 7A dan 7B menghasilkan slug identik. | ~~Saling menimpa~~ → publish kedua dapat sufiks acak, jadi keduanya hidup berdampingan | **Ditutup** (lihat catatan di bawah) |
| 5 | Guru A melihat kunci API milik guru B | Kunci disimpan plaintext dan dikembalikan ke browser. Baru terasa begitu ada lebih dari satu guru. | Biaya API terpakai akun orang lain | T7 |

Nomor 1, 2, dan 3 adalah risiko yang **benar-benar akan terjadi** di pilot ini, dan ketiganya ditutup oleh Bagian 5 dokumen ini. Nomor 5 baru terasa kalau lebih dari satu guru aktif — dan skenario "tiga kelas berbagi satu akun admin" justru yang paling mungkin muncul duluan di sebuah sekolah. Nomor 4 sudah ditutup di luar auth, lewat perubahan slug di `POST /api/deploy`.

> Catatan-interaksi (sudah，回头): fitur tanggal membuat `created_at` tidak lagi di-reset saat publish ulang. Kalau overwrite masih mungkin, kuis yang tertimpa mewarisi tanggal buat kuis lama sehingga overwrite lebih sulit disadari. Ini alasan tambahan kenapa guard bentrok di `/api/deploy` tidak bisa ditunda.

**Cara skenario 4 ditutup (di luar lingkup auth):**

- `POST /api/deploy` mengecek `meta:<slug>` sebelum menyimpan. Kalau slug dasar masih bebas, app baru memakai slug itu apa adanya.
- Kalau sudah dipakai, `uniqueSlug()` mengupai enam sufiks acak 4 karakter (`randomSlugSuffix()` di `src/quiz-util.ts:295-314`) dan memakai yang pertama yang `meta:`-nya belum ada. Karakter ambiguous `i l o 0 1` sengaja tidak dipakai supaya guru tidak salah mengetik saat menyalin URL. Cadangan terakhir: slug dasar + timestamp base36.
- Spec yang disimpan di `quiz:<slug>` ditulis ulang ke slug akhir, sehingga penilaian server dan editor tidak menyimpang dari URL.
- `quizsource:<slug>` sengaja menyimpan slug yang diketik guru, apa adanya. Editor menyimpan lewat rute (`/api/quiz/:slug/save`) yang selalu memakai slug alamat, jadi slug lama di dalam sumber tidak pernah menentukan alamat lagi.
- Publish diarahkan ke `/?app=<slug>` supaya guru langsung melihat panel detail dan menyalin URL yang benar.
- `POST /api/app/update` (`:1360`) tetap **menolak** slug yang sudah dipakai, bukan otomatis memberi sufiks. Di situ slug adalah keputusan guru yang sedang diklik, dan diam-diam memindahkannya justru membingungkan.
- Satu-satunya app lawas, `akidah-akhlak-kelas-1` (`meta.type = "html"`), dibiarkan apa adanya. Pen النشر tidak lagi membuat app HTML/React baru, jadi tidak ada sumber baru untuk app sejenis.

#### Yang tetap terbuka setelah dokumen ini selesai

- **Setiap guru tetap admin penuh.** Tidak ada peran, tidak ada audit log. Sidebar sudah menampilkan tanggal dibuat dan tanggal diubah, jadi guru bisa tahu *kapan* kuis berubah — tapi tidak tahu *siapa*. Untuk satu sekolah ini mungkin masih diterima; begitu ada dua guru yang saling menimpa kuis, ini akan jadi keluhan pertama.
- **Domain masih bisa ditebak.** Password kuat plus rate limit menurunkan risiko, tapi tidak menghapus kemungkinan domain ditemukan.
- **Kunci jawaban hanya terkunci di server.** Jawaban tetap dikirim ke browser untuk penilaian, jadi murid yang membuka DevTools masih bisa membacanya. T6 menutup jalan pintas lewat query string, bukan semua jalan.
- **Tidak ada batas upload per akun.** `MAX_MEDIA_PER_APP` masih dipakai sebagai `limit` saat listing, bukan sebagai batas tulis.
- **Slug global masih ada.** Dua app berbeda masih bisa berbagi slug dasar yang sama, hanya berbeda sufiks. Yang ditutup adalah overwrite diam-diam, bukan tabrakan nama itu sendiri.

#### Pemicu peninjauan ulang

| Pemicu | Yang harus diulang |
|---|---|
| Repo GitHub dipublikasikan atau dibuka | Seluruh dokumen ini. Cookie literal + `admin123` berubah dari catatan kecil menjadi kerentanan kritis yang harus ditangani hari itu juga. |
| Guru kedua bergabung memakai akun sendiri | Skenario 4 dan 5, peran admin, batas upload |
| Sekolah meminta 2+ kelas atau lebih dari 100 siswa | Rate limit untuk endpoint admin selain login; query rekap tanpa `LIMIT` |
| Ada insiden (kunci bocor, kiriman hilang) | Audit log — belum ada di desain dokumen ini sama sekali |

## 2. Kondisi Saat Ini (terverifikasi terhadap kode)

### Sesi dan password

- `src/auth.ts:9` mengekspor konstanta `AUTH_SESSION = 'authenticated_user'`. `src/auth.ts:11-13` (`isAuthed`) hanya membandingkan nilai cookie dengan konstan itu.
- Nilainya adalah **literal yang tertanam di source code**, bukan rahasia. Atribut `httpOnly` tidak menghalangi cookie yang **dibuat** dari sisi klien, jadi selama nilainya diketahui, siapa pun bisa memalsukan cookie tersebut. Untuk repo private, risikonya bukan "nilai ini bisa di-Google", melainkan nilainya akan bocor begitu repo ini dibuka atau artefak build-nya bocor.
- `src/index.ts:28,34` masih mendeklarasikan `FALLBACK_PASSWORD = 'admin123'`, dan `src/index.ts:538` memakainya kalau `c.env.APP_PASSWORD` kosong.
- Pemeriksaan auth terpecah jadi dua gaya:

  | Gaya | Lokasi |
  |---|---|
  | `isAuthed(c)` | `src/quiz-editor.ts:26,255`; `src/quiz-essay.ts:40,268`; `src/media-routes.ts:98,154,175,257,276,303`; `src/tka-studio.ts:908,924,967,1018,1077` |
  | `getCookie(c, 'auth_session') !== 'authenticated_user'` | `src/index.ts:256,538,1270,1315,1336` |

- Tidak ada `SESSION_SECRET`, tidak ada `crypto.subtle`, tidak ada `jose`. Total dependency runtime hanya `hono`.
- `src/index.ts:532-533` (`/api/logout`) memakai `GET` lalu menghapus cookie.
- Cookie sesi tidak punya `maxAge` maupun `expires`, jadi umurnya tidak terbatas sampai browser ditutup. Ini dasar skenario 2 di Bagian 1.

### CORS

`src/index.ts:37` memanggil `app.use('/api/*', cors())` tanpa argumen, sehingga `origin: '*'` berlaku untuk seluruh `/api/*`, termasuk endpoint admin yang rely cookie. Hono tidak mengirim `Access-Control-Allow-Credentials` bersama `origin: '*'`, jadi exploit langsungnya terbatas. Konfigurasinya tetap salah dan akan berbahaya begitu allowlist ditambahkan dengan cara ceroboh.

### CSRF

Sepuluh form HTML POST yang dilindungi auth, ditambah tujuh call site `fetch()`:

| # | Lokasi | Endpoint | Metode |
|---|---|---|---|
| 1 | `src/index.ts:811` | `/api/login` | form POST |
| 2 | `src/index.ts:865` | `/api/delete` | form POST |
| 3 | `src/index.ts:930` | `/api/deploy` | form POST |
| 4 | `src/index.ts:1011` | `/api/app/update` | form POST |
| 5 | `src/index.ts:1133` | `/api/delete` | form POST yang dibangun di string JS |
| 6 | `src/tka-studio.ts:233` | `/studio/template` | form POST |
| 7 | `src/tka-studio.ts:253` | `/studio/subject` | form POST |
| 8 | `src/tka-studio.ts:747` | `/studio/import` | form POST `multipart/form-data` |
| 9 | `src/tka-studio.ts:786` | `/studio/subject` | form POST |
| 10 | `src/tka-studio.ts:835` | `/studio/template` | form POST |
| 11 | `public/vendor/quiz-editor.js:821` | `/api/quiz/:slug/save` | `fetch` |
| 12 | `public/vendor/quiz-essay.js:37` | `/api/quiz/:slug/essay` | `fetch` |
| 13 | `src/media-routes.ts:702` | `/api/media/:slug` | `fetch` |
| 14 | `src/media-routes.ts:719` | `/api/media/:slug/delete` | `fetch` |
| 15 | `src/media-routes.ts:754` | `/api/media/:slug/generate` | `fetch` |
| 16 | `src/media-routes.ts:854` | `/api/media/:slug/gen-config` | `fetch` |
| 17 | `src/media-routes.ts:877` | `/api/media/:slug/gen-config` (reset) | `fetch` |

Satu-satunya proteksi sekarang adalah `SameSite=Lax` (`src/index.ts:520`), yang memblokir cookie pada POST lintas-site di browser modern. Yang tidak tertutup: browser lama, klien non-browser, dan nomor 1 (login CSRF) yang tidak punya proteksi apa pun karena memang tidak ada ambient authority.

`docs/plan-google-cbt.md:76` dan `:436` hanya menyebut tiga form (`/api/deploy`, `/api/delete`, `/api/app/update`). Lima form TKA Studio dan header `X-CSRF-Token` untuk jalur `fetch` terlewat di sana; dokumen ini menutup keduanya.

### Kebocoran kunci jawaban

- `src/index.ts:140-153` melayani `?print=1` dan `?print=1&kunci=1` dari `GET /p/:slug` yang sama sekali tidak punya auth check. `showKunci` diambil langsung dari query string di `src/index.ts:153`.
- Dashboard sendiri hanya menampilkan link tersebut ke sesi authed (dibentuk di `src/index.ts:1200`), tetapi link dashboard bukan gerbang. Siapa pun yang tahu pola URL bisa meminta kunci jawaban.
- `docs/peta-migrasi-frontend-backend.html:370-376` mengklaim sebaliknya ("Kunci jawaban dan pembahasan tidak pernah dikirim ke browser"). Klaim itu salah dan harus dikoreksi.

### Kebocoran `apiKey` BYOK

- `src/media-routes.ts:267` mengembalikan `apiKey` plaintext ke sesi mana pun yang lolos auth. Kunci ini milik guru, bukan milik admin, jadi begitu ada lebih dari satu guru ini kebocoran lintas akun.
- `src/media-routes.ts:819` membaca konfigurasi itu dan `:829` mengisi ulang input form dengan kunci plaintext, sehingga kunci juga ikut tersimpan di DOM dan bisa diambil lewat devtools atau tangkapan layar.

### Kelemahan lain yang sudah terverifikasi (di luar cakupan dokumen ini)

| Temuan | Lokasi | Catatan |
|---|---|---|
| `KEY` tidak terdefinisi | `src/quiz-page.ts:746` | `localStorage.setItem(KEY, name)`; error tertelan `catch` kosong, nama siswa tidak tersimpan saat submit |
| Batas media hanya saat `list()` | `src/media.ts:137,146` | `MAX_MEDIA_PER_APP = 200` dipakai sebagai `limit`, bukan write cap; upload ke-201 dan seterusnya sukses tapi tak terlihat |
| Query rekap tanpa `LIMIT` | `src/index.ts:264`, `src/quiz-essay.ts:67` | `SELECT *` penuh, di-parse di memori Worker |
| `app_records` yatim | `src/index.ts:1314-1334` | `/api/delete` menghapus KV dan media, tidak pernah menyentuh D1 |
| Grading fail-open | `src/index.ts:230-232` | Spec yang gagal parse disimpan tanpa grading |
| Slug global | `src/index.ts:55-62` | `sanitizeSlug()` hanya membersihkan judul. `/api/deploy` (`:1269-1312`) mengecek bentrok dan, kalau `meta:<slug>` sudah ada, memakai sufiks acak dari `uniqueSlug()` (`:78-85`) — jadi dua guru dengan judul sama tidak saling menimpa. `/api/app/update` (`:1360`) tetap menolak slug bentrok. Ditutup; lihat skenario 4 di Bagian 1. |

## 3. Batas Kerja

### Termasuk

- Modul sesi stateless bertanda tangan di `src/auth.ts`, dengan helper inti yang tidak memakai `Context`.
- Penghapusan `FALLBACK_PASSWORD` dan penghapusan jalur kode yang menerima password default.
- Penyatuan seluruh pemeriksaan admin ke satu helper.
- Rate limit `/api/login` dengan fail-closed, ditambah lockout sementara.
- Token CSRF untuk sepuluh form HTML dan tujuh call site `fetch`.
- Pemecahan konfigurasi CORS menjadi lapisan publik dan lapisan admin.
- Penguncian `?kunci=1` di server.
- Penghapusan `apiKey` dari respons `gen-config`, dengan semantik "pertahankan kunci yang ada".
- Test unit untuk helper sesi di `tests/auth.test.mjs` (file baru).
- Pembaruan `AGENTS.md`, `docs/panduan-pakai.md`, `src/guide.ts`, dan penandaan status pada dokumen plan lain.

### Tidak termasuk

- Google OAuth, tabel `users` dan `auth_sessions`, role `teacher` dan `student`, session storage di D1. Semuanya milik `docs/plan-google-cbt.md` Fase 0.
- Ownership per guru, namespace `owned:<...>`, roster, mode assigned, timer, autosave, submit idempotent.
- `school_id`, tenant, kelas, dan jalur multi-sekolah. Target satu sekolah, jadi tidak ada kolom yang perlu ditambahkan.
- Revoke per sesi. Rotasi `SESSION_SECRET` adalah jalur pencabutan darurat yang tersedia sekarang.
- Harness tes HTTP (mock KV/D1) dan direktori `migrations/`. Ini prasyarat Fase 0 plan-google-cbt dan tercatat di sana.
- Pemecahan admin menjadi SPA (`docs/peta-migrasi-frontend-backend.html`). Ditunda sesuai keputusan.
- Perbaikan `KEY`, write cap media, `LIMIT` query, R2, dan `app_records` yatim. Terpisah dan independen dari auth.
- ~~**Guard tabrakan slug di `POST /api/deploy`.**~~ **Sudah dikerjakan, di luar auth.** `/api/deploy` (`:1269-1312`) sekarang mengecek `meta:<slug>` dan, kalau dipakai, memanggil `uniqueSlug()` (`:78-85`) untuk memberi sufiks acak. Ini skenario 4 di Bagian 1. Yang tersisa dari bullet ini hanya `/api/app/update` (`:1360`), dan itu memang sengaja ditolak, bukan disuffix — alasannya ada di catatan skenario 4.

## 4. Arsitektur Sesi

### Bentuk cookie

```text
auth_session = <base64url(payload)>.<base64url(hmac)>

payload = {"v":1,"sub":"admin","role":"admin","npc":"<16 byte base64url>","iat":<epoch s>,"exp":<epoch s>}
hmac    = HMAC-SHA256(SESSION_SECRET, base64url(payload))
```

- Panjang payload sekitar 120 byte, jauh di bawah batas cookie.
- `npc` adalah nonce per sesi. Disimpan supaya token CSRF bisa diturunkan tanpa penyimpanan server.
- `sub` dan `role` disimpan meski sekarang nilainya konstan, supaya `docs/plan-google-cbt.md` tidak perlu mengubah bentuk cookie saat peran sebenarnya sudah ada.
- `v` sebagai versi format, supaya rotasi format tidak gagal diam-diam.

### Verifikasi

`verifySession(value, secret, now)` menolak nilai bila salah satu syarat ini tidak terpenuhi:

1. Format dua bagian yang dipisah titik.
2. `safeEqual` antara HMAC hasil hitung ulang dan HMAC yang dikirim. `safeEqual` harus membandingkan panjang tetap dan tidak keluar loop lebih awal.
3. `v === 1`.
4. `exp > now` dalam detik.
5. `iat <= now + 60` untuk toleransi drift jam.

Semua kegagalan mengembalikan `null`. Fungsi tidak pernah melempar error dan tidak pernah membocorkan alasan kegagalan ke pemanggil.

### Token CSRF

```text
csrfFor(npc, secret) = base64url(HMAC(SESSION_SECRET, "csrf:" + npc))
```

Deterministik, tanpa state, dan otomatis invalid kalau cookie sesi berubah. `verifyCsrf` menerima salah satu dari:

- field `_csrf` pada body form, termasuk `multipart/form-data`,
- header `X-CSRF-Token` untuk jalur `fetch`.

Selalu bandingkan dengan `safeEqual`.

### Form login (login CSRF)

`GET /` yang belum punya sesi memasang cookie `auth_pre` berisi nilai bertanda tangan `{v:1,npc,exp}` dengan TTL 30 menit. Form login (`src/index.ts:811`) memuat `_csrf` yang diturunkan dari `npc` milik `auth_pre`. `/api/login` memverifikasi token itu sebelum memeriksa password, lalu mengabaikan `auth_pre`.

Kalau `auth_pre` tidak ada atau kedaluwarsa, form login menampilkan token kosong dan `/api/login` menjawab 403 dengan pesan "muat ulang halaman".

Alternatif yang lebih murah: lewati CSRF di `/api/login` dan andalkan password bersama tunggal untuk menutup dampaknya. Dampaknya memang rendah, tapi jalur `auth_pre` hanya sekitar 15 baris dan memakai helper yang sama, jadi lebih liking dikerjakan sekalian.

### Atribut cookie

Tidak berubah dari sekarang: `path: '/'`, `httpOnly: true`, `secure: true`, `sameSite: 'Lax'`, `maxAge: 60*60*24*7`.

Catatan: `secure: true` berarti guru yang memakai `http://` lewat IP LAN (bukan `localhost`) akan melihat login gagal diam-diam. Chrome dan Firefox memperlakukan `localhost` sebagai secure context, jadi `npx wrangler dev` lokal tidak terpengaruh.

## 5. Perubahan per File

### T0 - Env dan urutan deploy (WAJIB, kerjakan sebelum T1)

```text
npx wrangler secret put SESSION_SECRET      # nilai dari: openssl rand -base64 32
npx wrangler secret put APP_PASSWORD        # hapus nilai admin123
# staging, ulangi dengan flag env:
npx wrangler secret put SESSION_SECRET --env staging
npx wrangler secret put APP_PASSWORD --env staging
```

- Tambah `SESSION_SECRET` ke `.dev.vars.example` (tanpa nilai nyata) dan ke `.dev.vars` lokal.
- Kode akan **menolak boot login** kalau salah satu secret kosong. Urutan di atas harus selesai sebelum kode di-deploy, atau dashboard akan 503 sampai secret dipasang.
- Halaman 503 memuat dua perintah `wrangler secret put` dalam bahasa Indonesia, supaya tidak ada lockout yang butuh tebakan.

### T1 - `src/auth.ts`

Helper ditulis tanpa `Context` supaya bisa diuji langsung dari Node:

| Ekspor | Fungsi |
|---|---|
| `signSession(secret, ttlSeconds, now)` | Menghasilkan nilai cookie bertanda tangan |
| `verifySession(value, secret, now)` | Mengembalikan `Session` atau `null` |
| `csrfFor(npc, secret)` | Token CSRF dari nonce sesi |
| `verifyCsrfFromRequest(c, session, secret)` | Field atau header, dibandingkan dengan `safeEqual` |
| `safeEqual(a, b)` | Perbandingan waktu-tetap untuk string |
| `isAuthed(c)` | Wrapper async tipis di atas `verifySession`, membaca cookie `auth_session` |
| `requireAdmin(c)` | Middleware: 401 JSON, atau redirect ke `/` untuk request HTML |
| `safeSlug(raw)` | Tidak berubah |

`AUTH_SESSION` yang diekspor sekarang dihapus, dan semua import lama ikut diperbarui. `isAuthed` berubah dari sync ke async; itu satu-satunya perubahan widespread.

Helper base64url dan HMAC ditulis manual memakai `crypto.subtle`. Alasannya `jose` baru diperkenalkan di `docs/plan-google-cbt.md:653` sebagai satu-satunya dependensi yang boleh ditambahkan, dan itu untuk verifikasi ID token Google. HMAC satu blok bukan klaim yang perlu library, dan menambahkannya sekarang akan mengunci keputusan dependency sebelum ada kebutuhan.

### T2 - `src/index.ts`

| Perubahan | Lokasi sekarang |
|---|---|
| Hapus `FALLBACK_PASSWORD` | `:33-34` |
| Pecah `app.use('/api/*', cors())` (lihat T5) | `:37` |
| Ganti pembacaan cookie mentah dengan `requireAdmin` atau `isAuthed` | `:256`, `:538`, `:1270`, `:1315`, `:1336` |
| `/api/login`: konfigurasi kosong memberi 503 plus halaman instruksi; verifikasi CSRF; `safeEqual` untuk password; pasang `auth_session` dari `signSession` | `:516-530` |
| `/api/logout` tetap `GET`, hapus `auth_session` dan `auth_pre` | `:532-535` |
| Sisipkan `<meta name="csrf-token" content="...">` di dalam `<head>` hanya pada cabang authed | sebelum `:799` |
| Sisipkan `<input type="hidden" name="_csrf" value="...">` di lima form | `:811`, `:865`, `:930`, `:1011`, `:1133` |
| Kunci `?kunci=1` (lihat T6) | `:140-153` |

`src/index.ts:538` (`const isAuth = getCookie(...) !== ...`) menjadi `await isAuthed(c)`. Halaman dashboard dirender dari satu fungsi dengan cabang `${!isAuth ? ... : ...}` (`src/index.ts:836,996`), jadi meta tag CSRF cukup disisipkan satu kali sebelum `</head>` dengan kondisi.

### T3 - Rate limit `/api/login`, fail-closed

Pola di `src/media-routes.ts:188-196` dipakai ulang bentuknya, tetapi `catch` di sana melakukan fail-open (`:197-199`) dan itu tidak boleh diulang di auth.

```text
Key: loginfail:<sha256(ip)>:<minuteBucket>   TTL 120 d, cap 5 percobaan per menit
Key: loginlock:<sha256(ip)>                   TTL 900 d, diset setelah 10 kegagalan
```

- `ip` diambil dari `c.req.header('CF-Connecting-IP')` dengan fallback ke `x-forwarded-for`. Di belakang Cloudflare, `CF-Connecting-IP` selalu terisi.
- `sha256(ip)` memakai `crypto.subtle.digest` supaya IP tidak tersimpan mentah di key KV.
- Rate limit diperiksa **sebelum** membandingkan password, supaya waktu brute force tidak bergantung pada apakah password benar atau salah.
- Kalau `STORAGE.get` atau `STORAGE.put` melempar, login **ditolak** dengan 503. Ini berbeda dari panel generate AI yang sengaja fail-open agar guru tidak terblokir.
- Respons 429 memuat header `Retry-After` dalam detik.

Batasnya harus jujur: KV bersifat eventual-consistency, jadi penghitung ini adalah barrier, bukan jaminan, dan bisa dilewati oleh request yang terlanjur paralel. Pengaman yang benar-benar kuat di level produksi adalah Cloudflare rate-limiting rule di zone, atau Turnstile nanti saat instance publik dibuka. Yang ini cukup untuk menutup brute force biasa pada satu sekolah.

### T4 - CSRF

- Lima form di `src/index.ts` dan lima form di `src/tka-studio.ts` mendapat `<input type="hidden" name="_csrf">`.
- `src/index.ts:1133` membangun form delete dari string JS, jadi token harus masuk ke string itu, bukan ke template HTML. Lokasi yang paling mudah terlewat.
- `src/tka-studio.ts:747` adalah `multipart/form-data`; field `_csrf` tetap bekerja tanpa tambahan.
- Lima dari tujuh call site itu adalah POST di `src/media-routes.ts:702,719,754,854,877`, jadi tokennya harus ikut disisipkan ke inline JS panel gambar. `src/media-routes.ts:819` adalah GET baca dan tidak perlu token.
- `public/vendor/quiz-report.js` tidak memanggil `fetch` ke API, jadi tidak tersentuh.

Alternatif lebih murah: andalkan `SameSite=Lax` untuk jalur `fetch` dan pasang token hanya di sepuluh form HTML. Menghemat tujuh edit, tapi meninggalkan cacat pada browser lama. Disarankan dikerjakan penuh.

### T5 - CORS

Ganti `src/index.ts:37` dengan dua lapisan:

- **Publik** untuk `/api/save/:slug`, `/api/submit/:slug`, dan `/media/:slug/:name`: `origin: '*'` dengan `allowCredentials: false`. Endpoint ini memang tidak memakai cookie.
- **Admin** untuk sisanya (`/api/deploy`, `/api/delete`, `/api/app/update`, `/api/media/*`, `/api/quiz/*`, `/studio/*`): allowlist dari `ALLOWED_ORIGINS` yang dipisah koma, default **tanpa** header `Access-Control-Allow-Origin` sama sekali, `allowCredentials: true`, methods `GET, POST, OPTIONS`, headers `Content-Type` dan `X-CSRF-Token`.

Karena frontend tidak pindah domain, seluruh request admin praktis menjadi same-origin dan CORS tidak lagi jadi permukaan serangan. Header `X-CSRF-Token` **harus** ada di daftar `Allow-Headers`, kalau tidak jalur `fetch` akan gagal saat preflight.

### T6 - Kunci `?kunci=1`

Di `src/index.ts:140-153`, sebelum memanggil `renderPrintSheet`:

- `kunci=1` tanpa sesi memberi 404, bukan 403. 403 mengonfirmasi bahwa kunci jawabannya memang ada.
- `kunci=1` dengan sesi tetap seperti sekarang.
- `?print=1` tanpa `kunci` tetap publik. Mencetak naskah soal bukan kebocoran, dan guru tidak perlu login hanya untuk mencetak.

Effort: 3 baris. Tidak perlu mode assigned untuk menutupnya.

### T7 - Hapus `apiKey` dari `gen-config`

Respons `GET /api/media/:slug/gen-config` (`src/media-routes.ts:256-268`) berubah dari:

```json
{"status":"success","config":{"source":"admin","apiUrl":"...","apiKey":"...","model":"..."}}
```

menjadi:

```json
{"status":"success","config":{"source":"admin","apiUrl":"...","model":"...","hasKey":true}}
```

Tambahkan `Cache-Control: no-store` pada respons ini karena isinya konfigurasi internal.

Semantik server di `src/media-routes.ts:275-297` harus diubah agar "pertahankan" dan "hapus" tidak tertukar:

| Yang dikirim klien | Arti baru | Perilaku server |
|---|---|---|
| `apiUrl` kosong **dan** `apiKey` kosong | Kembali ke konfigurasi admin | Hapus `imggencfg:<slug>`, sama seperti `:279-282` sekarang |
| `apiUrl` terisi, `apiKey` kosong | Perbarui URL dan model, **jaga** kunci yang ada | Baca config lama dan pakai `apiKey` lama bila ada |
| `apiKey` terisi | Ganti kunci | Validasi `https://` dan panjang, lalu simpan |

Tanpa perubahan ini, guru membuka panel, kunci tidak lagi dikirim, form tersimpan kosong, `apiUrl` masih terisi tapi `apiKey` kosong, lalu kunci BYOK-nya hilang diam-diam. `resolveGenConfig` (`src/media-routes.ts:52`) akan jatuh kembali ke konfigurasi admin karena `apiKey` kosong tidak memenuhi syarat. Itu regresi yang hanya muncul saat dipakai, jadi harus diuji.

UI di `src/media-routes.ts:829` diisi ulang dari `cfg.apiKey`. Dengan perubahan ini baris itu diganti jadi placeholder "tersimpan" dan indikator `hasKey`, sehingga guru tahu kuncinya ada tapi tidak bisa membacanya.

Endpoint **tidak** diubah jadi POST-only seperti `docs/plan-google-cbt.md:442`. Setelah `apiKey` dihapus, respons GET tidak lagi secret, jadi tidak ada alasan yang cukup untuk menambah churn pada sisi klien.

### T8 - Test

File baru `tests/auth.test.mjs`. Helper di `src/auth.ts` sengaja dibuat tanpa `Context` supaya tidak butuh harness HTTP.

`tests/quiz.test.mjs` **tidak boleh disentuh**. File itu sedang punya perubahan belum di-commit di worktree, dan `docs/gemini-gem-prompt-full.md` diverifikasi di dalamnya.

Test yang perlu ada:

- Cookie legacy `authenticated_user` ditolak. Ini regression guard yang paling penting dari dokumen ini.
- Token dengan tanda tangan rusak ditolak.
- Token yang ditandatangani dengan `SESSION_SECRET` yang salah ditolak.
- `SESSION_SECRET` berbeda tidak memverifikasi token milik secret lain.
- `exp` yang sudah lewat ditolak, dan `iat` di masa depan ditolak di luar toleransi 60 detik.
- `v` selain 1 ditolak.
- `signSession` lalu `verifySession` berhasil pada TTL normal, dan gagal setelah `exp`.
- `csrfFor` deterministik untuk `npc` yang sama, berbeda untuk `npc` berbeda.
- `verifyCsrf` menerima field `_csrf`, menerima header `X-CSRF-Token`, dan menolak keduanya salah.
- `safeEqual` benar untuk string sama panjang, berbeda isi, panjang berbeda, dan string kosong.

Tidak ada test route HTTP di sini. `app.request()` dengan mock KV/D1 adalah prasyarat `docs/plan-google-cbt.md` Fase 0 dan tidak ikut dikerjakan.

### T9 - Dokumentasi

| Dokumen | Perubahan |
|---|---|
| `AGENTS.md:26` | Baris yang menyebut fallback `admin123` dan "never deploy that fallback" menjadi tidak valid; ganti dengan deskripsi sesi HMAC dan aturan secret baru |
| `docs/panduan-pakai.md:19,64` | Tambah masa berlaku sesi 7 hari dan cara logout. Halaman siswa tetap tanpa login, jadi tidak berubah |
| `src/guide.ts:107,138` | Sama seperti di atas; `guide.ts` menyajikan `/panduan` sehingga harus sinkron dengan markdown-nya |
| `docs/plan-google-cbt.md` bagian 4 dan 12 | Tandai item auth yang sudah selesai sebagai rujukan ke dokumen ini. Karena bagian 19 menyatakan plan itu sumber kebenaran, status yang basi akan menyesatkan |
| `docs/analisis-resource.md:24` | Temuan nomor 2 sudah tidak akurat, karena password sudah dibaca dari env sejak `src/index.ts:538`; tandai resolved beserta `file:line` |
| `docs/analisis-resource.md:25` | Temuan nomor 3 (stored XSS) sudah **terperbaiki**: `escapeHtml()` dipakai di `src/index.ts:490-496` pada `created_at`, `user_id`, `summary`, dan `JSON.stringify(payload)`; tandai resolved |
| `docs/strategi-publish-dan-sosialisasi.md` bagian 8 | Centang item Gerbang P0 yang jadi selesai oleh dokumen ini; sisanya tetap terbuka |
| `docs/peta-migrasi-frontend-backend.html:370-376` | Tambahkan koreksi bahwa `kunci=1` tidak punya auth check. Plan SPA-nya sendiri tetap ditunda |

### T10 - Verifikasi

```text
npm test
npm run typecheck
```

Manual, setelah T1 sampai T7 selesai:

- `npx wrangler dev` untuk mengecek alur login, deploy, delete, rename, panel gambar, TKA Studio, dan kunci jawaban.
- **Peringatan store:** saat dokumen ini ditulis, `STORAGE` memakai `remote: true` di kedua env (`wrangler.jsonc:30-36` dan `:44-62`), sehingga `npx wrangler dev` menulis ke namespace **production**. **Sejak 30 Sep 2026 nilainya `false`**, jadi store lokal tidak lagi menyentuh production. Yang tetap berlaku: smoke test yang menyentuh data auth harus lewat `npx wrangler dev --env staging`, karena production dan staging punya binding terpisah dan hanya staging yang boleh dimutasi saat pengujian.
- Cek manual khusus: cookie `auth_session=authenticated_user` buatan sendiri harus ditolak; `curl "/p/<slug>?print=1&kunci=1"` tanpa cookie harus 404; `GET /api/media/<slug>/gen-config` tidak boleh memuat `apiKey`; `POST /api/deploy` tanpa `_csrf` harus 403.

## 6. Urutan Eksekusi

| Urutan | Task | Dependensi | Estimasi |
|---|---|---|---|
| 1 | T0 env dan `.dev.vars.example` | tidak ada | 0,25 hari |
| 2 | T1 `src/auth.ts` | tidak ada | 0,5 hari |
| 3 | T2 `src/index.ts` | T1 | 0,5 hari |
| 4 | T3 rate limit | T1 | 0,25 hari |
| 5 | T4 CSRF | T1, T2 | 0,5 hari |
| 6 | T5 CORS | tidak ada | 0,25 hari |
| 7 | T6 kunci jawaban | T1 | 0,1 hari |
| 8 | T7 `gen-config` | T1 | 0,25 hari |
| 9 | T8 test | T1 sampai T7 | 0,5 hari |
| 10 | T9 docs | semua | 0,25 hari |
| 11 | T10 verifikasi | semua | 0,25 hari |

T1 bisa dikerjakan tanpa menunggu T0, tapi T0 harus selesai sebelum deploy kode apa pun yang memakai sesi baru.

## 7. Rollout dan Rollback

- Tidak ada migration, jadi tidak ada state di D1 yang perlu dibalik.
- Satu-satunya sumber kebenaran runtime adalah nilai `SESSION_SECRET`. Rotasi secret tersebut **secara otomatis membatalkan semua sesi lama**, karena token lama tidak lagi memverifikasi.
- Deploy versi lama setelah T2 selesai akan mengembalikan sistem ke cookie statis, dan password fallback akan muncul lagi kecuali `APP_PASSWORD` sudah diset. Karena itu urutan T0 wajib didahulukan.
- Kalau dashboard terkunci karena `SESSION_SECRET` belum diset, tidak ada yang perlu di-rollback: pasang secret-nya. Halaman 503 sudah memuat perintahnya.

## 8. Acceptance Criteria

> **Status 30 Sep 2026: SEMUA TERPENUHI.** Bukti: `tests/auth.test.mjs` (55
> test, dirangkai ke `npm test`), `npm run typecheck` bersih, dan smoke test
> staging 31 cek. Daftar ini dipertahankan sebagai definisi "selesai", bukan
> sebagai pekerjaan tersisa.

- Cookie `auth_session=authenticated_user` buatan sendiri tidak memberi akses ke route mana pun.
- Mengganti satu byte pada cookie membuat sesi tidak valid.
- Memalsukan `exp` atau `iat` tidak memperpanjang sesi.
- `SESSION_SECRET` yang salah membuat seluruh sesi tidak valid.
- `admin123` tidak pernah diterima, dan tidak ada lagi konstanta fallback di kode.
- `/api/login` menolak setelah 5 percobaan per menit dan mengunci 15 menit setelah 10 kegagalan; saat KV gagal, login ditolak.
- `/p/<slug>?print=1&kunci=1` tanpa sesi menjawab 404, sedangkan `?print=1` tanpa `kunci` tetap publik.
- `GET /api/media/<slug>/gen-config` tidak pernah memuat `apiKey`, dan menyimpan panel gambar tanpa mengetik ulang kunci tidak menghapus kunci yang tersimpan.
- Sepuluh form HTML dan tujuh call site `fetch` menolak POST tanpa `_csrf` atau `X-CSRF-Token` yang benar.
- `/api/*` admin tidak lagi mengirim `Access-Control-Allow-Origin: *`.
- `npm test` dan `npm run typecheck` lulus, dan `tests/auth.test.mjs` benar-benar dieksekusi.

## 9. Dampak ke Dokumen Plan Lain

- **`docs/plan-google-cbt.md`** - Fase 0 mengecil. Setelah dokumen ini, Fase 0 tinggal Google OAuth, tabel `users` dan `auth_sessions`, role, `migrations/`, dan harness tes. Item 1, 2, 3, 5, 6, dan 9 pada bagian 12 Hardening Wajib sudah tertutup. Butuh penyuntingan karena bagian 19 menyatakan plan itu sumber kebenaran.
- **`docs/analisis-resource.md`** - Tahap 0 selesai seluruhnya, kecuali rate limit `/api/save/:slug` yang masih belum dikerjakan. Temuan nomor 2 dan 3 di tabel ringkasan harus ditandai resolved supaya tidak menyesatkan.
- **`docs/strategi-publish-dan-sosialisasi.md`** - Gerbang P0 berkurang sisa: rate limit endpoint public, batas ukuran payload, dan pengujian route, KV, serta D1 masih terbuka.
- **`docs/peta-migrasi-frontend-backend.html`** - tidak disentuh selain koreksi klaim. Rencana pemecahannya tetap ditunda. Kalau suatu saat dihidupkan, catatan soal kunci jawaban di `:370-376` sudah tidak berlaku karena T6.
- **`docs/plan/panel-konteks-soal-di-slot-gambar.md`** - tidak bersinggungan. Plan itu hanya menyentuh bagian markup dan inline JS di `src/media-routes.ts`, dan statusnya masih DITUNDA.

## 10. Catatan Dokumen

> **Banner historis (30 Sep 2026):** dokumen ini **selesai** dan tidak lagi
> menjadi daftar kerja. Seluruh sitasi `src/index.ts:NNN` di §2 dan §5–§7
> adalah alamat SEBELUM refactor `docs/plan-split-index.md` (28 Sep 2026).
> Saat itu `src/index.ts` masih ±2.000 baris; sekarang ia 116 baris wiring, dan
> kode yang dirujuk pindah ke `src/auth-routes.ts`, `src/dashboard.ts`,
> `src/actions.ts`, `src/records.ts`, dan `src/public-app.ts`. **Jangan grep
> nomor baris lama — pakai nama fungsi** (`saveRecordHandler`, `signSession`,
> `renderPrintSheet`, dst.). Kutipan §2 yang menggambarkan cookie statis
> `authenticated_user`, `FALLBACK_PASSWORD = 'admin123'`, `cors()` global, dan
> `?kunci=1` tanpa auth juga sudah tidak berlaku; itu semua sudah diperbaiki
> oleh dokumen ini sendiri.

- Semua sitasi `file:line` di dokumen ini diverifikasi terhadap kode pada 27 September 2026. Kalau `src/index.ts` atau `src/media-routes.ts` berubah banyak sebelum dikerjakan, sitasi baris harus dihitung ulang.
- `docs/plan-hardening-auth.html` sengaja tidak dibuat. Selain `docs/plan-google-cbt.html` yang ditulis tangan, tidak ada pola generate HTML di repo ini, dan `docs/plan-google-cbt.md:663` mewajibkan pola tiap dokumen diperiksa sendiri. Markdown ini cukup.
- Dokumen ini tidak punya regression test. Yang diverifikasi test hanya helper sesi di `src/auth.ts`; integrasi route diverifikasi manual pada T10.
