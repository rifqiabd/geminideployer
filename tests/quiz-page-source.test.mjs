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

// Penjaga kedua: penjaga render untuk umpan balik per butir harus tetap `=== true`
// (fail-closed). Kalau dibalik jadi `!== false`, halaman html:<slug> versi lama
// yang CFG-nya tidak punya flag ini ikut menampilkan badge, padahal flag-nya tidak
// pernah ada di sana. Tidak boleh ada backtick, makanya ditulis polos.
const feedbackGuard = lines.find((line) => line.includes('var withFeedback = CFG.showItemFeedback'));
check('penjaga render umpan balik per butir ada', typeof feedbackGuard, 'string');
check(
  'penjaga render tetap fail-closed (=== true)',
  typeof feedbackGuard === 'string' && feedbackGuard.includes('=== true') && !feedbackGuard.includes('!== false'),
  true
);

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
