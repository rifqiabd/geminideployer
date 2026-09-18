// Uji cepat logika src/quiz.ts tanpa deploy: normalisasi jawaban Arab,
// deteksi fitur (tabel/rumus/arab), dan penilaian.
import {
  parseQuizSpec,
  gradeSubmission,
  renderQuizApp,
  collectMediaSlots,
  mediaBaseFor,
  parseQuizJson,
  quizToAuthoringSource,
  resolveMediaUrl,
  sanitizeMediaName,
} from '../src/quiz.ts';
import { MAX_MEDIA_BYTES, mediaPlaceholder, sniffImageType, suggestMediaName } from '../src/media.ts';
import { computeItemAnalysis, renderItemAnalysis } from '../src/quiz-report.ts';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)})`}`);
};

const spec = parseQuizSpec(
  JSON.stringify({
    title: 'Uji Lokal',
    description: '| Kolom | Isi |\n| --- | --- |\n| a | b |',
    passing_score: 70,
    questions: [
      { type: 'short', question: 'Tulislah lafal tahlil!\n\nلا إله إلا الله', answer: ['لا إله إلا الله'] },
      { type: 'short', question: 'Berapa rakaat?', answer: ['3'] },
      { type: 'short', question: 'Tulis kalimat tasbih.', answer: ['سُبْحَانَ اللهِ'] },
      { type: 'choice', question: 'Pilih yang terbesar dari $\\frac{1}{2}$ dan 0,6.', options: ['10', '20', '30'], answer: '20' },
      { type: 'multi', question: 'Pilih semua yang benar.', options: ['a', 'b', 'c'], answer: ['a', 'c'] },
      { type: 'true_false', question: 'Benar atau salah?', answer: 'benar' },
      { type: 'essay', question: 'Uraikan.', points: 5 },
    ],
  })
);

check('fitur terdeteksi (table)', spec.features.includes('table'), true);
check('fitur terdeteksi (math)', spec.features.includes('math'), true);
check('fitur terdeteksi (arabic)', spec.features.includes('arabic'), true);

const grade = (answers) => gradeSubmission(spec, answers);

const g1 = grade([
  { id: 'q1', value: 'لا اله الا الله' }, // tanpa hamza
  { id: 'q2', value: '٣' }, // angka Arab
  { id: 'q3', value: 'سبحان الله' }, // tanpa harakat
  { id: 'q4', value: 1 }, // "20" = indeks 1
  { id: 'q5', value: [0, 2] },
  { id: 'q6', value: true },
  { id: 'q7', value: 'Uraian siswa.' },
]);
check('q1 arab tanpa hamza', g1.detail[0].benar, true);
check('q2 angka Arab vs 3', g1.detail[1].benar, true);
check('q3 arab tanpa harakat', g1.detail[2].benar, true);
check('q4 opsi berupa angka', g1.detail[3].benar, true);
check('q5 multi jawaban', g1.detail[4].benar, true);
check('q6 benar/salah', g1.detail[5].benar, true);
check('q7 esai belum dinilai', g1.detail[6].benar, null);
check('skor semua benar', g1.score, 100);
check('esai menunggu koreksi', g1.essay_pending, 1);

const g2 = grade([{ id: 'q5', value: [0] }]); // multi kurang satu pilihan
check('multi kurang satu = salah', g2.detail[4].benar, false);
check('q1 kosong = salah', g2.detail[0].benar, false);

const html = renderQuizApp(spec, 'uji-lokal');
check('halaman memuat tabel', html.includes('<table class="q-table">'), true);
check('halaman memuat KaTeX', html.includes('katex.min.css'), true);
check('halaman tanpa highlight.js', html.includes('highlight.min.js'), false);
check('halaman memuat font lokal', html.includes('/vendor/quiz.css'), true);
const xssSpec = parseQuizSpec(
  JSON.stringify({
    title: '<script>x</script>',
    questions: [{ type: 'choice', question: 'a < b', options: ['<img src=x onerror=alert(1)>', 'b'], answer: 'B' }],
  })
);
const xssHtml = renderQuizApp(xssSpec, 'uji-xss');
check('XSS di judul ditutup', xssHtml.includes('<script>x</script>'), false);
check('XSS di opsi ditutup', xssHtml.includes('<img src=x onerror'), false);
check('judul tetap tampil', xssHtml.includes('&lt;script&gt;x&lt;/script&gt;'), true);

// ---------- Soal bergambar: token media:<slot> ----------
const gambarSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Kuis Bergambar',
    questions: [
      { type: 'choice', question: 'Perhatikan gambar berikut!', image: 'media:tumbuhan', options: ['Fotosintesis', 'Respirasi'], answer: 'Fotosintesis' },
      { type: 'true_false', question: 'Cermati bagan ini.\n\n![Bagan](media:bagan-2)', answer: true },
      { type: 'short', question: 'Perhatikan peta.\n\nmedia:peta-jawa', answer: ['jawa'] },
      { type: 'choice', question: 'Foto dari internet!', image: 'https://contoh.test/a.png', options: ['A', 'B'], answer: 'A' },
      { type: 'choice', question: 'Gambar nakal ![x](javascript:alert(1))', options: ['A', 'B'], answer: 'A' },
    ],
  })
);

check('fitur gambar terdeteksi', gambarSpec.features.includes('image'), true);
check('slot gambar terkumpul', collectMediaSlots(gambarSpec), ['bagan-2', 'peta-jawa', 'tumbuhan']);

const gambarHtml = renderQuizApp(gambarSpec, 'uji-gambar');
check('field image jadi /media/<slug>/<slot>', gambarHtml.includes('src="/media/uji-gambar/tumbuhan"'), true);
check('gambar di dalam teks soal', gambarHtml.includes('src="/media/uji-gambar/bagan-2"'), true);
check('token berdiri sendiri jadi gambar', gambarHtml.includes('src="/media/uji-gambar/peta-jawa"'), true);
check('URL http tetap dipakai', gambarHtml.includes('src="https://contoh.test/a.png"'), true);
check('src javascript: ditolak', /<img[^>]*javascript:/i.test(gambarHtml), false);

const gambarGrade = gradeSubmission(
  gambarSpec,
  [
    { id: 'q1', value: 'Fotosintesis' },
    { id: 'q2', value: true },
    { id: 'q3', value: 'jawa' },
    { id: 'q4', value: 'A' },
    { id: 'q5', value: 'A' },
  ],
  mediaBaseFor('uji-gambar')
);
check('pembahasan ikut memuat gambar', gambarGrade.detail[0].question_html.includes('/media/uji-gambar/tumbuhan'), true);
check('skor kuis bergambar', gambarGrade.score, 100);
check('nama aplikasi di URL media', mediaBaseFor('kuis ipa'), '/media/kuis%20ipa/');

// ---------- Keamanan nilai src ----------
check('tolak javascript:', resolveMediaUrl('javascript:alert(1)', '/media/a/'), '');
check('tolak data URI', resolveMediaUrl('data:image/png;base64,AAA', '/media/a/'), '');
check('izinkan http', resolveMediaUrl('https://x.test/a.png', '/media/a/'), 'https://x.test/a.png');
check('izinkan path internal', resolveMediaUrl('/media/a/b.png', '/media/a/'), '/media/a/b.png');
check('tolak path keluar folder', resolveMediaUrl('/media/../rahasia', '/media/a/'), '');
check('slot tanpa basis URL ditolak', resolveMediaUrl('media:tumbuhan', ''), '');
check('nama slot dilucuti dari path', sanitizeMediaName('../../etc/passwd'), 'etc-passwd');
check('nama slot tanpa spasi & huruf kecil', sanitizeMediaName('Foto Bunga 1'), 'foto-bunga-1');
check('titik pada nama slot dipertahankan', sanitizeMediaName('foto-1.jpg'), 'foto-1.jpg');
check('titik di ujung nama slot dibuang', sanitizeMediaName('.rahasia.'), 'rahasia');
check('slug dan nama slot tidak bisa bertabrakan', sanitizeMediaName('a:b'), 'a-b');

// ---------- Unggahan gambar ----------
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
check('deteksi PNG', sniffImageType(pngBytes), 'image/png');
check('deteksi JPG', sniffImageType(jpgBytes), 'image/jpeg');
check('file teks ditolak', sniffImageType(new TextEncoder().encode('<html>halo dunia</html>')), null);
check('SVG mentah ditolak', sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
check('nama dari file', suggestMediaName('Foto Bunga.JPG'), 'foto-bunga');
check('nama kosong pakai cadangan', suggestMediaName('.jpg', 'gambar'), 'gambar');
check('placeholder gambar belum diunggah', mediaPlaceholder('tumbuhan').includes('media:tumbuhan'), true);
check('batas unggahan 8 MB', MAX_MEDIA_BYTES, 8388608);

// ---------- Round-trip editor soal (normalisasi -> format tulis -> parse lagi) ----------
const rtJson = JSON.stringify(quizToAuthoringSource(gambarSpec));
const rtSpec = parseQuizSpec(rtJson);
check('round-trip: jumlah soal tetap', rtSpec.questions.length, gambarSpec.questions.length);
check('round-trip: slot gambar tetap', collectMediaSlots(rtSpec), collectMediaSlots(gambarSpec));
check(
  'round-trip: gambar cuma dirujuk sekali',
  (rtSpec.questions[0].question.match(/media:tumbuhan/g) || []).length,
  1
);
check('round-trip: kunci pilihan tetap', rtSpec.questions[0].keys, gambarSpec.questions[0].keys);
check(
  'round-trip: gambar tetap tampil di pembahasan',
  gradeSubmission(rtSpec, [{ id: 'q3', value: 'jawa' }, { id: 'q1', value: 'Fotosintesis' }, { id: 'q2', value: true }, { id: 'q4', value: 'A' }, { id: 'q5', value: 'A' }], mediaBaseFor('uji-gambar')).detail[2].question_html.includes('/media/uji-gambar/peta-jawa'),
  true
);

// Kuis "normal" (multi jawaban, isian Arab, esai) juga harus selamat lewat editor.
const specRt = parseQuizSpec(JSON.stringify(quizToAuthoringSource(spec)));
check('round-trip: kunci multi jawaban tetap', specRt.questions[4].keys, spec.questions[4].keys);
check('round-trip: kunci benar/salah tetap', specRt.questions[5].keys, spec.questions[5].keys);
check('round-trip: bobot esai tetap', specRt.questions[6].points, 5);
check('round-trip: isian Arab tetap dinilai benar', gradeSubmission(specRt, [{ id: 'q1', value: 'لا إله إلا الله' }]).detail[0].benar, true);
check('round-trip: tabel di deskripsi tetap tampil', renderQuizApp(specRt, 'uji-rt').includes('<table class="q-table">'), true);

// Field gambar boleh ditulis sebagai objek supaya ada keterangan gambarnya.
const objImage = parseQuizSpec(
  JSON.stringify({
    title: 'Obj',
    questions: [{ type: 'true_false', question: 'Lihat bagan.', image: { media: 'bagan-x', alt: 'Bagan alur' }, answer: true }],
  })
);
check('image bentuk objek terbaca', collectMediaSlots(objImage), ['bagan-x']);
check('alt dari bentuk objek dipakai', renderQuizApp(objImage, 'obj').includes('alt="Bagan alur"'), true);

check('parseQuizJson melepas pagar kode', JSON.stringify(parseQuizJson('```json{"a":1}```')), '{"a":1}');

// ---------- Analisis butir soal ----------
const reportSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Kuis Analisis',
    passing_score: 70,
    questions: [
      { type: 'choice', question: 'Soal mudah sekali', options: ['A1', 'B1', 'C1'], answer: 'A1' },
      { type: 'choice', question: 'Soal pembeda', options: ['A2', 'B2', 'C2'], answer: 'A2' },
      { type: 'essay', question: 'Uraikan', points: 5 },
    ],
  })
);

// Tiru bentuk `detail` yang disimpan server saat siswa mengirim jawaban.
function submissionOf(score, flags) {
  return {
    name: 'Siswa',
    score,
    lulus: score >= 70,
    detail: flags.map((flag, index) => ({
      no: index + 1,
      id: 'q' + (index + 1),
      type: index === 2 ? 'essay' : 'choice',
      jawaban: flag === null ? 'Uraian siswa.' : flag ? 'A. Jawaban' : 'B. Jawaban',
      benar: flag,
    })),
  };
}

const reportScores = [100, 90, 85, 80, 75, 70, 60, 55, 50, 40];
// Soal 2 benar hanya untuk 3 peserta teratas (kelompok 27% atas).
const reportPayloads = reportScores.map((score, index) => submissionOf(score, [true, index < 3, null]));
const analysis = computeItemAnalysis(reportSpec, [...reportPayloads, { name: 'mode HTML', score: 80 }]);

check('analisis: hanya kiriman bergrading dihitung', analysis.participants, 10);
check('analisis: rata-rata nilai', analysis.average, 71);
check('analisis: nilai tertinggi & terendah', [analysis.highest, analysis.lowest], [100, 40]);
check('analisis: lulus / belum / menunggu', [analysis.passed, analysis.failed, analysis.awaiting], [6, 4, 0]);
check('analisis: daya beda bisa dihitung', analysis.hasDiscrimination, true);

const [q1, q2, q3] = analysis.items;
check('analisis soal 1: semua benar', [q1.correct, q1.wrong, q1.percentCorrect], [10, 0, 100]);
check('analisis soal 1: tingkat mudah', q1.difficulty, 'Mudah');
check('analisis soal 1: catatan terlalu mudah', q1.note.includes('Terlalu mudah'), true);
check('analisis soal 1: daya beda jelek', q1.discriminationLabel, 'Jelek');
check('analisis soal 2: tingkat sedang', q2.difficulty, 'Sedang');
check('analisis soal 2: nilai daya beda', q2.discrimination, 1);
check('analisis soal 2: kategori daya beda', q2.discriminationLabel, 'Baik sekali');
check('analisis soal 2: sebaran pengecoh', q2.options.map((option) => option.count), [3, 7, 0]);
check('analisis soal 2: kunci ditandai', q2.options[0].isKey, true);
check('analisis soal 3: esai tidak dinilai otomatis', [q3.answered, q3.pending], [0, 10]);
check('analisis soal 3: tanpa sebaran pilihan', q3.options, null);
check('analisis soal 3: catatan esai', q3.note.includes('dikoreksi guru'), true);

// Kelompok bawah justru lebih banyak benar -> kunci patut dicurigai salah.
const inverted = computeItemAnalysis(reportSpec, reportScores.map((score, index) => submissionOf(score, [true, index >= 7, null])));
check('analisis: daya beda negatif terdeteksi', inverted.items[1].discrimination, -1);
check('analisis: peringatan kunci salah', inverted.items[1].note.includes('kunci jawabannya salah'), true);
check('analisis: level bahaya', inverted.items[1].level, 'bad');

// Peserta sedikit: daya beda belum bermakna, tapi persentase tetap tampil.
const few = computeItemAnalysis(reportSpec, [submissionOf(90, [true, true, null]), submissionOf(60, [true, false, null])]);
check('analisis: peserta sedikit tanpa daya beda', few.items[0].discrimination, null);
check('analisis: persen tetap dihitung', few.items[1].percentCorrect, 50);
check('analisis: catatan butuh peserta', few.hasDiscrimination, false);

const reportHtml = renderItemAnalysis(analysis);
check('analisis html: bagian tampil', reportHtml.includes('Analisis Butir Soal'), true);
check('analisis html: skrip CSV dimuat', reportHtml.includes('/vendor/quiz-report.js'), true);
check('analisis html: data CSV ikut disuntik', reportHtml.includes('ITEM_ANALYSIS'), true);
check(
  'analisis html: soal dari data siswa ditutup',
  renderItemAnalysis(computeItemAnalysis(reportSpec, [submissionOf(90, [true, true, null])])).includes('<script>'),
  true
);
check(
  'analisis html: belum ada data',
  renderItemAnalysis(computeItemAnalysis(reportSpec, [])).includes('Belum ada jawaban siswa'),
  true
);

// ---------- Koreksi esai oleh guru ----------
const essayAnswers = [
  { id: 'q1', value: 'لا إله إلا الله' },
  { id: 'q2', value: '3' },
  { id: 'q3', value: 'سُبْحَانَ اللهِ' },
  { id: 'q4', value: '20' },
  { id: 'q5', value: ['a', 'c'] },
  { id: 'q6', value: true },
  { id: 'q7', value: 'Uraian siswa.' },
];

const belumDikoreksi = gradeSubmission(spec, essayAnswers);
check('esai belum dikoreksi: menunggu', [belumDikoreksi.essay_pending, belumDikoreksi.essay_graded], [1, 0]);
check('esai belum dikoreksi: nilai akhir belum ada', belumDikoreksi.final_score, null);
check('esai belum dikoreksi: nilai objektif tetap penuh', belumDikoreksi.score, 100);
check('esai belum dikoreksi: total poin esai', belumDikoreksi.essay_total, 5);

const sudahDikoreksi = gradeSubmission(spec, essayAnswers, '', { q7: 3 });
check('esai dinilai: poin & jumlah', [sudahDikoreksi.essay_earned, sudahDikoreksi.essay_total, sudahDikoreksi.essay_graded], [3, 5, 1]);
check('esai dinilai: tidak ada tunggakan', sudahDikoreksi.essay_pending, 0);
check('esai dinilai: poin masuk ke pembahasan', sudahDikoreksi.detail[6].poin, 3);
check('esai dinilai: nilai akhir gabungan', sudahDikoreksi.final_score, Math.round((9 / 11) * 100));

const dinilaiNol = gradeSubmission(spec, essayAnswers, '', { q7: 0 });
check('esai nilai nol tetap dianggap sudah dikoreksi', [dinilaiNol.essay_pending, dinilaiNol.final_score], [0, Math.round((6 / 11) * 100)]);
check('poin esai dibatasi poin maksimal', gradeSubmission(spec, essayAnswers, '', { q7: 99 }).essay_earned, 5);
check('poin esai negatif dijadikan nol', gradeSubmission(spec, essayAnswers, '', { q7: -4 }).essay_earned, 0);
check('id soal bukan esai diabaikan', gradeSubmission(spec, essayAnswers, '', { q1: 5 }).essay_earned, 0);

const noEssaySpec = parseQuizSpec(
  JSON.stringify({ title: 'Tanpa Esai', questions: [{ type: 'true_false', question: 'Benar?', answer: true }] })
);
const noEssayGrade = gradeSubmission(noEssaySpec, [{ id: 'q1', value: true }]);
check('tanpa esai: nilai akhir = nilai objektif', noEssayGrade.final_score, noEssayGrade.score);
check('tanpa esai: tidak ada tunggakan', noEssayGrade.essay_pending, 0);

// Rekap memakai nilai akhir kalau esainya sudah dikoreksi.
const mixedScores = computeItemAnalysis(reportSpec, [
  { score: 50, final_score: 80, lulus: true, detail: [{ id: 'q1', type: 'choice', benar: true, jawaban: 'A. A1' }, { id: 'q3', type: 'essay', benar: null, jawaban: 'uraian', poin: 4, poin_maks: 5 }] },
  { score: 90, lulus: true, detail: [{ id: 'q1', type: 'choice', benar: true, jawaban: 'A. A1' }, { id: 'q3', type: 'essay', benar: null, jawaban: 'uraian' }] },
]);
check('analisis: pakai nilai akhir kalau sudah dikoreksi', mixedScores.average, 85);

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
