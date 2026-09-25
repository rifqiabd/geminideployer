# Strategi Publish, Diferensiasi, dan Sosialisasi

Status: Usulan taktik untuk fase pilot terbatas
Tanggal: 25 September 2026
Target awal: 5–10 guru dari 1–3 sekolah

## 1. Ringkasan Keputusan

- Posisikan produk sebagai **alur kerja asesmen kelas**, bukan sekadar generator soal dengan AI.
- Jelaskan nilai utamanya sebagai: **dari materi ajar menjadi asesmen yang siap diedit, dibagikan, dan dianalisis tanpa coding**.
- Terapkan prinsip **publikasi dengan bukti**: demo langsung, pilot terbatas, dan studi kasus sebelum publikasi luas.
- Perlakukan kemampuan produk untuk direplikasi sebagai sinyal bahwa masalahnya nyata. Keunggulan jangka panjang dibangun dari kualitas, template lokal, pendampingan, kepercayaan, dan rutinitas penggunaan.
- Mulai dari guru individu dan sekolah pembina, bukan langsung mencakup semua sekolah.
- Tahan publikasi luas sampai autentikasi, fallback password, pembatasan laju, proteksi kunci jawaban, privasi data, dan pengujian rute ditangani.
- Gunakan program sosialisasi 60 menit yang menekankan pada praktik, bukan presentasi fitur.
- Gunakan hasil pilot untuk memutuskan apakah melanjutkan ke demo publik, iterasi produk, atau menghentikan perluasan.

## 2. Tujuan Strategi

### Tujuan bisnis

1. Membuktikan ada permintaan nyata dari guru yang rutin menyiapkan asesmen.
2. Mengubah penggunaan pertama menjadi kebiasaan memakai.
3. Membangun kredibilitas melalui studi kasus yang sah dan berbasis penggunaan nyata.
4. Menentukan apakah produk layak dipromosikan sebagai pilot sekolah atau perlu diposisikan ulang.
5. Membangun basis pengguna awal yang dapat merekomendasikan produk kepada rekan sejawat.

### Tujuan produk

1. Menegaskan kualitas alur dari prompt atau materi hingga kuis aktif.
2. Membuat guru lebih cepat mencapai kuis pertama tanpa menambah beban teknis.
3. Mempertahankan tinjauan guru atas isi, kunci jawaban, dan media.
4. Membuat laporan menjadi alat bantu keputusan, bukan sekadar ekspor nilai.
5. Mengurangi friksi yang berulang dalam setiap sesi.

### Batas fase ini

- Bukan klaim produk siap untuk semua sekolah.
- Bukan janji hasil belajar yang belum diukur.
- Bukan layanan CBT terdaftar, tenant multi-sekolah, atau penagihan sekolah.
- Bukan pengganti keputusan profesional guru.
- Bukan alasan untuk memakai data pribadi siswa tanpa kebijakan dan persetujuan yang benar.

## 3. Posisi Produk Saat Ini

### Alur yang sudah tersedia

```text
Materi atau prompt
      ↓
Dashboard guru
      ↓
JSON, HTML, atau React
      ↓
Publikasi ke /p/<slug>
      ↓
Siswa mengerjakan asesmen
      ↓
Penilaian, laporan, dan koreksi esai
```

### Kemampuan yang dapat ditunjukkan

- Membuat atau memproses materi menjadi kuis dengan beberapa format keluaran.
- Mempublikasikan asesmen melalui link publik.
- Mengedit soal langsung dari browser.
- Menambahkan media, mengunggah gambar, dan memakai generator gambar AI secara opsional.
- Menghitung skor pada server untuk kuis JSON sehingga hasil tidak sepenuhnya ditentukan browser.
- Melihat rekap dan analisis butir soal.
- Meninjau serta mengoreksi jawaban esai.
- Menyediakan TKA Studio dan fitur pendidikan lain yang sudah tersedia di aplikasi.

### Kemampuan yang masih direncanakan

- Google OAuth dan sesi sisi server.
- Peran guru, admin, dan siswa.
- Kepemilikan asesmen dan isolasi antar guru.
- Daftar siswa untuk mode assigned/CBT.
- Timer server, penyimpanan otomatis, melanjutkan percobaan, dan submit idempotent.
- Audit, pembatasan laju, pagination, dan operasi multi-sekolah.
- R2 untuk media pada skala lebih besar.

Rencana autentikasi dan CBT ada di `docs/plan-google-cbt.md`; fitur tersebut belum dinyatakan tersedia di kode saat dokumen ini dibuat.

## 4. Nilai Utama dan Poin Plus

### 4.1 Satu alur, bukan banyak alat terpisah

Guru tidak perlu berpindah antara dokumen, alat generik, editor, alat unggah, kuis, dan spreadsheet. Satu alur mengurangi jumlah langkah yang harus dikoordinasikan.

### 4.2 Cepat mencapai nilai

Produk dapat menunjukkan proses dari materi menjadi kuis aktif dalam satu sesi. Keberhasilan tidak diukur dari banyaknya fitur, tetapi dari berapa cepat guru dapat menerbitkan asesmen pertama yang layak.

### 4.3 Guru tetap memegang kendali

AI menghasilkan draf, bukan keputusan akhir. Guru memeriksa soal, mengubah kunci, mengganti media, dan menentukan apakah konten sudah layak digunakan.

### 4.4 Penilaian dan laporan terhubung

Skor, rekap, analisis butir, dan koreksi esai berada dalam konteks yang sama. Ini membantu guru memahami hasil, bukan hanya menyimpan angka.

### 4.5 Tidak memerlukan coding

Guru dapat berfokus pada tujuan belajar, tingkat kesulitan, dan isi. Antarmuka harus tetap memakai bahasa Indonesia yang jelas dan menghindari jargon teknis.

### 4.6 Mudah dibagikan dan diulang

Link publik membuat asesmen mudah dibagikan. Kasus penggunaan yang berulang untuk praktik, asesmen formatif, ulangan, dan remediasi akan membangun alasan untuk kembali menggunakan produk.

## 5. Diferensiasi dan Keunggulan Jangka Panjang

### Apa yang mudah direplikasi

- Tampilan dashboard.
- Integrasi Gemini atau model AI lain.
- Tombol pembuatan soal.
- Link publik.
- Format editor umum.

### Apa yang tidak boleh menjadi alasan utama untuk unggul

- Akses ke satu model AI.
- Satu pustaka browser.
- Format HTML yang menarik.
- Jumlah tombol fitur.
- Klaim bahwa hasil AI selalu benar.

### Moat yang dapat dibangun

1. **Kecepatan mencapai kuis pertama.** Template dan orientasi membuat guru berhasil dengan bantuan minimal.
2. **Kualitas yang konsisten.** Standar tinjauan, rubrik, contoh kurikulum, dan bank kasus yang terus diperbaiki.
3. **Kepercayaan.** Kunci jawaban transparan, status draf, tinjauan guru, dan komunikasi yang tidak berlebihan.
4. **Dukungan.** Dokumentasi, jam konsultasi, orientasi, dan kanal dukungan yang bisa dijawab dengan cepat.
5. **Hubungan sekolah.** Alur kerja, protokol, pendampingan, dan aturan yang sesuai kebiasaan asesmen.
6. **Data pembelajaran.** Wawasan anonim tentang tingkat kesulitan, remediasi, dan kasus penggunaan dengan persetujuan serta privasi yang jelas.
7. **Komunitas.** Guru yang berhasil menjadi mentor, studi kasus, dan sumber template.

### Prinsip defensif

Produk yang mudah ditiru dari sisi teknis tetap dapat sulit ditiru dari sisi hasil. Fokuslah pada kualitas pengalaman, kualitas keluaran, dan kecepatan mendapatkan manfaat.

## 6. Audiens dan Nilai Utama

| Audiens | Masalah utama | Nilai yang ditawarkan | Prioritas |
|---|---|---|---|
| Guru individu | Persiapan soal dan laporan memakan waktu | Kuis siap pakai tanpa coding | Prioritas 1 |
| Guru mata pelajaran | Format soal dan media beragam | Editor, media, tipe soal, dan laporan | Prioritas 1 |
| Sekolah | Kualitas dan pemantauan tidak seragam | Template, pendampingan, dan alur yang konsisten | Pilot |
| MGMP dan pelatih | Membutuhkan materi pelatihan | Contoh, pelatihan, dan paket kasus | Pilot |
| Admin sekolah | Data, akun, dan audit harus aman | Fondasi autentikasi dan kontrol akses | Setelah penguatan |
| Siswa | Akses harus sederhana | Link publik yang mudah digunakan | Pengguna, bukan pembeli awal |

### Segmen awal

- 5–10 guru dari 1–3 sekolah.
- Satu atau dua mata pelajaran.
- Guru yang sudah menyiapkan asesmen secara rutin tetapi memperlambat pekerjaan dengan format soal.
- Sekolah yang siap memberi umpan balik terbuka, bukan hanya meminta demo.

## 7. Positioning dan Pesan

### Positioning utama

> **Dari materi ajar menjadi asesmen siap pakai—bisa diedit, dibagikan, dan dianalisis dalam satu alur, tanpa coding.**

### Versi pendek

> **Asesmen kelas lebih cepat, dengan kendali tetap di tangan guru.**

### Tagline masalah

> **Materi sudah siap. Mengapa masih lama untuk membuat asesmen?**

### Pesan yang harus konsisten

- AI membantu membuat draf; guru memeriksa dan bertanggung jawab.
- Produk mempercepat pekerjaan rutin; bukan menghapus semua kerja guru.
- Laporan membantu keputusan; bukan menjamin keputusan otomatis selalu benar.
- Link publik memudahkan penggunaan awal; bukan berarti semua mode aman tanpa kontrol.
- Produk adalah alat bantu penilaian dan komunikasi; bukan pengganti proses yang perlu ditinjau.

### Jangan jadikan produk sebagai

- “AI yang menggantikan guru.”
- “Soal dijamin benar.”
- “Aplikasi yang menghapus pekerjaan guru.”
- “Sistem otomatis yang aman dari semua kecurangan.”
- “Platform sekolah multi-tenant yang sudah siap.”

## 8. Gerbang Sebelum Rilis dan Pilot

Penguatan keamanan adalah bagian dari strategi produk. Jika rilis dilakukan sebelum gerbang ini, risiko reputasi dan data akan ikut tersebar bersama link.

### Gerbang P0 — wajib sebelum pilot bersama sekolah

- Ganti cookie statis di `src/auth.ts:9-12` dengan sesi yang benar-benar diverifikasi.
- Hapus fallback `admin123` di `src/index.ts:537-556` dan pastikan secret tidak pernah di-commit.
- Batasi akses dashboard, laporan, media, sumber, dan kepemilikan.
- Validasi serta escape seluruh metadata dan konten dinamis, termasuk title, URL media kaya, dan import TKA.
- Cegah kebocoran kunci jawaban melalui print atau parameter URL.
- Tambahkan pembatasan laju pada endpoint publik, pembuatan soal dengan AI, dan callback autentikasi.
- Tambahkan pengujian rute, autentikasi, KV, dan D1; suite saat ini terutama menguji modul quiz dan helper.
- Tetapkan data minimum, retensi, hak akses, ekspor, dan penghapusan data.

### Gerbang P1 — wajib sebelum perluasan multi-sekolah

- Miliki identitas guru dan kepemilikan asesmen.
- Namespace konten baru per pemilik atau asesmen.
- Pembagian halaman, index, dan query laporan yang tidak membaca seluruh histori.
- R2 untuk media atau strategi fallback yang jelas dan terukur.
- Pantau error, biaya, latensi, dan pemakaian AI.
- Siapkan SOP dukungan, insiden, pencadangan, dan pemulihan.

### Gerbang P2 — untuk mode CBT terdaftar

- Google OAuth dengan state, nonce, PKCE, dan verifikasi token.
- Roster siswa dan sesi sisi server.
- Timer server dan percobaan yang tidak dapat diubah dari klien.
- Penyimpanan otomatis, melanjutkan, submit idempotent, dan hasil sesuai kebijakan rilis.

## 9. Strategi Diseminasi

### Urutan komunikasi

1. **Masalah:** menyiapkan asesmen memerlukan banyak pekerjaan berulang.
2. **Solusi:** satu alur dari materi hingga asesmen aktif.
3. **Bukti:** demo nyata, bukan tangkapan layar fitur.
4. **Kontrol:** guru dapat mengedit dan memeriksa sebelum publikasi.
5. **Hasil:** guru melihat rekap dan laporan, bukan sekadar link.
6. **Aksi:** ajak guru membuat kuis pertama dengan kasus nyata.

### Kanal yang direkomendasikan

- Demo online langsung 30–45 menit.
- Pelatihan sekolah 60 menit dengan latihan terbimbing.
- Komunitas guru, MGMP, dan grup WhatsApp/Telegram yang relevan.
- Konten video pendek: membuat soal, menambahkan media, membaca laporan.
- Template dan contoh prompt yang telah diuji.
- Studi kasus dari pilot dengan persetujuan sekolah.
- Rekomendasi langsung dari guru yang memakai produk secara rutin.

### Prinsip distribusi

- Bagikan kasus yang mudah dicoba, bukan halaman pendaratan yang hanya menjanjikan.
- Gunakan data demo yang tidak memerlukan data pribadi siswa.
- Hindari spam, undangan massal, dan klaim “gratis selamanya”.
- Terapkan referensi yang dapat diverifikasi: waktu pengerjaan, jumlah kuis, dan umpan balik nyata.
- Uji dua variasi pesan pada beberapa calon pengguna sebelum memilih pesan utama.

## 10. Program Sosialisasi 60 Menit

Sosialisasi harus berorientasi pada hasil yang dicoba peserta, bukan pada daftar fitur.

| Waktu | Materi | Hasil |
|---|---|---|
| 0–5 menit | Masalah dan satu contoh alur kerja | Peserta memahami masalah yang diselesaikan |
| 5–15 menit | Demo dari prompt/materi ke kuis aktif | Peserta melihat alur end-to-end |
| 15–30 menit | Latihan membuat, mengedit, dan menambahkan media | Peserta membuat draf pertama |
| 30–40 menit | Latihan memakai link dan membaca laporan | Peserta memahami cara memberi umpan balik |
| 40–50 menit | Studi kasus dan tinjauan kualitas | Peserta belajar memeriksa keluaran |
| 50–60 menit | Diskusi, template, dan langkah pilot | Peserta tahu cara melanjutkan |

### Persiapan

- Siapkan 3–5 kasus yang relevan untuk mata pelajaran berbeda.
- Gunakan data demo, bukan data siswa nyata.
- Pastikan akun, jaringan, dan generator gambar sudah diuji.
- Sediakan satu tugas sederhana yang dapat diselesaikan peserta.
- Siapkan kanal dukungan dan umpan balik yang singkat.

### Tindak lanjut

- Hari 1: kirim template, contoh prompt, dan tugas.
- Hari 7: cek apakah kuis pertama sudah terbit.
- Hari 14: demo kuis peserta dan pendampingan singkat.
- Hari 30: umpan balik, perbaikan, dan keputusan kelanjutan.

## 11. Desain Pilot

### Prasyarat

- Gerbang P0 selesai untuk data yang dipakai bersama sekolah.
- Peserta memahami bahwa AI menghasilkan draf dan guru tetap melakukan tinjauan.
- Sekolah menyetujui penggunaan data sesuai kebijakan yang berlaku.
- Ada orang yang bertanggung jawab atas dukungan dan insiden.

### Kelompok awal

- 5–10 guru.
- 1–3 sekolah.
- Satu atau dua mata pelajaran.
- Satu kasus nyata per guru.
- Demo terlebih dahulu bila ada kekhawatiran privasi.

### Aktivitas wajib

1. Guru membuat atau mengimpor materi.
2. Guru membuat kuis pertama.
3. Guru melakukan tinjauan terhadap isi, kunci, bahasa, dan media.
4. Guru menerbitkan link.
5. Tiga hingga sepuluh siswa memakai data yang disetujui.
6. Guru membaca rekap dan melakukan tindak lanjut.
7. Guru membuat kuis kedua atau memakai ulang template.

### Keputusan setelah pilot

- **Lanjut:** aktivasi, penggunaan ulang, kepuasan, dan keamanan memenuhi target.
- **Iterasi:** produk berguna tetapi proses orientasi, kualitas, atau kebijakan masih menghambat.
- **Jeda:** ada insiden kritis, kebocoran data, atau tidak ada penggunaan ulang yang jelas.

## 12. Metrik Keberhasilan

Angka berikut adalah target rekomendasi fase pilot, bukan klaim kondisi saat ini.

| Area | Metrik | Target awal |
|---|---|---:|
| Aktivasi | Peserta yang menerbitkan kuis pertama | ≥ 80% |
| Aktivasi | Waktu median sampai kuis terbit | ≤ 30 menit |
| Adopsi | Peserta membuat atau memakai kuis kedua dalam 14 hari | ≥ 50% |
| Retensi | Guru aktif pada minggu ke-4 | ≥ 60% |
| Nilai | Kepuasan setelah memakai minimal satu siklus | ≥ 4,3/5 |
| Kualitas | Kuis yang ditolak atau butuh perbaikan besar | ≤ 20% |
| Dukungan | Tiket yang menghambat penyelesaian tugas | < 20% peserta |
| Keamanan | Insiden kritis, kebocoran data, atau bocor kunci | 0 |
| Operasional | Error dan downtime yang mengganggu pilot | Terukur dan ditindaklanjuti |

### Cara mengukur

- Log event anonim: mulai, publikasi, submit, laporan dibuka, dan kuis kedua.
- Wawancara singkat pada hari 7, 14, dan 30.
- Catat waktu penyiapan, jumlah revisi, kendala, dan alasan berhenti memakai.
- Pisahkan umpan balik kualitas soal, pengalaman pengguna, kebijakan, dan dukungan.
- Jangan menghitung konversi dari jumlah klik tanpa hasil yang benar-benar dipakai guru.

## 13. Kalender Konten 30 Hari

### Minggu 1 — Pemetaan masalah

- Post 1: “Materi selesai, kenapa asesmen masih lama?”
- Video pendek: satu prompt menjadi kuis.
- Halaman singkat: alur kerja dan batasannya.

### Minggu 2 — Bukti produk

- Demo langsung: prompt → editor → publikasi → laporan.
- Konten “guru tetap melakukan tinjauan, bukan menerima keluaran apa adanya”.
- Template contoh yang dapat dicoba tanpa data pribadi.

### Minggu 3 — Bukti sosial

- Studi kasus pilot: masalah, proses, hasil, dan kendala.
- Testimoni yang menyebut perbaikan spesifik, bukan hanya pujian.
- Sesi Q&A untuk calon guru.

### Minggu 4 — Konversi ke pilot

- Undangan kelompok terbatas.
- Checklist kesiapan pilot.
- Form minat yang menanyakan mata pelajaran, jumlah siswa, dan kebutuhan data.
- Tindak lanjut pribadi untuk peserta yang belum membuat kuis.

## 14. Daftar Risiko

| Risiko | Dampak | Mitigasi | Pemicu keputusan |
|---|---|---|---|
| Autentikasi atau kepemilikan lemah | Akses data lintas pengguna | Sesi, peran, namespace, dan pengujian rute | Jangan publikasikan dashboard bersama |
| Kunci jawaban bocor | Soal bocor dan kepercayaan rusak | Kunci pada tampilan cetak, kebijakan rilis, tinjauan | Hentikan mode CBT |
| Output AI salah | Guru kehilangan waktu dan perlahan kehilangan kepercayaan | Status draf, daftar tinjauan, eskalasi | Hentikan template yang bermasalah |
| Data siswa disalahgunakan | Risiko privasi dan reputasi | Data minimum, persetujuan, retensi, ekspor, hapus | Jeda pilot data nyata |
| Media menumpuk di KV | Biaya dan performa membengkak | R2, thumbnail, batas, pemantauan | Hentikan media pada volume tinggi |
| Dukungan terlalu berat | Tim tumbuh tanpa pengguna | FAQ, orientasi, jam konsultasi, triase | Batasi kelompok |
| Provider AI berubah | Output dan biaya berubah | Abstraksi provider, fallback manual, dan peringatan anggaran | Ubah paket atau hentikan pembuatan soal |
| Guru mencoba sekali | Retensi rendah | Template, tindak lanjut, kasus rutin | Revisi orientasi |
| Pesan terlalu luas | Diskusi tidak fokus | Satu positioning dan dua audiens utama | Kembali ke guru dan pembina |

## 15. Model Operasional

### Peran minimal

- **Produk:** memprioritaskan masalah yang paling sering menghambat pilot.
- **Tim teknik:** menjaga keamanan, rute, data, dan pengujian regresi.
- **Keberhasilan guru:** mendampingi orientasi, mencatat umpan balik, dan menjaga kanal dukungan.
- **Konten:** menyiapkan contoh, demo, dan materi sosialisasi.
- **Kontak sekolah:** menjadi juru bicara sekolah dan pemilik keputusan kelanjutan.

### Ritme mingguan

- 15 menit tinjauan metrik dan insiden.
- 30 menit tinjauan hambatan dari peserta.
- 45 menit fokus pada keputusan dan prioritas minggu berikutnya.
- Satu sesi pendampingan atau jam konsultasi.
- Satu keputusan tertulis: lanjut, iterasi, atau jeda.

### Prinsip operasional

Gunakan data, bukan impresi, sebagai dasar keputusan. Setiap fitur baru harus menjelaskan masalah peserta yang diselesaikan, cara mengukur keberhasilan, dan risiko baru yang diperkenalkan.

### Kebijakan keputusan

- Jangan memperluas kelompok ketika ada insiden kritis yang belum selesai.
- Jangan menerbitkan keluaran AI sebagai hasil akhir tanpa alur tinjauan guru.
- Jangan menambahkan fitur yang tidak memperbaiki aktivasi, penggunaan ulang, atau kepercayaan.
- Dokumentasikan setiap keputusan, pemilik, tanggal, dan alasan.

## 16. Rencana 30 Hari

### Hari 1–5 — Posisikan dan amankan

- Tetapkan positioning dan pesan utama.
- Selesaikan daftar periksa Gerbang P0.
- Siapkan 3–5 kasus demo dan FAQ.
- Buat formulir minat serta daftar periksa pilot.

### Hari 6–10 — Siapkan materi

- Buat demo 30 menit dan pelatihan 60 menit.
- Buat template, contoh prompt, dan panduan tinjauan.
- Rekam demo singkat untuk kanal sosial.
- Siapkan kanal dukungan dan formulir umpan balik.

### Hari 11–15 — Rekrut pilot

- Ajak 5–10 guru melalui koneksi MGMP, sekolah, atau komunitas.
- Pilih 1–3 sekolah dengan kebutuhan yang jelas.
- Pastikan guru, kelas, persetujuan data, dan penanggung jawab sekolah.

### Hari 16–20 — Sosialisasi dan orientasi

- Jalankan sesi 60 menit.
- Pastikan setiap peserta membuat draf pertama.
- Catat hambatan dan pertanyaan yang berulang.
- Kirim tugas dan jadwal tindak lanjut.

### Hari 21–30 — Pilot dan keputusan

- Dampingi publikasi dan pemakaian pertama.
- Catat kuis kedua, rekap, dan umpan balik.
- Perbaiki masalah yang berulang.
- Putuskan apakah perlu demo publik, iterasi, atau jeda.

## 17. Bentuk Rilis yang Direkomendasikan

### Rilis 1 — Pilot terbatas

- Undangan pribadi, bukan iklan massal.
- 5–10 guru dan 1–3 sekolah.
- Demo memakai data simulasi atau data yang sudah disetujui.
- Tidak boleh menjanjikan fitur autentikasi/CBT yang belum ada.

### Rilis 2 — Rilis bukti

- Satu studi kasus nyata dan satu demo end-to-end.
- Daftar tunggu untuk kelompok berikutnya.
- Publikasi charter privasi, retensi, dan dukungan.
- Produk tetap berbasis undangan jika gerbang keamanan belum lengkap.

### Rilis 3 — Beta publik

- Halaman pendaratan, orientasi, halaman status, dan FAQ.
- Konten pendidikan dengan bahasa yang tidak berlebihan.
- Dukungan dan respons insiden aktif.
- Harga dan penagihan hanya setelah data penggunaan menunjukkan kelayakannya.

## 18. Keputusan Penutup

1. Fokuskan produk pada guru yang membutuhkan asesmen cepat dan bisa dikontrol.
2. Jual alur kerja, bukan AI sebagai gimmick.
3. Gunakan demo langsung sebagai alat differensiasi; bukti sosial yang belum ada belum boleh dibuat.
4. Mulai dari pilot kecil dengan gerbang keamanan yang jelas.
5. Ukur publikasi pertama, publikasi kedua, dan kualitas yang dirasakan guru.
6. Bangun moat lewat template, tinjauan, pendampingan, kepercayaan, dan studi kasus yang dapat diverifikasi.
7. Setelah pilot memberi bukti, lakukan publikasi bertahap; jangan melakukan perluasan yang lebih besar daripada yang sudah diuji.
8. Jika data tidak menunjukkan penggunaan ulang, iterasi atau jeda lebih baik daripada menambah janji.
