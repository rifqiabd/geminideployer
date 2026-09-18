# Foto pada soal: cara kerja & blok tambahan untuk Gem

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
| **JSON Soal** (disarankan) | `"image": "media:nama-slot"` atau `![keterangan](media:nama-slot)` di dalam teks soal |
| **HTML / React JSX** | `<img src="/media/<slug>/nama-slot">`, atau di JSX: `src={`/media/${getQuizSlug()}/nama-slot`}` |

Untuk mode HTML/React, nama `<slug>` adalah judul aplikasi yang diketik di
dashboard (huruf kecil, spasi jadi tanda hubung), atau bisa didapat saat runtime
dengan fungsi `getQuizSlug()` yang sudah ada di prompt Gem.

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
3. Jika soal ditulis sebagai aplikasi HTML/React standalone, rujuk gambar lewat
   path relatif yang dibangun dari slug kuis, JANGAN pakai URL luar:
     HTML : <img src="/media/" + getQuizSlug() + "/tumbuhan" alt="Tanaman">
     JSX  : <img src={`/media/${getQuizSlug()}/tumbuhan`} alt="Tanaman" />
   Untuk mode HTML/React, tambahkan juga satu baris catatan di Ringkasan
   Asesmen: "Unggah foto untuk slot: tumbuhan, peta-jawa" agar guru tahu.
4. Setelah blok kode pada BAGIAN 2, tulis satu daftar ringkas berjudul
   "DAFTAR GAMBAR YANG PERLU DIUNGGAH" berisi semua nama slot yang dipakai,
   satu per baris, supaya guru bisa menyalinnya ke panel Gambar.
5. Jangan memakai gambar untuk soal yang tidak benar-benar membutuhkannya.

Bila pengguna mengirim gambar langsung di percakapan, JANGAN mengubahnya jadi
base64. Cukup gunakan gambar itu sebagai referensi untuk menulis soal, lalu
tetap rujuk dengan nama slot seperti aturan di atas.
```

---

## Contoh JSON lengkap (mode JSON Soal)

```json
{
  "title": "Kuis IPA - Fotosintesis",
  "description": "Baca tiap soal dengan teliti.",
  "passing_score": 70,
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
- ganti tipe soal (PG, PG kompleks, Benar/Salah, isian, esai);
- isi atau ganti nama slot gambar.

Saat disimpan, JSON-nya divalidasi ulang dan halaman kuis digambar ulang, jadi
siswa langsung melihat versi barunya di alamat yang sama. Jawaban yang sudah
masuk tidak berubah.

Editor ini hanya tersedia untuk aplikasi mode JSON Soal. Untuk mode HTML/React,
perbaikannya tetap lewat Gemini lalu deploy ulang.

## Membaca hasil: analisis butir soal

Halaman **Log Data** (`/p/<slug>/data`) kini membuka dengan ringkasan dan tabel
analisis butir soal, dihitung dari jawaban yang sudah masuk:

- **Tingkat kesukaran** — persentase siswa yang benar: <30% sulit, 30–70% sedang,
  >70% mudah.
- **Daya beda (D)** — selisih benar kelompok 27% atas dan 27% bawah: <0,20 jelek,
  0,20–0,29 cukup, 0,30–0,39 baik, ≥0,40 baik sekali. Butuh minimal 8 peserta.
- **Sebaran pengecoh** — berapa siswa memilih tiap pilihan (PG), kunci ditandai
  hijau; berguna untuk menemukan pengecoh yang tidak ada yang memilih.
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
salin URL-nya, lalu pakai URL itu saat menyusun soal (praktis untuk mode
HTML/React yang gambarnya ditulis langsung di kode).
