# Rencana Fitur:Ingat Hasil Pengerjaan (snapshot lokal)

Status: **rencana, belum diimplementasikan.** Disepakati user sebagai pekerjaan terpisah setelah commit `2da7238` (badge hasil kuis data-driven) dideploy ke staging.

Dokumen ini adalah sumber kebenaran untuk fitur ini. `docs/plan-google-cbt.md` tetap sumber kebenaran untuk Google Login dan CBT terdaftar; keduanya Related tapi sengaja tidak digabung, alasannya di §3.

## 1. Ringkasan Keputusan

- Setelah siswa mengirim jawaban, hasil akhir disimpan **di perangkat siswa sendiri** (localStorage).
- Saat siswa membuka lagi `/p/:slug`, halaman menampilkan hasil yang tersimpan beserta tombol **Kerjakan Lagi**, bukan langsung meminta identitas.
- Ini **bukan** penguncian. Siswa tetap boleh mengerjakan ulang dan masih bisa menghapus localStorage. Fitur ini adalah kenyamanan, bukan plagiarism.
- Sakelar per aplikasi: `remember_result` (alias `ingat_hasil`), **default nyala**.
- Tidak ada endpoint baru, tidak ada kolom D1 baru, tidak ada perubahan schema.sql.
- Kunci total per akun Google ditunda ke `docs/plan-google-cbt.md` (lihat §3 dan `show_result` di sana).

## 2. Tujuan

- Siswa yang menutup tab tidak perlu mengingat nilainya; hasilnya ada di tempat yang sama dengan kuisnya.
- Guru tidak perlu mengubah kuis lama agar hasilnya "mengenal" — cukup buka URL yang sama.
- Menghapus kecemasan "saya sudah lupa nilai saya kemarin" tanpa menambah beban infra.

## 3. Batas Kerja

### Termasuk

- Dua kunci localStorage per slug: penanda selesai dan snapshot hasil.
- Pen_authority baca snapshot saat halaman dimuat, dengan sidik jari konten supaya snapshot usang dibuang.
- Tombol **Kerjakan Lagi** yang membersihkan state dengan benar.
- Sakelar di pengaturan aplikasi, mengikuti pola `show_item_feedback` yang sudah ada.
- Label "hasil sementara" untuk kuis esai.
- Pengaman privasi: mematikan sakelar ikut menghapus snapshot.

### Tidak termasuk

- **Tidak** ada lock total, kuota attempt, atau daftar putih perangkat.
- **Tidak** ada perbandingan nilai terhadap D1. Laporan dan rekap guru tetap membaca `app_records` seperti sekarang; snapshot tidak pernah masuk hitungan apa pun.
- **Tidak** ada perubahan pada `schema.sql`, `quiz_attempts`, atau alur auth.
- **Tidak** ada sinkronisasi antar perangkat. Snapshot hidup di satu browser, tidak travels.

Alasan tidak digabung ke `docs/plan-google-cbt.md`: fitur ini tidak butuh Google sama sekali — ini murni client-side dan bisa bekerja di kuis lama yang public. Plan CBT sudah punya konsep `show_result` sendiri (§6 dan §18 di sana) yang sifatnya **server-side**: `show_result = false` membuat endpoint mengembalikan 403. Keduanya berbeda risikonya, jadi harus terpisah: yang satu soal kenyamanan lokal, yang satu tentang hak siswa melihat nilai yang dihitung server. Kalau digabung, satu perubahan kecil di sini akan ikut mewarisi migration dan credential.

## 4. Kondisi Saat Ini

Semua fakta di bawah diverifikasi terhadap `staging` pada commit `2da7238`.

- Halaman kuis dirender server ke HTML lengkap dan disimpan di KV pada `html:<slug>`. Setelah itu halaman **tidak pernah berubah** sampai guru menyimpan ulang. Lihat `src/quiz-page.ts:478` (template klien) dan `wrangler.jsonc` untuk binding.
- Draft jawaban disimpan di `ATTEMPT_KEY = 'quiz-attempt:' + CFG.slug` (`src/quiz-page.ts:483`), ditulis tiap kali input berubah (`src/quiz-page.ts:769`).
- Draft dihapus tepat setelah submit sukses (`src/quiz-page.ts:1061`). Ini disengaja supaya banner "lanjutkan jawaban" tidak muncul untuk attempt yang sudah terkirim — catatannya sudah merujuk dokumen ini.
- Gate awal dibaca dari `GATE_KEY` (`src/quiz-page.ts:864`) dan `NAME_KEY` (`src/quiz-page.ts:481`). Kalau salah satu ada, gate ditutup dan timer langsung jalan (`src/quiz-page.ts:931`).
- Deadline timer disimpan di `TIMER_KEY = 'quiz-deadline:' + CFG.slug` (`src/quiz-page.ts:964`) dan hanya dihapus saat waktu habis (`src/quiz-page.ts:975`).
- Tombol **Kerjakan Lagi** sekarang hanya melakukan reload (`src/quiz-page.ts:1196-1198`). Itu cukup hari ini karena tidak ada state "sudah selesai".
- Kuis esai sudah punya jalur "Menunggu koreksi esai" di layar hasil (`src/quiz-page.ts:1102`).
- Pola sakelar yang harus diikuti: `QuizSpec.showItemFeedback` (`src/quiz-types.ts:180`), parse alias (`src/quiz-parse.ts:998`), checkbox di editor (`src/quiz-editor.ts:279-285`), dan sinkronisasi state browser (`public/vendor/quiz-editor.js:862-902`).

## 5. Model Data Lokal

Dua kunci baru, keduanya memakai awalan yang sudah dipakai halaman:

| Kunci | Isi | Kapan ditulis |
| --- | --- | --- |
| `quiz-done:<slug>` | `"1"` | Setelah submit sukses, hanya kalau sakelar nyala |
| `quiz-done-result:<slug>` | objek snapshot | Bersamaan dengan penanda selesai |

Bentuk snapshot:

```
{
  "v": 1,
  "at": 1750000000000,
  "name": "Budi",
  "student_class": "8A",
  "fp": "7f3a9c",
  "score": 85,
  "grading": { ... objek grading apa adanya ... }
}
```

Ketentuan:

- `fp` adalah sidik jari konten kuis, bukan sidik jari jawaban siswa. Gunanya: kalau guru mengubah soal atau KKM lalu menyimpan ulang, snapshot lama **dibuang**, bukan menampilkan skor usang. Hitung server-side saat render dan masukkan ke CFG (lihat §7 untuk kenapa ini aman dipfreeze bersama HTML).
- `v` dipakai untuk migrasi bentuk snapshot. Bentuk yang tidak dikenal diperlakukan sebagai tidak ada.
- `grading` disimpan utuh, bukan field yang dipilih, supaya renderer `showResult()` (`src/quiz-page.ts:1078`) bisa dipakai ulang tanpa cabang baru.
- Ukuran dibatasi: kalau hasil serialisasi melebihi 64 KB, **jangan** disimpan. Ganti jadi penanda selesai tanpa snapshot, supaya kita tidak memulae localStorage.
- Snapshot tidak pernah dibaca endpoint mana pun. Nilainya benar-benar data tampilan.

## 6. Perilaku yang Diharapkan

### Setelah submit sukses

1. Server sudah mengembalikan `result_json` dan `showResult()` sudah merender layar hasil.
2. Sebelum atau sesudah render, klien menulis `quiz-done-result` lalu `quiz-done`.
3. Kalau ada esai menunggu koreksi (`essay_pending > 0`), teks yang disimpan dan yang ditampilkan sama-sama menyatakan ini hasil sementara.

### Saat halaman dibuka lagi

1. Baca `quiz-done`. Kalau tidak ada,.flow sekarang: resume box → gate → timer, persis seperti hari ini.
2. Kalau ada, baca `quiz-done-result`. Kalau hilang, bentuk salah, versinya beda, atau `fp` tidak cocok dengan CFG sekarang → perlakukan sebagai tidak ada **dan** bersihkan kedua kunci.
3. Kalau cocok dan sakelar tidak dimatikan → langsung `showResult(snapshot.grading, nama)`. Gate tidak dirender, timer tidak jalan, tombol Kirim tidak dirender.

Penting: langkah 3 tidak menyentuh `NAME_KEY`/`GATE_KEY`. Menghapus identitas bukan bagian dari fitur ini, dan ikut menghapusnya akan mengubah perilaku "lanjutkan" untuk device yang belum selesai.

### Tombol Kerjakan Lagi

Hari ini tombol itu cuma reload (`src/quiz-page.ts:1198`). Setelah fitur ini aktif, reload polos **akan membuat halaman menampilkan hasil yang sama lagi**, jadi siswa tidak pernah bisa mulai ulang. Perbaikannya: sebelum reload, hapus `quiz-done` dan `quiz-done-result`, lalu **juga** hapus `TIMER_KEY`.

- Menghapus `TIMER_KEY` itu wajib, bukan kosmetik. Kalau siswa submit sebelum waktu habis, deadline lama masih ada di localStorage, dan `startTimerNow()` (`src/quiz-page.ts:872`) akanmemakai ulang sisa waktu lama. Durasi baru harus benar-benar baru.
- Menghapus `GATE_KEY` **tidak** wajib dan belum diputuskan; lihat §12.

## 7. Jebakan CFG Beku — Pelajaran dari 2da7238

Feature ini butuh sakelar sampai ke klien, jadi `CFG.rememberResult` **perlu** ada di CFG. Berbeda dengan `showItemFeedback`, dan perbedaannya penting:

| | `showItemFeedback` (sudah ada) | `rememberResult` (rencana) |
| --- | --- | --- |
| Yang memutuskan | server, dari spec yang dibaca ulang tiap request | klien, dari state lokal |
| Data beku di HTML | bisa berbeda dari server → badge tidak tampil | selalu ditulis bareng skripnya sendiri |
| Arah kegagalan | data terkirim tapi tak terlihat (kebocoran lewat DevTools) | snapshot tidak terbaca (kegagalan tertutup, aman) |

Jadi penjaga di sisi klien cukup `CFG.rememberResult !== false`, persis seperti `showExplanation`. **Jangan** memakai `=== true` dan **jangan** menjadikan CFG sebagai satu-satunya sumber kebenaran untuk data yang sudah ada di tangan klien. Aturan yang sudah ditulis di `src/quiz-page.ts:283-289` ("Jangan menambahkan flag sakelar ke CFG untuk keputusan render") berlaku untuk badge hasil; pengecualian eksplisit untuk `rememberResult` adalah bahwa kuncinya lokal dan opsional. Kalau diimplementasikan, tambahkan alasannya di komentar itu sendiri, kalau tidak, catatan tersebut akan menyesatkan.

`fp` aman dipfreeze bersama HTML karena keduanya berubah pada saat yang sama: guru menyimpan ulang = HTML baru = sidik jari baru. Kalau guru mengubah soal tanpa menyimpan ulang, halaman lama juga masih menampilkan soal lama, jadi tidak ada ketidakkonsistenan baru.

## 8. Integrasi Pengaturan Aplikasi

Ikuti `show_item_feedback` persis, supaya tidak ada pola kedua di repo:

- `src/quiz-types.ts`: `rememberResult: boolean` di `QuizSpec`.
- `src/quiz-parse.ts`: `resolveBoolean(pick(obj, ['remember_result', 'ingat_hasil'])) !== false`.
- `src/quiz-parse.ts` round-trip: hanya tulis `remember_result: false` saat dimatikan, agar app yang tidak punya key berarti nyala.
- `src/quiz-editor.ts`: checkbox baru di blok yang sama dengan `qe-item-feedback` (`src/quiz-editor.ts:279-285`), berlabel "Ingat hasil pengerjaan di perangkat ini (default)".
- `public/vendor/quiz-editor.js`: `checked = state.remember_result !== false`; saat dicentang hapus key, saat tidak centang set `false` (`public/vendor/quiz-editor.js:901-902`).
- Tambahkan regression test untuk alias `ingat_hasil: false` di `tests/quiz.test.mjs`, seperti yang sudah ada untuk `tampilkan_status_jawab`.

Teks peringatan di editor harus jujur, karena ini fitur yang Student biasa salah baca sebagai "saya terkunci":

> Hasil pengerjaan disimpan di browser perangkat ini saja, bukan di akun. Menghapus data browser atau memakai perangkat lain akan menghapus atau menyembunyikan hasil ini. Fitur ini tidak mencegah pengerjaan ulang.

## 9. Privasi

Ini bagian yang paling mudah dilupakan, jadi wajib ada di UI, bukan cuma di dokumen.

- Snapshot berisi **nama** dan nilai. Di komputer sekolah yang dipakai bergantian, siswa berikutnya membuka `/p/:slug` dan langsung melihat nama serta nilai temannya. Ini kebocoran data pribadi nyata.
- `NAME_KEY` dan `CLASS_KEY` (`src/quiz-page.ts:481-482`) sudah mengalami risiko serupa dan sudah punya jalur "Mulai baru" untuk membersihkannya (`src/quiz-page.ts:843-845`). Perilaku itu tidak boleh rusak.
- Tambahan: `remember_result = false` harus **menghapus** snapshot yang sudah ada, bukan hanya berhenti menulis yang baru. Kalau tidak, mematikan sakelar justru jadi jebakan: guru mematikan demi privasi, tapi data lama tetap terbaca. Penghapusan terjadi di sisi browser pada halaman yang memuat kuis itu; guru tidak bisa menghapusnya dari server.
- Untuk device bersama, label di layar hasil sebaiknya menyebut device ini, misalnya "disimpan di perangkat ini".

## 10. Risiko dan Batas

| Risiko | Mitigasi |
| --- | --- |
| Siswa menghapus localStorage, jadi fitur ini nol efek sebagai kontrol | Disebut eksplisit bukan kontrol; kontrol sungguhan ada di plan CBT |
| Snapshot menua setelah guru menyelesaikan koreksi esai | Label "hasil sementara" + kolom `at`; laporan guru tetap otoritatif dari D1 |
| Snapshot menua setelah guru edit kuis | `fp` mismatch → snapshot dibuang |
| Nama siswa tersimpan di device bersama | Sakelar bisa dimatikan guru; penghapusan ikut terjadi; label device |
| localStorage penuh / dinonaktifkan | Semua akses dibungkus try/catch, mengikuti `store()`/`load()` (`src/quiz-page.ts:546-551`); kegagalan diam-diam berarti fitur mati, bukan kuis rusak |
| Kode lama membaca kunci baru atau sebaliknya | Prefix `quiz-done:` tidak dipakai kode lain; tidak ada perubahan pada kunci lama |

## 11. Pengujian

`tests/quiz.test.mjs` dan `tests/quiz-page-source.test.mjs` tidak punya DOM, jadi:

- **Snapshot lifecycle** — helper murni (baca/simpan/buang snapshot) sebaiknya ditulis sebagai fungsi kecil yang menerima storage, lalu diuji langsung: tulis, baca, `fp` mismatch dibuang, bentuk rusak dibuang, versi lain dibuang.
- **Source guard** — `tests/quiz-page-source.test.mjs` harus memaksa `Kerjakan Lagi` menghapus kunci `quiz-done` **dan** `TIMER_KEY`, supaya regresi reload-tanpa-pembersihan ketahuan tanpa perlu browser. Ini pengaman paling penting di daftar ini.
- **Sakelar** — alias `ingat_hasil: false` mematikan; key hilang menyalakan; round-trip tidak menulis key saat nyala.
- **Integrasi** — cek manual di `npx wrangler dev --env staging`: submit, reload, hasil muncul; klik Kerjakan Lagi, gerbang/timer kembali benar; matikan sakelar di editor, simpan, buka lagi, snapshot hilang.
- **Tidak ada** verifikasi lewat `wrangler dev` untuk data yang menyentuh KV production — `STORAGE` memakai `remote: true` (`docs/plan-google-cbt.md` §17). Smoke test yang mengubah data harus lewat deploy staging.

## 12. Yang Belum Diputuskan

- Apakah **Kerjakan Lagi** juga menghapus `GATE_KEY`. Kalau dihapus, gerbang instruksi muncul lagi dan nama ditanyakan ulang — lebih bersih untuk device bersama, tapi berlawanan dengan "siswa yang sudah tahu aturan tidak perlu diulang". Rekomendasi: **hapus**, karena device bersama lebih nyata masalahnya daripada pengulangan singkat.
- Apakah tombol kedua "Mulai dari awal" perlu ada untuk device bersama, atau cukup andalkan "Mulai baru" yang sudah ada di banner resume.
- Batas 64 KB di §5 perlu diukur terhadap kuis esai terpanjang yang ada, bukan ditebak.
- Apakah snapshot perlu tombol hapus manual ("Hapus hasil tersimpan") selain sakelar global.

## 13. Acceptance Criteria

- [ ] Submit sukses → `quiz-done` dan `quiz-done-result` tertulis, hanya saat sakelar nyala.
- [ ] Buka ulang `/p/:slug` → hasil tampil langsung, tanpa gate dan tanpa timer.
- [ ] **Kerjakan Lagi** → kunci selesai dan `TIMER_KEY` terhapus, gerbang/timer berikutnya benar.
- [ ] Kuis esai → hasil ditandai sementara di layar maupun di snapshot.
- [ ] Guru mengubah soal lalu menyimpan → `fp` berubah, snapshot lama dibuang.
- [ ] Guru mematikan sakelar → halaman yang memuat kuis itu menghapus snapshot lama.
- [ ] Alias `ingat_hasil: false` mematikan; key hilang menyalakan; round-trip tidak menambah key.
- [ ] localStorage nonaktif/penuh → kuis tetap berfungsi normal, fitur diam-diam mati.
- [ ] `npm test` dan `npm run typecheck` lulus.

## 14. Keputusan Tetap

- Snapshot hanya di localStorage. Tidak ada kolom D1, tidak ada endpoint.
- Default nyala.
- Fitur ini bukan penguncian dan tidak akan pernah diklaim sebagai penguncian di UI.
- Laporan guru dan rekap tetap bersumber dari `app_records`/`quiz_attempts`; snapshot tidak pernah dibaca server.
- Penguncian asli ditunda ke `docs/plan-google-cbt.md`, bukan diimplementasikan di sini.
- `tests/plan-google-cbt.md` punya pasangan `.html` yang harus disinkronkan manual; dokumen ini **tidak** punya pasangan `.html`, jadi tidak ada yang harus disinkronkan. `plan-hardening-auth.md` juga `.md` saja, jadi pola ini sudah lazim.
