# Foto pada soal: cara kerja & blok tambahan untuk Gem

> **Mau system prompt yang lengkap?** Pakai
> [`docs/gemini-gem-prompt-full.md`](gemini-gem-prompt-full.md) — satu berkas utuh
> yang menjelaskan semua 11 tipe soal, stimulus, aturan gambar, dan kontrak API,
> siap ditempel ke kolom **Instructions** Gem.
>
> Berkas ini adalah catatan pendamping: penjelasan **kenapa** desainnya begitu,
> plus blok-blok tambahan kalau instructions Gem kamu sudah terlanjur panjang.
> Isi blok di bawah tetap benar dan tidak bentrok dengan berkas lengkap itu.

## Kenapa harus begini

Gem/Gemini hanya menghasilkan **teks**. Ia tidak bisa menempelkan file gambar ke
dalam kode yang dibuatnya, dan menulis gambar sebagai data URI base64 membuat
JSON soal jadi sangat panjang, berat, dan gampang terpotong. Jadi gambar tidak
pernah "dibuat" Gemini — Gemini hanya menuliskan **nama slot**, lalu gurunya yang
mengunggah fotonya.

```
Gem menulis  : "image": "media:tumbuhan"
Guru unggah  : /p/kuis-ipa/media  ->  foto dari HP
Siswa melihat: /media/kuis-ipa/tumbuhan
```

Keuntungannya: mengganti foto cukup mengunggah ulang dengan nama slot yang sama —
URL-nya tidak berubah, jadi **tidak perlu publish ulang** kuisnya.

Mode aplikasi yang didukung:

| Mode | Cara menulis gambar |
| --- | --- |
| **JSON Soal** (satu-satunya) | `"image": "media:nama-slot"` atau `![keterangan](media:nama-slot)` di dalam teks soal |

---

## Blok tambahan untuk instructions Gem (tempel ini)

> Tambahkan blok berikut ke bagian **SPESIFIKASI TEKNIS** pada instructions Gem
> kamu, di bawah poin "Form Identitas Awal".

```text
GAMBAR / FOTO PADA SOAL (WAJIB DIBACA)
Kamu tidak bisa membuat atau menempelkan file gambar. Jangan pernah menulis
gambar sebagai base64 atau data URI. Sebagai gantinya, tulis NAMA SLOT, dan guru
akan mengunggah fotonya lewat panel "Gambar" di dashboard.

Bila pengguna memberi kisi-kisi yang butuh gambar (misal: "perhatikan gambar
tumbuhan"), jangan mengarang URL. Pakai nama slot deskriptif dalam huruf kecil
tanpa spasi, contoh: tumbuhan, peta-jawa, grafik-suhu, denah-sekolah.

Aturan penulisan:
1. Jika soal ditulis dalam format JSON Soal, gunakan field khusus:
   { "type": "choice", "question": "Perhatikan gambar berikut!",
     "image": "media:tumbuhan", "options": ["Fotosintesis", "Respirasi"],
     "answer": "Fotosintesis" }
   Field "image" juga bisa dipakai bentuk objek bila perlu keterangan:
   { "image": { "media": "tumbuhan", "alt": "Tanaman hijau di pot" } }
2. Teks soal juga boleh memuat gambar di tengah-tengah dengan markdown:
   ![Tanaman hijau di pot](media:tumbuhan)
   Satu soal boleh punya lebih dari satu gambar (pakai nama slot berbeda).
3. Setelah blok kode pada BAGIAN 2, tulis satu daftar ringkas berjudul
   "DAFTAR GAMBAR YANG PERLU DIUNGGAH" berisi semua nama slot yang dipakai,
   satu per baris, supaya guru bisa menyalinnya ke panel Gambar.
4. Jangan memakai gambar untuk soal yang tidak benar-benar membutuhkannya.

Bila pengguna mengirim gambar langsung di percakapan, JANGAN mengubahnya jadi
base64. Cukup gunakan gambar itu sebagai referensi untuk menulis soal, lalu
tetap rujuk dengan nama slot seperti aturan di atas.
```

---

## Blok jenis soal untuk instructions Gem (tempel ini)

> Tempel juga blok ini ke bagian **SPESIFIKASI TEKNIS** pada instructions Gem,
> supaya Gem menulis soal dengan nama tipe yang benar. Aplikasi kuis hanya
> mengenali daftar di bawah — tipe di luar ini akan ditolak saat dipublikasikan.

```text
JENIS SOAL YANG DIDUKUNG (WAJIB DIPATUHI)
Tulis soal dalam format JSON Soal. Setiap butir WAJIB punya "type" dari daftar
berikut. Jangan mengarang nama tipe lain.

1. choice — pilihan ganda satu jawaban
   { "type": "choice", "question": "...", "options": ["...", "..."], "answer": "C" }
   Minimal 2 pilihan. "answer" boleh huruf (A/B/C), angka, atau teks pilihan.
   Untuk TKA/AKM tulis 5 pilihan (A–E).

2. multi — pilihan ganda kompleks (MCMA), jawaban lebih dari satu
   { "type": "multi", "question": "... (pilih semua yang benar)",
     "options": ["..."], "answer": ["A", "C"], "scoring": "partial" }

3. category — PG kompleks kategori (tabel Benar/Salah atau Sesuai/Tidak Sesuai)
   { "type": "category", "question": "Tentukan status tiap pernyataan.",
     "labels": ["Benar", "Salah"],
     "statements": [ { "text": "...", "answer": true },
                     { "text": "...", "answer": false } ],
     "scoring": "partial" }
   "answer" tiap pernyataan WAJIB SATU nilainya: true atau false saja. JANGAN
   menulis dua nilai — mis. "answer": [true, false] atau "answer": "false, true".
   Kalau kamu ragu pernyataan itu benar atau salah, putuskan SATU, jangan dua-duanya.
   Minimal 2 pernyataan.

4. matching — menjodohkan
   { "type": "matching", "question": "Jodohkan istilah dengan pengertiannya.",
     "pairs": [ { "left": "AGV", "right": "..." },
                { "left": "HSE", "right": "..." } ],
     "scoring": "partial" }
   Minimal 2 pasangan. Kolom kanan diacak otomatis oleh aplikasi — jangan
   mengacak sendiri dan jangan menomori pasangannya supaya tidak bocor.

5. ordering — mengurutkan langkah/proses
   { "type": "ordering", "question": "Urutkan langkah berikut.",
     "items": ["langkah pertama", "langkah kedua", "langkah ketiga"],
     "scoring": "partial" }
   Tulis "items" DALAM URUTAN YANG BENAR. Aplikasi yang mengacaknya untuk siswa.
   Jangan menuliskan angka urut di dalam teks item.

6. table_fill — melengkapi tabel (beberapa sel rumpang)
   { "type": "table_fill", "question": "Lengkapi tabel berikut.",
     "headers": ["Bahan", "Titik lebur"],
     "rows": [ ["Timah", { "answer": ["327"] }],
               ["Tembaga", { "answer": ["1085", "1.085"] }] ],
     "scoring": "partial" }
   Sel berupa teks biasa = kolom statis. Sel berupa objek { "answer": [...] } =
   rumpang yang diisi siswa. Cantumkan semua ejaan yang bisa diterima.

7. two_tier — dua tingkat: pilih pernyataan, lalu pilih alasan pendukungnya
   { "type": "two_tier", "question": "Setujukah kamu dengan pernyataan itu?",
     "options": ["Setuju", "Tidak setuju"], "answer": "Tidak setuju",
     "reasons": ["Karena ...", "Karena ..."], "reason_answer": "Karena ...",
     "scoring": "partial" }
   "answer" = kunci tingkat 1, "reason_answer" = kunci tingkat 2 (keduanya wajib).

8. highlight — siswa mengklik kata/frasa di dalam bacaan
   { "type": "highlight", "question": "Klik kata yang menunjukkan sikap jujur.",
     "text": "Budi {mengembalikan} uang yang ditemukannya kepada {guru}.",
     "answer": ["mengembalikan"] }
   "text" = bacaan. Kata yang boleh dipilih diapit kurawal { }, lalu "answer"
   berisi daftar kata yang BENAR. Sediakan minimal 3 kata bisa diklik agar ada
   pengecoh.

9. true_false — satu pernyataan benar/salah
   { "type": "true_false", "question": "...", "answer": "benar" }
   Tulis "answer" SATU nilai saja: "benar", "salah", atau true/false. Jangan
   mencantumkan dua-duanya (mis. "benar, salah" atau [true, false]).

10. short — isian singkat
    { "type": "short", "question": "...",
      "answer": ["jawaban utama", "ejaan lain"] }
    Cantumkan variasi ejaan yang wajar. Huruf besar/kecil, tanda baca, harakat
    Arab, dan angka Arab sudah diabaikan otomatis oleh aplikasi.

11. essay — uraian, dikoreksi guru
    { "type": "essay", "question": "...", "points": 5 }

FIELD BERSAMA SEMUA TIPE
- "points"      : bobot butir (default 1). Pakai untuk memberi bobot lebih pada
                  soal yang lebih sulit.
- "level"       : label ranah kognitif, mis. "L1"/"L2"/"L3" atau "Penalaran".
- "explanation" : pembahasan analitis yang muncul setelah siswa mengirim
                  jawaban. WAJIB diisi untuk semua soal objektif.
- "scoring"     : "partial" untuk skor proporsional. Dipakai pada multi,
                  category, matching, ordering, table_fill, two_tier, dan
                  highlight. Tanpa ini, nilainya penuh atau nol.
- "stimulus"    : bacaan/data penunjang butir ini, objek { "title": ..., "content": ... }.
- "image"       : nama slot gambar, mis. "media:tumbuhan".

BACAAN PER SOAL (STIMULUS)
Setiap butir boleh membawa satu bacaan lewat field "stimulus" DI DALAM objek
soalnya, berbentuk objek dengan "title" dan "content":
  "questions": [ { "type": "choice",
                   "stimulus": { "title": "Company Operational Memo",
                                 "content": "..." },
                   "question": "..." } ]
Satu stimulus untuk satu soal: kalau beberapa soal memakai bacaan yang sama,
tulis bacaan itu di tiap soal yang memakainya. Sistem menampilkan bacaan tepat
di atas kartu soalnya, dan guru bisa mengedit bacaan tiap soal di editor.
Soal tanpa bacaan cukup tidak menulis field "stimulus". Sistem masih menerima
format lama (teks langsung, atau id "s1" dengan daftar "stimuli" level atas)
dan menyalinnya ke tiap soal saat diparse, tapi jangan menuliskannya untuk soal
baru.

PEMETAAN ISTILAH UJIAN -> NAMA TIPE
- "Pilihan Ganda Biasa (A–E)"       -> choice
- "PG Kompleks MCMA"                -> multi
- "PG Kompleks Kategori / matriks"  -> category
- "Menjodohkan"                     -> matching
- "Mengurutkan"                     -> ordering
- "Melengkapi tabel"                -> table_fill
- "Menentukan alasan"               -> two_tier
- "Memilih kata pada bacaan"        -> highlight
Kalau pengguna meminta proporsi tipe soal (mis. 70% PG, 15% MCMA, 15% kategori),
patuhi proporsi itu dan tuliskan di Ringkasan Asesmen.
```

---

## Contoh JSON lengkap (mode JSON Soal)

```json
{
  "title": "Kuis IPA - Fotosintesis",
  "description": "Baca tiap soal dengan teliti.",
  "passing_score": 70,
  "duration_minutes": 45,
  "identity_fields": "name_class",
  "questions": [
    {
      "type": "choice",
      "question": "Perhatikan gambar berikut! Bagian mana yang menyerap cahaya matahari?",
      "image": "media:daun-fotosintesis",
      "options": ["Klorofil pada daun", "Akar", "Batang"],
      "answer": "Klorofil pada daun"
    },
    {
      "type": "true_false",
      "question": "Cermati grafik di bawah ini.\n\n![Grafik suhu harian](media:grafik-suhu)",
      "answer": "benar"
    },
    {
      "type": "short",
      "question": "Perhatikan peta berikut, pulau apa yang ditandai?\n\nmedia:peta-indonesia",
      "answer": ["jawa"]
    }
  ]
}
```

Nama slot yang muncul di JSON itu bisa dilihat langsung di halaman
`/p/<slug>/media` — panelnya sudah otomatis mendaftar semua slot beserta status
"sudah ada" / "belum diunggah".

---

## Setelah dipublikasikan: edit tanpa Gemini

Mode **JSON Soal** menyimpan soalnya sebagai data, bukan HTML jadi. Jadi salah
ketik atau salah kunci tidak perlu bolak-balik ke Gem — pakai tombol **Edit**
pada kartu aplikasi (atau `/p/<slug>/edit`):

- ubah teks soal, pilihan, kunci, dan bobot nilai;
- tambah / hapus / duplikat / geser urutan soal;
- ganti tipe soal — semuanya bisa, termasuk **kategori** (tabel Benar/Salah),
  **menjodohkan**, **mengurutkan**, **melengkapi tabel**, **pernyataan + alasan**,
  dan **pilih kata di bacaan**;
- isi atau ganti nama slot gambar.

Tiap tipe punya editor sendiri, jadi tidak perlu menghafal struktur JSON-nya:

| Tipe | Yang diedit di editor |
| --- | --- |
| `category` | daftar pernyataan + radio Benar/Salah, dan judul kolomnya |
| `matching` | pasangan kiri → kanan (kolom kanan diacak otomatis untuk siswa) |
| `ordering` | daftar langkah **dalam urutan yang benar** |
| `table_fill` | judul kolom + tabel; sel rumpang ditulis `{327}` atau `{1085 / 1.085}` |
| `two_tier` | daftar pernyataan + daftar alasan, masing-masing satu kunci |
| `highlight` | bacaan dengan kata diapit `{ }`, lalu daftar kata yang benar |
| semua tipe | **judul & teks bacaan (stimulus)** — tampil di atas kartu soalnya, bisa diedit per soal |

Saat disimpan, JSON-nya divalidasi ulang dan halaman kuis digambar ulang, jadi
siswa langsung melihat versi barunya di alamat yang sama. Jawaban yang sudah
masuk tidak berubah.

Editor ini tersedia untuk semua aplikasi. Menyimpan di sini membuat siswa
melihat versi barunya di alamat yang sama, dan jawaban yang sudah masuk tidak
berubah.

## Membaca hasil: analisis butir soal

Halaman **Log Data** (`/p/<slug>/data`) kini membuka dengan ringkasan dan tabel
analisis butir soal, dihitung dari jawaban yang sudah masuk:

- **Tingkat kesukaran** — persentase siswa yang benar: <30% sulit, 30–70% sedang,
  >70% mudah.
- **Daya beda (D)** — selisih benar kelompok 27% atas dan 27% bawah: <0,20 jelek,
  0,20–0,29 cukup, 0,30–0,39 baik, ≥0,40 baik sekali. Butuh minimal 8 peserta.
- **Sebaran pengecoh** — berapa siswa memilih tiap pilihan (PG), kunci ditandai
  hijau; berguna untuk menemukan pengecoh yang tidak ada yang memilih.
- **Bagian tersering keliru** — untuk soal yang punya baris (kategori,
  menjodohkan, mengurutkan, melengkapi tabel, pilih kata), ditampilkan bagian
  mana yang paling banyak salah, mis. "Pernyataan kedua (12/25 salah)". Ini yang
  paling cepat menunjukkan konsep mana yang belum dikuasai siswa.
- **Catatan otomatis** — soal ditandai jika terlalu sulit/mudah atau daya
  bedanya rendah. Daya beda **negatif** hampir selalu berarti kunci jawabannya
  salah, dan itu ditandai merah.

Ada juga tombol **Unduh CSV** (siap dibuka di Excel/Google Sheets) untuk
dilampirkan ke laporan. Angka-angka ini hanya muncul untuk aplikasi mode JSON
Soal, karena penilaiannya memang dilakukan di server kita.

## Mengoreksi esai

Dari **Log Data** ada tombol **Koreksi Esai** (`/p/<slug>/essay`), dan tampil jadi
pengingat oranye kalau masih ada antrean:

- Tiap kiriman siswa ditampilkan lengkap: soal esai, jawaban siswa apa adanya,
  dan kolom nilai 0 sampai poin maksimalnya.
- Tombol **Nilai penuh** mengisi otomatis; menekan Enter di kolom nilai juga
  langsung menyimpan, jadi koreksi banyak siswa jadi cepat.
- Mengosongkan kolom berarti soal itu kembali dianggap belum dikoreksi.

Soal nilai akhir, sengaja dipisah:

| Angka | Arti |
| --- | --- |
| **Nilai objektif** | nilai dari soal PG/isian saja, dihitung otomatis saat siswa mengirim |
| **Nilai akhir** | objektif + esai, muncul hanya setelah **semua** esai di kiriman itu selesai dinilai |

Kenapa tidak langsung digabung? Supaya nilai siswa tidak turun sepihak saat
esainya masih menunggu koreksi (misal 5 objektif + 1 esai: objektif penuh =
100, tapi nilai akhirnya 50 sebelum esainya dinilai). Halaman analisis butir soal
memakai nilai akhir begitu tersedia, dan nilai objektif untuk yang belum.

## Tampilan pengerjaan siswa

Halaman kuis (`/p/<slug>`) sekarang bergaya aplikasi ujian:

- **Panel nomor soal** di sisi kanan (jadi laci di layar kecil). Nomor berwarna
  hijau kalau sudah dijawab dan kuning kalau ditandai ragu; diklik langsung
  melompat ke soalnya. Ada penghitung "Terjawab n dari m" di panel dan di bar bawah.
- **Tombol Ragu** di tiap kartu soal, untuk menandai soal yang mau ditinjau lagi.
- **Bacaan tepat di atas kartu soalnya** — tiap soal berbacaan menampilkan
  bacaannya sendiri, jadi siswa bisa membaca sambil menjawab tanpa menggulir
  bolak-balik.
- **Jawaban tersimpan otomatis.** Kalau halaman ter-refresh atau listrik mati,
  saat dibuka lagi muncul tawaran **Lanjutkan / Mulai baru** beserta nama siswa
  yang terakhir mengerjakan. Jawaban tidak dipulihkan diam-diam — penting untuk
  komputer sekolah yang dipakai bergantian. Penyimpanan baru aktif setelah nama
  diisi, dan terpisah per aplikasi (`quiz-attempt:<slug>`).
- **Saat dicetak** (Ctrl+P), panel navigasi dan tombol panah tidak ikut tercetak,
  termasuk bar aksi. Soal mengurutkan tercetak sebagai daftar bernomor untuk
  dikerjakan di kertas.

Nilai akhir tetap dihitung **di server** saat siswa menekan kirim, jadi skor tidak
bisa diubah dari sisi browser.

## Checklist guru

1. Salin JSON/kode dari Gem → tempel di dashboard → **Publikasikan**.
2. Klik tombol **Gambar** pada kartu aplikasi (atau buka `/p/<slug>/media`).
3. Untuk tiap slot: klik **Pilih / Potret Foto**. Di HP browser menawarkan
   kamera atau galeri; foto dari kamera HP tidak perlu dikompres dulu —
   fotonya otomatis diperkecil (maks 1600 px) dan dikonversi ke **WebP** di
   perangkatmu sebelum dikirim, jadi kuota hemat dan halaman kuis ringan.
4. Batasnya 8 MB per gambar. Konversi WebP berjalan di browser; kalau browser
   tidak mendukung, file aslinya tetap terkirim selama formatnya JPG, PNG, GIF,
   WebP, AVIF, atau BMP. SVG tidak diterima (bisa dipakai menyisipkan skrip).
5. Balik ke dashboard: kalau masih ada slot kosong, kartunya menandai
   "n dari m gambar soal belum diunggah".
6. Buka kuisnya. Slot yang belum diisi menampilkan kotak
   "Gambar belum diunggah" — jadi tidak ada ikon gambar rusak di hadapan siswa.
7. Perlu perbaikan soal? Klik **Edit** pada kartu aplikasi — tidak perlu
   meminta Gem menulis ulang kodenya.

Catatan: urutan pemakaian bisa dibalik — unggah foto lebih dulu di panel Gambar,
lalu pakai URL itu saat menyusun soal kalau lebih mudah daripada menulis nama
slot.
