// Pemeriksaan sumber untuk src/quiz-page.ts, TANPA meng-import apa pun dari
// src/.
//
// Kenapa harus suite terpisah: skrip klien di quiz-page.ts ditulis DI DALAM
// template literal. Satu backtick di komentar atau string di region itu
// menutup template lebih awal, dan modul .ts-nya jadi gagal di-import. Karena
// file ini tidak meng-import quiz-page.ts, suite lain yang meng-import-nya tetap
// bisa jalan dan melaporkan/memperbaiki masalahnya sendiri.
//
// Gejalanya tanpa pemeriksaan ini buruk: error-nya muncul sebagai "true is not
// a function" atau "Expected ';', got 'ident'" yang menunjuk ke baris dalam
// template, bukan ke baris backtick-nya. Suite ini yang membuat penyebabnya
// kelihatan langsung.
//
// Backtick di komentar itu gaya rumah di src/ (64 baris di luar template), jadi
// yang diperiksa HANYA region antara <script> polos dan </script> pertama — satu
//-satunya tempat backtick benar-benar merusak.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)})`}`);
};

const BACKTICK = String.fromCharCode(96);
const source = readFileSync(new URL('../src/quiz-page.ts', import.meta.url), 'utf8');
const lines = source.split(/\r?\n/);

// <script> polos = skrip inline milik kita. Tag yang punya src= adalah pustaka
// pihak ketiga (KaTeX, highlight.js) dan memang berada di luar template klien.
const start = lines.findIndex((line) => line.includes('<script>') && !line.includes('src='));
const end = lines.findIndex((line, i) => i > start && line.includes('</script>'));

check('region skrip klien di quiz-page.ts terdeteksi', start > 0 && end > start, true);

const offenders = [];
if (start > 0 && end > start) {
  for (let i = start; i <= end; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith('//') && line.includes(BACKTICK)) {
      offenders.push(`baris ${i + 1}: ${line.trim()}`);
    }
  }
}

check(
  'komentar di dalam template literal tidak boleh pakai backtick',
  offenders,
  []
);

// Penjaga kedua: keputusan render umpan balik per butir TIDAK BOLEH membaca
// CFG. CFG di dalam html:<slug> dibekukan saat guru menyimpan, sedangkan
// /api/submit membaca quiz:<slug> ulang tiap request. Begitu default sakelar
// diubah di kode, kuis yang sudah dipublish punya CFG lama tapi server sudah
// mengirim `benar` — hasil akhirnya data terkirim ke siswa sementara badge tidak
// tampil, dan guru mengira tidak ada yang berubah. Badge harus ditentukan
// keberadaan field `benar` di respons, karena itu server sudah menyaringnya.
//
// Flag ini pernah ada di CFG dan pernah jadi penjaga render. Assertion di bawah
// sengaja mengunci penghapusannya supaya tidak ada yang mengembalikannya.
const cfgFeedbackUses = lines
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => line.includes('CFG.showItemFeedback'))
  .map(([no, line]) => `baris ${no}: ${line.trim()}`);

check(
  'render tidak pernah membaca sakelar umpan balik dari CFG',
  cfgFeedbackUses,
  []
);

// Sadari bahwa baris komentar di atas sengaja menyebut CFG.showItemFeedback, jadi
// filter di atas harus menolak komentar juga — kalau tidak assertion ini akan
// salah merah setiap kali komentarnya ditambah.
const cfgCodeUses = lines
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => !line.trim().startsWith('//') && line.includes('CFG.showItemFeedback'))
  .map(([no, line]) => `baris ${no}: ${line.trim()}`);
check('tidak ada kode yang memakai CFG.showItemFeedback', cfgCodeUses, []);

// Badge harus tetap dirender dari keberadaan field, bukan dari flag.
const badgeGuard = lines.find((line) => line.includes("if ('benar' in item)"));
check('penjaga badge berdasar keberadaan field benar', typeof badgeGuard, 'string');
check(
  'penjaga badge tidak digabung dengan flag apa pun',
  typeof badgeGuard === 'string' && badgeGuard.trim() === "if ('benar' in item) {",
  true
);

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
