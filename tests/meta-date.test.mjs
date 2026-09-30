// Uji logika tanggal di src/quiz-util.ts: parsing cap waktu yang disimpan di KV
// (dua bentuk: tanggal-saja dari data lama, ISO penuh dari data baru) dan label
// "Hari ini" / "Kemarin" / "N hari lalu" yang dipakai di sidebar.
//
// Ikuti pola tests/quiz.test.mjs: helper check() sendiri lalu process.exit
// berdasarkan penghitung kegagalan, supaya bisa dijalankan terpisah maupun
// dirangkai di package.json.
import { formatRecordStamp, parseStamp, relTime, stampNow } from '../src/quiz-util.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)})`}`);
};

// Zona waktu label. Semua cap waktu di bawah ditulis eksplisit supaya hasil
// tidak ikut berubah kalau jam mesin tempat tes ini dijalankan.
const WIB = (iso) => Date.parse(iso);

// Tanggal acuan: 27 Sep 2026 pukul 10:00 WIB (= 03:00 UTC).
const NOW = WIB('2026-09-27T03:00:00.000Z');

/* -------------------------------------------------------------------------- */
/* parseStamp                                                                 */
/* -------------------------------------------------------------------------- */

check('parseStamp: ISO penuh dibaca apa adanya', parseStamp('2026-09-27T14:32:00.000Z'), Date.parse('2026-09-27T14:32:00.000Z'));
check('parseStamp: tanggal-saja (data lama) = UTC tengah malam', parseStamp('2026-09-27'), Date.parse('2026-09-27T00:00:00.000Z'));
check('parseStamp: ada spasi di sekeliling', parseStamp('  2026-09-27  '), Date.parse('2026-09-27T00:00:00.000Z'));
check('parseStamp: string kosong -> 0', parseStamp(''), 0);
check('parseStamp: null -> 0', parseStamp(null), 0);
check('parseStamp: undefined -> 0', parseStamp(undefined), 0);
// Cap waktu datang dari `JSON.parse` metadata di KV, jadi selalu string atau
// tidak ada sama sekali. Angka epoch sengaja TIDAK diterima: kalau diizinkan,
// salah simpan jadi epoch akan lolos diam-diam dan kuis itu meleset ke urutan
// paling bawah. Lebih baik ketahuan dari sini.
check('parseStamp: angka epoch ditolak -> 0', parseStamp(1758986), 0);
check('parseStamp: objek -> 0', parseStamp({}), 0);
check('parseStamp: tekssampah -> 0', parseStamp('bukan tanggal'), 0);
check('parseStamp: tidak melempar untuk input aneh', (() => { try { parseStamp([]); return 'aman'; } catch { return 'lempar'; } })(), 'aman');

check('stampNow: bentuk ISO penuh dengan jam', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stampNow()), true);
check('stampNow: bisa langsung dibaca parseStamp', parseStamp(stampNow()) > 0, true);

/* -------------------------------------------------------------------------- */
/* relTime                                                                   */
/* -------------------------------------------------------------------------- */

check('relTime: dibuat hari ini', relTime('2026-09-27T01:00:00.000Z', NOW), 'Hari ini');
check('relTime: dibuat kemarin', relTime('2026-09-26T01:00:00.000Z', NOW), 'Kemarin');
check('relTime: tiga hari lalu', relTime('2026-09-24T01:00:00.000Z', NOW), '3 hari lalu');
check('relTime: enam hari lalu masih relatif', relTime('2026-09-21T01:00:00.000Z', NOW), '6 hari lalu');
check('relTime: tepat tujuh hari -> tanggal', relTime('2026-09-20T01:00:00.000Z', NOW), '20 Sep 2026');
check('relTime: sebulan lalu -> tanggal', relTime('2026-08-27T01:00:00.000Z', NOW), '27 Agu 2026');
check('relTime: tanggal-saja milik kuis lama tetap terbaca', relTime('2026-09-27', NOW), 'Hari ini');
check('relTime: tanggal-saja 30 hari lalu', relTime('2026-08-28', NOW), '28 Agu 2026');

// Regresi zona waktu: cap waktu disimpan sebagai UTC, tapi label harus mengikuti
// kalender WIB. Kuis yang dibuat pukul 01:00 WIB (= 18:00 UTC hari sebelumnya)
// tetap "Hari ini" sepanjang hari tersebut, dan baru jadi "Kemarin" lewat
// tengah malam WIB — bukan berganti label di tengah hari.
const DIBUAT_01_WIB = '2026-09-26T18:00:00.000Z'; // 27 Sep, 01:00 WIB
const LEWAT_TENGAH_MALAM = WIB('2026-09-27T17:30:00.000Z'); // 28 Sep, 00:30 WIB
check('relTime: 01:00 WIB tetap "Hari ini" di jam 10:00 WIB', relTime(DIBUAT_01_WIB, NOW), 'Hari ini');
check('relTime: 01:00 WIB jadi "Kemarin" lewat tengah malam WIB', relTime(DIBUAT_01_WIB, LEWAT_TENGAH_MALAM), 'Kemarin');
check('relTime: 23:00 WIB tetap "Hari ini" walau cap waktunya besok', relTime('2026-09-27T16:00:00.000Z', NOW), 'Hari ini');

// Data lama belum punya `updated_at` sama sekali. Harus balik string kosong,
// bukan undefined: `check` membandingkan lewat JSON.stringify, jadi undefined
// akan dianggap beda dari '' dan menutupi kesalahan di pemanggil.
check('relTime: updated_at tidak ada -> string kosong', relTime(undefined, NOW), '');
check('relTime: updated_at kosong -> string kosong', relTime('', NOW), '');
check('relTime: updated_at rusak -> string kosong', relTime('entah', NOW), '');
check('relTime: tanpa argumen now tidak melempar', (() => { try { relTime('2026-09-01'); return 'aman'; } catch { return 'lempar'; } })(), 'aman');

/* -------------------------------------------------------------------------- */
/* Urutan sidebar                                                            */
/* -------------------------------------------------------------------------- */

// Sama persis dengan src/index.ts: urutan dashboard ditulis dengan
// parseStamp(created_at) descending, jadi sort di sini harus mencerminkannya.
const urut = (list) => [...list].sort((a, b) => parseStamp(b.created_at) - parseStamp(a.created_at)).map((a) => a.slug);

check(
  'urutan: terbaru dulu',
  urut([
    { slug: 'januari', created_at: '2026-01-05T00:00:00.000Z' },
    { slug: 'september', created_at: '2026-09-20T14:00:00.000Z' },
    { slug: 'mei', created_at: '2026-05-11T09:30:00.000Z' },
  ]),
  ['september', 'mei', 'januari']
);

check(
  'urutan: kuis dibuat di hari sama tidak tertukar oleh sorting tanggal-saja',
  urut([
    { slug: 'pagi', created_at: '2026-09-27' },
    { slug: 'sore', created_at: '2026-09-27' },
  ]),
  ['pagi', 'sore']
);

check(
  'urutan: aplikasi tanpa created_at Sortir ke paling bawah',
  urut([
    { slug: 'tanpa-tanggal' },
    { slug: 'lama', created_at: '2020-01-01T00:00:00.000Z' },
  ]),
  ['lama', 'tanpa-tanggal']
);

check('urutan: daftar kosong aman', urut([]), []);

/* -------------------------------------------------------------------------- */
/* formatRecordStamp                                                          */
/* -------------------------------------------------------------------------- */

// `app_records.created_at` diisi `DEFAULT CURRENT_TIMESTAMP` di D1, jadi
// bentuknya `YYYY-MM-DD HH:MM:SS` TANPA penanda zona dan selalu UTC. Semua
// di bawah menuliskan bentuk itu persis, bukan ISO, supaya tesnya naik kalau
// skema D1 berubah.
//
// Konversi ke WIB harus tepat 7 jam, dan melintasi tengah malam harus ikut
// menggeser HARI dan TAHUN, bukan cuma jam.

check('formatRecordStamp: D1 +7 jam', formatRecordStamp('2026-03-01 08:00:00'), '1 Mar 2026, 15:00 WIB');
check('formatRecordStamp: melintasi tengah malam menggeser hari', formatRecordStamp('2026-03-01 17:00:00'), '2 Mar 2026, 00:00 WIB');
check('formatRecordStamp: tengah malam menggeser bulan dan tahun', formatRecordStamp('2025-12-31 17:00:00'), '1 Jan 2026, 00:00 WIB');
check('formatRecordStamp: jam satu digit tetap dua digit', formatRecordStamp('2026-03-01 00:00:00'), '1 Mar 2026, 07:00 WIB');
check('formatRecordStamp: menit tidak hilang', formatRecordStamp('2026-03-01 08:05:00'), '1 Mar 2026, 15:05 WIB');
check('formatRecordStamp: dua digit jam, nol di depan', formatRecordStamp('2026-09-01 00:00:00'), '1 Sep 2026, 07:00 WIB');

// Bentuk bersuffix Z sudah punya zona, jadi TIDAK boleh digeser lagi. Ini
// regresi yang paling mungkin muncul kalau ada penyesuaian di kemudian hari.
check('formatRecordStamp: ISO dengan Z tidak digeser dua kali', formatRecordStamp('2026-03-01T08:00:00.000Z'), '1 Mar 2026, 15:00 WIB');
check('formatRecordStamp: offset eksplisit dipakai apa adanya', formatRecordStamp('2026-03-01T15:00:00+07:00'), '1 Mar 2026, 15:00 WIB');

// Nilai rusak harus jadi string kosong, bukan "NaN" atau "Invalid Date".
// D1 bisa mengembalikan NULL di kolom mana pun, dan `String(null)` adalah
// "null" — tanpa guard ini satu baris bisa menggagalkan seluruh halaman.
check('formatRecordStamp: null -> kosong', formatRecordStamp(null), '');
check('formatRecordStamp: undefined -> kosong', formatRecordStamp(undefined), '');
check('formatRecordStamp: string kosong -> kosong', formatRecordStamp(''), '');
check('formatRecordStamp: spasi saja -> kosong', formatRecordStamp('   '), '');
check('formatRecordStamp: teks sampah -> kosong', formatRecordStamp('bukan tanggal'), '');
check('formatRecordStamp: tidak melempar untuk input aneh', (() => { try { formatRecordStamp([]); return 'aman'; } catch { return 'lempar'; } })(), 'aman');
check('formatRecordStamp: hasil tidak pernah memuat NaN', /NaN/.test(formatRecordStamp('bukan tanggal')), false);

// Tiga tempat yang menampilkan cap waktu kiriman harus lewat helper ini.
// Dicek dari teks sumber, bukan dari output, supaya ada yang menahan kalau ada
// yang kembali men-cetak cap waktu mentah.
//
// Polanya harus menerima `created_at` (D1) maupun `createdAt` (payload halaman
// esai) — dua nama yang berbeda untuk hal yang sama.
const rawStamp = /escapeHtml\(\s*(?:[A-Za-z_$][\w$]*\.)?created_?[aA]t\s*\)/;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['src/records.ts', 'src/record-detail.ts', 'src/quiz-essay.ts']) {
  const src = readFileSync(path.join(root, rel), 'utf8');
  check(`${rel}: pakai formatRecordStamp`, src.includes('formatRecordStamp('), true);
  check(`${rel}: tidak lagi mencetak cap waktu mentah`, rawStamp.test(src), false);
}

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
