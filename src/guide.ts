/* ==========================================================================
 * Halaman Panduan Penggunaan (/panduan) — cara memakai aplikasi dari awal
 * (membuat soal dengan Gem Gemini) sampai pantau hasil di Log Data.
 * Dibuat terpisah supaya halaman dashboard tidak semakin panjang.
 * ========================================================================== */

import type { Hono } from 'hono';

export const GEM_URL = 'https://gemini.google.com/gem/117WrAMmQHsva0tw7qixx1Xo-9HCP7eV0?usp=sharing';

/* ------------------------------------------------------------------------ */
/* Blok kecil penyusun halaman                                               */
/* ------------------------------------------------------------------------ */

function stepHeader(no: string, title: string, desc: string): string {
  return `
    <div class="flex items-start gap-3">
      <div class="w-9 h-9 shrink-0 rounded-xl bg-orange-500/15 border border-orange-500/40 text-orange-400 flex items-center justify-center text-sm font-bold mt-0.5">${no}</div>
      <div>
        <h2 class="text-base font-bold text-white">${title}</h2>
        <p class="text-xs text-slate-400 mt-0.5 leading-relaxed">${desc}</p>
      </div>
    </div>`;
}

function callout(kind: 'info' | 'tip' | 'warn', title: string, body: string): string {
  const palette =
    kind === 'tip'
      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
      : kind === 'warn'
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
        : 'bg-sky-500/10 border-sky-500/30 text-sky-100';
  const icon = kind === 'tip' ? 'fa-circle-check' : kind === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info';
  return `
    <div class="${palette} border rounded-xl p-4 text-xs leading-relaxed mt-3">
      <p class="font-semibold mb-1"><i class="fa-solid ${icon} mr-1"></i>${title}</p>
      <p class="opacity-90">${body}</p>
    </div>`;
}

function table(headers: string[], rows: string[][]): string {
  return `
    <div class="overflow-x-auto mt-3 rounded-xl border border-slate-700">
      <table class="w-full text-left text-xs">
        <thead class="bg-slate-900/80 text-slate-300 border-b border-slate-700 uppercase font-semibold">
          <tr>${headers.map((h) => `<th class="p-3 whitespace-nowrap">${h}</th>`).join('')}</tr>
        </thead>
        <tbody class="divide-y divide-slate-700">
          ${rows.map((r) => `<tr class="hover:bg-slate-750/50">${r.map((c) => `<td class="p-3 text-slate-300">${c}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ------------------------------------------------------------------------ */
/* Rute                                                                      */
/* ------------------------------------------------------------------------ */

export function registerGuideRoute<E extends { Bindings: object }>(app: Hono<E>): void {
  app.get('/panduan', (c) =>
    c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panduan Penggunaan - Gemini Edge Deployer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans">
  <nav class="bg-slate-800/80 border-b border-slate-700/60 p-4 sticky top-0 z-40 backdrop-blur">
    <div class="max-w-3xl mx-auto flex justify-between items-center">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white">
          <i class="fa-solid fa-cloud-bolt"></i>
        </div>
        <h1 class="text-base font-bold text-white">Panduan Penggunaan</h1>
      </div>
      <a href="/" class="text-xs bg-slate-700 hover:bg-orange-600 px-3 py-1.5 rounded-lg text-slate-200 transition"><i class="fa-solid fa-house mr-1"></i> Dashboard</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto p-6 space-y-8">

    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-5">
      <p class="text-sm text-slate-300 leading-relaxed">
        Aplikasi ini mengubah <b class="text-white">kisi-kisi atau materi</b> menjadi <b class="text-white">aplikasi kuis online</b> yang bisa dibagikan ke siswa lewat tautan. Penulisan soal dilakukan oleh <b class="text-white">Gem Gemini</b> di <code class="text-amber-300 font-mono">gemini.google.com</code>; aplikasi ini yang mengubah hasilnya jadi kuis siap pakai — lengkap dengan penyimpanan jawaban, penilaian otomatis di server, panel gambar, editor soal, dan rekap nilai.
      </p>
      <div class="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-center">
        <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700"><div class="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold mx-auto mb-1.5">1</div><p class="text-[11px] text-slate-300 leading-snug">Gem Gemini menulis JSON soal</p></div>
        <div class="text-slate-600 flex items-center justify-center"><i class="fa-solid fa-arrow-right"></i></div>
        <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700"><div class="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold mx-auto mb-1.5">2</div><p class="text-[11px] text-slate-300 leading-snug">Tempel JSON di Dashboard &rarr; Publikasikan</p></div>
        <div class="text-slate-600 flex items-center justify-center"><i class="fa-solid fa-arrow-right"></i></div>
        <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700"><div class="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold mx-auto mb-1.5">3</div><p class="text-[11px] text-slate-300 leading-snug">Isi gambar dengan Gemini / Foto</p></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-center">
        <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700"><div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold mx-auto mb-1.5">4</div><p class="text-[11px] text-slate-300 leading-snug">Edit soal langsung di aplikasi</p></div>
        <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700"><div class="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold mx-auto mb-1.5">5</div><p class="text-[11px] text-slate-300 leading-snug">Pantau hasil di Log Data</p></div>
      </div>
    </div>

    <section class="space-y-3">
      ${stepHeader('&sect;', 'Daftar alamat halaman', 'Semua menu guru berada di belakang login dashboard. Halaman siswa tidak perlu login.')}
      ${table(
        ['Halaman', 'Alamat', 'Untuk siapa'],
        [
          ['Dashboard', '<code class="font-mono text-amber-300">/</code>', 'Guru (login dengan kata sandi)'],
          ['Halaman kuis siswa', '<code class="font-mono text-amber-300">/p/&lt;slug&gt;</code>', 'Siswa (tanpa login)'],
          ['Panel gambar soal', '<code class="font-mono text-amber-300">/p/&lt;slug&gt;/media</code>', 'Guru'],
          ['Editor soal', '<code class="font-mono text-amber-300">/p/&lt;slug&gt;/edit</code>', 'Guru'],
          ['Log data &amp; analisis', '<code class="font-mono text-amber-300">/p/&lt;slug&gt;/data</code>', 'Guru'],
          ['Koreksi esai', '<code class="font-mono text-amber-300">/p/&lt;slug&gt;/essay</code>', 'Guru'],
        ]
      )}
      <p class="text-xs text-slate-500">&lt;slug&gt; adalah judul aplikasi yang diketik di dashboard (huruf kecil, spasi jadi tanda hubung), mis. <code class="font-mono">kuis-ipa-fotosintesis</code>.</p>
    </section>

    <section class="space-y-3">
      <div>${stepHeader('1', 'Buat soal dengan Gem Gemini', 'Gem sudah diprogram menulis soal dalam format JSON yang dikenali aplikasi.')}</div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-xs text-slate-300 leading-relaxed">Buka Gem pembuat soal, lalu ketik <b class="text-white">permintaan</b> secukupnya. Makin rinci makin tepat hasilnya: sebutkan jumlah soal, tipe, tema, kelas, proporsi, dan bagian yang butuh gambar.</p>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 leading-relaxed">
          Contoh:<br>
          <span class="text-slate-400 italic">&ldquo;Buatkan asesmen TKA Akidah Akhlak kelas 1: 15 pilihan ganda (A&ndash;E), 4 benar/salah, dan 3 isian singkat. Sertakan 2 soal bergambar tentang anggota tubuh. Skor maksimal 100.&rdquo;</span>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed">Gem menjawab dengan <b class="text-white">Ringkasan Asesmen</b> (jumlah &amp; jenis soal, ranah kognitif, daftar gambar yang perlu diunggah) plus <b class="text-white">satu blok JSON</b> — blok JSON inilah yang ditempel ke dashboard.</p>
        <a href="${GEM_URL}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl text-xs font-semibold text-white transition">
          <i class="fa-brands fa-google"></i> Buka Gem Pembuat Soal
        </a>
      </div>
      ${callout('info', 'Soal bergambar &amp; nama slot', 'Gem tidak bisa membuat file gambar. Untuk soal bergambar, Gem hanya menulis <b>nama slot</b> seperti <code class="font-mono text-amber-300">"image": "media:tumbuhan"</code>. Fotonya diisi guru di <b>panel Gambar</b> (Langkah 3). Daftar slot otomatis muncul di <code class="font-mono">/p/&lt;slug&gt;/media</code> beserta status sudah ada / belum diunggah.')}
    </section>

    <section class="space-y-3">
      <div>${stepHeader('2', 'Publikasikan ke dashboard', 'Tempel JSON dari Gem, pilih mode JSON Soal, lalu tekan Publikasikan.')}</div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <ol class="list-decimal list-inside text-xs text-slate-300 space-y-1.5 leading-relaxed">
          <li>Buka dashboard (<code class="font-mono text-amber-300">/</code>) dan login dengan kata sandi guru.</li>
          <li>Pilih mode <b>JSON Soal</b> — aplikasi kuis dibuatkan otomatis: identitas siswa, penilaian di server, rekap, analisis butir, editor soal, dan koreksi esai.</li>
          <li>Salin seluruh blok JSON dari Gem (dari <code class="font-mono">{</code> sampai <code class="font-mono">}</code>), tempel ke kolom <b>Isi (kode atau JSON soal)</b>.</li>
          <li>Isi <b>Judul Aplikasi</b> (jadi alamat <code class="font-mono">/p/... </code>). Boleh dikosongkan bila JSON sudah punya <code class="font-mono">title</code>.</li>
          <li>Klik <b>Publikasikan ke URL</b>.</li>
        </ol>
        <p class="text-xs text-slate-400 leading-relaxed">Aplikasi muncul di <b>Daftar Aplikasi Aktif</b> dengan kartu berisi tombol <b>Edit</b>, <b>Gambar</b>, <b>Log Data</b>, Buka, dan Hapus. Siswa sudah bisa mengerjakan di <code class="font-mono">/p/&lt;slug&gt;</code> sekarang juga.</p>
      </div>
    </section>

    <section class="space-y-3">
      <div>${stepHeader('3', 'Isi / generate gambar soal', 'Tiga cara mengisi foto untuk tiap slot gambar.')}</div>
      <p class="text-xs text-slate-400 leading-relaxed">Buka tombol <b>Gambar</b> pada kartu aplikasi (atau <code class="font-mono">/p/&lt;slug&gt;/media</code>). Tiap slot ditandai <b>Sudah ada</b> / <b>Belum diunggah</b>. Slot kosong tampil sebagai kotak &ldquo;Gambar belum diunggah&rdquo; di halaman siswa — kuis tetap bisa dikerjakan.</p>

      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-sm font-semibold text-white flex items-center gap-2"><i class="fa-solid fa-wand-magic-sparkles text-violet-400"></i> <span class="text-sm">3a. Generate AI langsung dari panel</span></p>
        <p class="text-xs text-slate-300 leading-relaxed">Tersedia bila ada API gambar terpasang (bawaan admin atau <b>Pakai API gambar sendiri / BYOK</b>). Klik <b>AI</b> pada kartu slot: kotak prompt sudah <b>terisi otomatis dari konteks soal</b> (boleh diedit), pilih model, klik <b>Buat Gambar</b>, tunggu 10&ndash;30 detik — hasil langsung tersimpan ke slot itu. Batas 6 gambar per menit per aplikasi.</p>
      </div>

      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-sm font-semibold text-white flex items-center gap-2"><i class="fa-solid fa-google text-blue-300"></i> <span class="text-sm">3b. Generate dengan Gemini (akun kamu) — kualitas terbaik</span></p>
        <ol class="list-decimal list-inside text-xs text-slate-300 space-y-1.5 leading-relaxed">
          <li>Di kartu slot klik <b>Buka di Gemini</b> (langsung membuka <code class="font-mono">gemini.google.com</code> dengan prompt terkirim otomatis) atau <b>Salin prompt Gemini</b> lalu tempel di Gemini.</li>
          <li>Gemini membuat gambar sesuai konteks soal.</li>
          <li><b>Unduh</b> hasilnya, lalu unggah lewat <b>Pilih / Potret Foto</b> pada kartu slot yang sama.</li>
        </ol>
      </div>

      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-sm font-semibold text-white"><i class="fa-solid fa-camera text-orange-400 mr-2"></i><span class="text-sm">3c. Foto sendiri</span></p>
        <p class="text-xs text-slate-300 leading-relaxed">Klik <b>Pilih / Potret Foto</b> — di HP browser menawarkan kamera atau galeri. Foto otomatis diperkecil (maks 1600 px) dan dikonversi ke <b>WebP</b> di perangkat, kuota jadi hemat. Batas 8 MB; format diterima: JPG, PNG, GIF, WebP, AVIF, BMP. <b>SVG tidak diterima.</b></p>
      </div>

      ${callout('tip', 'Ganti gambar tanpa publish ulang', 'Unggah ulang dengan <b>nama slot yang sama</b> — URL-nya tidak berubah, siswa langsung melihat versi baru. Kalau gambar lama masih kelihatan, muat ulang dengan Ctrl+Shift+R.')}
    </section>

    <section class="space-y-3">
      <div>${stepHeader('4', 'Edit soal langsung di aplikasi', 'Perbaikan kecil tidak perlu bolak-balik ke Gem.')}</div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-xs text-slate-300 leading-relaxed">Klik <b>Edit</b> pada kartu aplikasi (khusus mode <b>JSON Soal</b>) → halaman <code class="font-mono">/p/&lt;slug&gt;/edit</code>. Yang bisa dilakukan: ubah teks soal, pilihan, kunci, dan bobot; tambah / hapus / duplikat / geser urutan soal; <b>ganti tipe soal</b>; isi atau ganti nama slot gambar.</p>
        <p class="text-xs text-slate-400 leading-relaxed">Tiap tipe punya editor sendiri, jadi tidak perlu menghafal struktur JSON:</p>
        ${table(
          ['Tipe', 'Yang diedit di editor'],
          [
            ['<code class="font-mono text-amber-300">category</code>', 'daftar pernyataan + radio Benar/Salah, dan judul kolom'],
            ['<code class="font-mono text-amber-300">matching</code>', 'pasangan kiri → kanan (kolom kanan diacak otomatis untuk siswa)'],
            ['<code class="font-mono text-amber-300">ordering</code>', 'daftar langkah dalam urutan yang benar'],
            ['<code class="font-mono text-amber-300">table_fill</code>', 'judul kolom + tabel; sel rumpang ditulis <code class="font-mono">{327}</code> atau <code class="font-mono">{1085 / 1.085}</code>'],
            ['<code class="font-mono text-amber-300">two_tier</code>', 'daftar pernyataan + daftar alasan, masing-masing satu kunci'],
            ['<code class="font-mono text-amber-300">highlight</code>', 'bacaan dengan kata diapit <code class="font-mono">{ }</code>, lalu daftar kata yang benar'],
            ['<b>semua tipe</b>', 'judul & teks bacaan (stimulus) yang tampil di atas kartu soalnya — bisa diedit per soal'],
          ]
        )}
        <p class="text-xs text-slate-400 leading-relaxed">Saat disimpan, JSON divalidasi ulang dan halaman kuis digambar ulang — siswa melihat versi baru di <b>alamat yang sama</b>, jawaban yang masuk tidak berubah. Mode <b>HTML/React</b> tidak bisa diedit di sini; perbaikannya lewat Gemini lalu deploy ulang.</p>
      </div>
    </section>

    <section class="space-y-3">
      <div>${stepHeader('5', 'Pantau hasil', 'Rekap nilai, analisis butir soal, dan koreksi esai.')}</div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-sm font-semibold text-white"><i class="fa-solid fa-table-list text-emerald-400 mr-2"></i><span class="text-sm">Log Data</span> — <code class="font-mono text-xs text-amber-300">/p/&lt;slug&gt;/data</code></p>
        <ul class="list-disc list-inside text-xs text-slate-300 space-y-1 leading-relaxed">
          <li><b>Rekap nilai per siswa</b> + detail payload tiap kiriman.</li>
          <li><b>Analisis butir soal</b> otomatis: tingkat kesukaran, daya beda, sebaran pengecoh, bagian tersering keliru. Butuh minimal 8 peserta untuk daya beda.</li>
          <li>Tombol <b>Unduh CSV</b> untuk laporan di Excel / Google Sheets.</li>
        </ul>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <p class="text-sm font-semibold text-white"><i class="fa-solid fa-pen-to-square text-amber-400 mr-2"></i><span class="text-sm">Koreksi Esai</span> — <code class="font-mono text-xs text-amber-300">/p/&lt;slug&gt;/essay</code></p>
        <ul class="list-disc list-inside text-xs text-slate-300 space-y-1 leading-relaxed">
          <li>Pengingat oranye muncul kalau ada esai belum dinilai.</li>
          <li>Tombol <b>Nilai penuh</b> / tekan Enter untuk menyimpan cepat.</li>
          <li><b>Nilai objektif</b> dihitung otomatis saat siswa mengirim; <b>nilai akhir</b> muncul setelah semua esai di kiriman itu dinilai.</li>
        </ul>
      </div>
    </section>

    <section class="space-y-3">
      <div>${stepHeader('&quest;', 'Tips &amp; FAQ', 'Hal-hal singkat yang sering ditanyakan.')}</div>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <ul class="list-disc list-inside text-xs text-slate-300 space-y-1.5 leading-relaxed">
          <li><b>Halaman siswa tidak butuh login</b> — cukup bagikan tautan <code class="font-mono">/p/&lt;slug&gt;</code>.</li>
          <li><b>Penilaian di server</b> — skor tidak bisa dipalsukan dari browser siswa.</li>
          <li><b>Siswa sempat refresh/padam listrik?</b> Jawaban tersimpan otomatis di perangkat; saat dibuka lagi muncul tawaran <b>Lanjutkan / Mulai baru</b>.</li>
          <li><b>Mau ganti foto?</b> Cukup unggah ulang dengan nama slot sama di panel Gambar.</li>
          <li><b>Soal menyimpang?</b> Klik <b>Edit</b> — tidak perlu meminta Gem menulis ulang.</li>
        </ul>
      </div>
    </section>

    <p class="text-center text-[11px] text-slate-600">Versi panduan lengkap juga tersedia sebagai berkas <code class="font-mono">docs/panduan-pakai.md</code> di repository.</p>
  </main>
</body>
</html>`)
  );
}