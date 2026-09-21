# Panduan Penggunaan: Membuat Kuis Sekolah dengan Gemini

Aplikasi ini mengubah **teks** (kisi-kisi, materi, atau daftar soal) menjadi **aplikasi kuis online** yang bisa dibagikan ke siswa lewat tautan. Pekerjaan menulis soal dilakukan oleh **Gem Gemini** di `gemini.google.com`, dan aplikasi ini yang mengubahnya jadi kuis siap pakai, menyimpan jawaban, menilai otomatis, serta menyediakan panel gambar dan editor soal untuk guru.

## Alur kerja singkat

```
1. Gem Gemini  →  menuliskan kisi-kisi jadi JSON soal
2. Dashboard   →  tempel JSON → Publikasikan → kuis jadi (/p/...)
3. Panel Gambar→  generate gambar dengan Gemini / unggah foto
4. Tombol Edit →  perbaiki soal langsung di aplikasi, tanpa Gemini
5. Log Data    →  lihat nilai, analisis butir soal, koreksi esai
```

## Daftar alamat halaman

| Halaman | Alamat | Untuk siapa |
| --- | --- | --- |
| Dashboard | `/` | Guru (login dengan kata sandi) |
| Halaman kuis siswa | `/p/<slug>` | Siswa (tanpa login) |
| Panel gambar soal | `/p/<slug>/media` | Guru |
| Editor soal | `/p/<slug>/edit` | Guru |
| Log data & analisis | `/p/<slug>/data` | Guru |
| Koreksi esai | `/p/<slug>/essay` | Guru |

`<slug>` adalah judul aplikasi yang diketik di dashboard (huruf kecil, spasi jadi tanda hubung), misal `kuis-ipa-fotosintesis`.

---

## Langkah 1: Buat soal dengan Gem Gemini

1. Buka Gem pembuat soal:
   <https://gemini.google.com/gem/117WrAMmQHsva0tw7qixx1Xo-9HCP7eV0?usp=sharing>
   (Gem ini sudah diprogram untuk menulis soal dalam format JSON yang dikenali aplikasi.)
2. Ketik **permintaan** secukupnya. Contoh:

   > Buatkan asesmen TKA Akidah Akhlak kelas 1: 15 pilihan ganda (A–E), 4 benar/salah,
   > dan 3 isian singkat. Sertakan 2 soal bergambar tentang anggota tubuh. Skor maksimal 100.

   Makin rinci permintaan, makin tepat hasilnya: sebutkan jumlah soal, tipe, tema, kelas, proporsi, dan bagian mana yang butuh gambar.
3. Gem menjawab dalam **dua bagian**:
   - **Ringkasan Asesmen** — jumlah & jenis soal, alokasi waktu, pemetaan ranah kognitif, dan daftar **DAFTAR GAMBAR YANG PERLU DIUNGGAH**.
   - **Satu blok JSON** (diapit ` ```json `) — inilah yang akan ditempel ke dashboard.
4. Gem **tidak bisa membuat file gambar**. Untuk soal bergambar, Gem hanya menulis **nama slot**, contoh:
   ```json
   "image": "media:tumbuhan"
   ```
   atau di tengah teks soal:
   ```
   Perhatikan gambar berikut!

   ![Tanaman hijau di pot](media:tumbuhan)
   ```
   Fotonya nanti diisi guru di **panel Gambar** (Langkah 3). Nama slot muncul di halaman `/p/<slug>/media` otomatis beserta status "sudah ada" / "belum diunggah".

> Butuh sistem prompt lengkap untuk Gem (11 tipe soal, aturan gambar, kontrak API)?
> Lihat [`docs/gemini-gem-prompt-full.md`](gemini-gem-prompt-full.md) — bisa ditempel ke kolom
> **Instructions** Gem. Penjelasan singkatnya ada di [`docs/gemini-gem-prompt.md`](gemini-gem-prompt.md).

---

## Langkah 2: Publikasikan ke dashboard

1. Buka dashboard aplikasi (`/`) dan login dengan kata sandi guru.
2. Pilih mode **JSON Soal** (disarankan). Mode ini membuatkan seluruh aplikasi kuis otomatis: identitas siswa, penilaian di server, rekap nilai, analisis butir soal, editor soal, dan koreksi esai.
3. **Salin seluruh blok JSON** dari Gem (mulai `{` sampai `}`) lalu tempel ke kolom **Isi (kode atau JSON soal)**.
4. Isi **Judul Aplikasi** (jadi alamat `/p/...`). Boleh dikosongkan kalau JSON sudah punya `title`.
5. Klik **Publikasikan ke URL**.

Aplikasi langsung muncul di **Daftar Aplikasi Aktif** dengan kartu berisi tombol: **Edit**, **Gambar**, **Log Data**, *Buka*, dan *Hapus*. Siswa bisa mulai mengerjakan di `/p/<slug>` sekarang juga.

---

## Langkah 3: Isi / generate gambar soal

Kalau soalmu bergambar (ada token `media:...`), buka panel gambar lewat tombol **Gambar** pada kartu aplikasi atau langsung buka `/p/<slug>/media`.

Panel menampilkan **satu kartu per slot** yang diminta soal, bertanda **Sudah ada** atau **Belum diunggah**. Siswa yang membuka kuis saat slot masih kosong hanya melihat kotak "Gambar belum diunggah" — kuis tetap bisa dikerjakan.

Ada **tiga cara** mengisi gambar tiap slot:

### 3a. Generate dengan AI langsung dari panel (paling cepat)
Jika aplikasi sudah dikonfigurasi API gambar (bawaan admin atau **Pakai API gambar sendiri / BYOK**), klik tombol **AI** pada kartu slot:

1. Klik **AI** → muncul kotak prompt yang **sudah terisi otomatis dari konteks soal** (boleh diedit).
2. Pilih model di bagian atas panel kalau ingin (cepat/hemat vs. detail).
3. Klik **Buat Gambar** → tunggu 10–30 detik → hasil langsung tersimpan ke slot itu, tanpa harus unggah manual.
4. Batas pemakaian 6 gambar per menit per aplikasi.

### 3b. Generate dengan Gemini (akun Gemini milikmu) — kualitas terbaik
Kalau kamu punya akun Gemini sendiri dan ingin gambar yang lebih bagus (terutama untuk diagram berlabel):

1. Di kartu slot, klik **Buka di Gemini** (langsung membuka `gemini.google.com` dengan prompt terkirim otomatis) atau **Salin prompt Gemini** lalu tempel di Gemini.
2. Gemini membuat gambar sesuai konteks soal.
3. **Unduh** gambar hasil Gemini, lalu unggah lewat tombol **Pilih / Potret Foto** pada kartu slot yang sama.

### 3c. Foto sendiri
1. Klik **Pilih / Potret Foto** pada kartu slot. Di HP, browser menawarkan kamera atau galeri.
2. Foto otomatis **diperkecil (maks 1600 px)** dan dikonversi ke **WebP** di perangkatmu sebelum dikirim — kuota hemat, halaman kuis ringan. GIF dibiarkan apa adanya.
3. Batas 8 MB per gambar. Format yang diterima: JPG, PNG, GIF, WebP, AVIF, BMP. **SVG tidak diterima.**

> **Ganti gambar tidak perlu publish ulang.** Unggah ulang dengan **nama slot yang sama** →
> URL-nya tidak berubah → siswa langsung melihat versi baru (kalau belum kelihatan, muat ulang dengan Ctrl+Shift+R).

---

## Langkah 4: Edit soal langsung di aplikasi

Tidak perlu bolak-balik ke Gem untuk perbaikan kecil. Klik **Edit** pada kartu aplikasi (hanya tersedia untuk mode **JSON Soal**) → halaman `/p/<slug>/edit`.

Yang bisa dilakukan di editor:

- ubah teks soal, pilihan, kunci jawaban, dan bobot nilai;
- tambah / hapus / duplikat / geser urutan soal;
- **ganti tipe soal** — tiap tipe punya editor khusus, jadi tidak perlu menghafal struktur JSON:
  - `category` — daftar pernyataan + radio Benar/Salah
  - `matching` — pasangan kiri → kanan (kolom kanan diacak otomatis)
  - `ordering` — daftar langkah dalam urutan benar
  - `table_fill` — judul kolom + tabel; sel rumpang ditulis `{327}` atau `{1085 / 1.085}`
  - `two_tier` — pernyataan + alasan, masing-masing satu kunci
  - `highlight` — bacaan dengan kata diapit `{ }`, lalu daftar kata yang benar
- isi / ganti nama slot gambar.

Saat disimpan, JSON divalidasi ulang dan halaman kuis langsung digambar ulang — siswa melihat versi baru di **alamat yang sama**, dan jawaban yang sudah masuk tidak berubah.

> Editor hanya untuk aplikasi mode **JSON Soal**. Untuk mode HTML/React, perbaikan tetap lewat Gemini lalu deploy ulang.

---

## Langkah 5: Pantau hasil

### Log Data — `/p/<slug>/data`
- **Rekap nilai per siswa** (nama, skor, waktu) dan buka detail payload tiap kiriman.
- **Analisis butir soal** otomatis: tingkat kesukaran, daya beda (D), sebaran pengecoh, bagian tersering keliru, dan catatan otomatis (termasuk tanda merah bila daya beda negatif — biasanya kunci jawabannya salah). Butuh minimal 8 peserta untuk daya beda.
- Tombol **Unduh CSV** untuk laporan di Excel/Google Sheets.

### Koreksi Esai — `/p/<slug>/essay`
- Tampil pengingat oranye kalau ada esai belum dinilai.
- Tiap kiriman siswa tampil lengkap (soal + jawaban asli) dengan kolom nilai 0 sampai poin maksimal; **Nilai penuh** atau tekan Enter untuk menyimpan cepat.
- **Nilai objektif** dihitung otomatis saat siswa mengirim; **Nilai akhir** baru muncul setelah semua esai di kiriman itu selesai dinilai.

---

## Tips & FAQ

- **Halaman siswa tidak butuh login** — cukup bagikan tautan `/p/<slug>`.
- **Konten aplikasi** dihitung & disimpan di server, jadi skor tidak bisa dipalsukan dari browser.
- **Siswa sempat offline/refresh?** Jawaban tersimpan otomatis di perangkat; saat dibuka lagi muncul tawaran **Lanjutkan / Mulai baru**.
- **Mau ganti foto?** Cukup unggah ulang dengan nama slot sama di panel Gambar.
- **Soal menyimpang (jumlah/tipe/kunci)?** Klik **Edit** — tidak perlu meminta Gem menulis ulang.