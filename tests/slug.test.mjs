// Uji logika slug di src/quiz-util.ts: pola sufiks acak 4 karakter yang dipakai
// uniqueSlug() di src/index.ts ketika alamat publish sudah dipakai.
//
// Sufiks ini dibaca guru dari URL dan diketik ulang ke sheet jawaban, jadi
// bentuknya dijaga ketat: huruf pertama (bukan angka, biar slug tetap memulai
// kata) dan tanpa karakter yangeasy salah baca atau salah ketik (i l o 0 1).
//
// Ikuti pola tests/quiz.test.mjs: helper check() sendiri lalu process.exit
// berdasarkan penghitung kegagalan, supaya bisa dijalankan terpisah maupun
// dirangkai di package.json.
import { randomSlugSuffix } from '../src/quiz-util.ts';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)})`}`);
};

const FIRST_LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const BODY_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

const SAMPLES = 800;
const suffixes = [];
for (let i = 0; i < SAMPLES; i += 1) suffixes.push(randomSlugSuffix());

check('jumlah sampel', suffixes.length, SAMPLES);
check(
  'semua sufiks panjang 4',
  suffixes.filter((s) => s.length !== 4).length,
  0
);
check(
  'huruf pertama selalu huruf kecil',
  suffixes.filter((s) => !FIRST_LETTERS.includes(s[0])).length,
  0
);
check(
  'tiga karakter terakhir dari alfabet aman',
  suffixes.filter((s) => [...s.slice(1)].some((c) => !BODY_CHARS.includes(c))).length,
  0
);
check(
  'tidak ada karakter ambigu i l o 0 1',
  suffixes.filter((s) => [...s].some((c) => 'ilo01'.includes(c))).length,
  0
);
check(
  'seluruh karakter dari alfabet yang diizinkan',
  suffixes.filter((s) => [...s].some((c) => !FIRST_LETTERS.includes(c) && !BODY_CHARS.includes(c))).length,
  0
);
check(
  'suffix yang sama tidak muncul terus-menerus (acak, bukan konstanta)',
  new Set(suffixes).size > 1,
  true
);

// Sebaran: huruf pertama digambar dari 25 huruf, badan dari 31 karakter. Kalau
// implementasi diam-diam jadi konstanta atau huruf pertama selalu terkunci ke
// satu nilai, sebaran huruf pertama langsung terlihat bolong.
const firstChars = new Set(suffixes.map((s) => s[0]));
check('huruf pertama bervariasi, tidak terkunci ke satu nilai', firstChars.size > 5, true);
check(
  'sebagian besar huruf awal terpakai',
  firstChars.size >= 15,
  true
);

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
