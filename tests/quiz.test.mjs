// Uji cepat logika src/quiz.ts tanpa deploy: normalisasi jawaban Arab,
// deteksi fitur (tabel/rumus/arab), dan penilaian.
import {
  parseQuizSpec,
  gradeSubmission,
  renderQuizApp,
  renderPrintSheet,
  collectMediaSlots,
  collectMediaSlotsFromStored,
  mediaBaseFor,
  mediaContextFromRaw,
  mediaSlotContext,
  mediaSlotContextFull,
  parseQuizJson,
  quizToAuthoringSource,
  resolveMediaUrl,
  sanitizeMediaName,
  wrapBareLatex,
} from '../src/quiz.ts';
import { MAX_MEDIA_BYTES, mediaPlaceholder, sniffImageType, suggestMediaName } from '../src/media.ts';
import { buildGeminiPrompt, buildImagePrompt, IMGGEN_MODELS, mediaGenConfig } from '../src/media-gen.ts';
import { computeItemAnalysis, renderItemAnalysis } from '../src/quiz-report.ts';
import { readFileSync } from 'node:fs';

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

// ---------- Aksara Jawa: fitur 'jawa' ----------
const jawaSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Kuis Basa Jawa',
    description: '꧋ ꦲꦤ ꦕꦫꦏ',
    questions: [{ type: 'choice', question: 'Waca iki: ꦲꦤ ꦕꦫꦏ\ntegese:\n\n꧋ ꦲꦤ ꦕꦫꦏ ꦢꦠ ꦱꦮꦭ', options: ['A', 'B'], answer: 'A' }],
  })
);
check('fitur jawa terdeteksi', jawaSpec.features.includes('jawa'), true);
const jawaHtml = renderQuizApp(jawaSpec, 'uji-jawa');
check('paragraf aksara jawa dibungkus .q-jv', jawaHtml.includes('<div class="q-jv">'), true);
check('aksara jawa inline dibungkus .q-jv-inline', jawaHtml.includes('q-jv-inline'), true);

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

// ---------- Panel Gambar: slot dihitung dari spec tersimpan (bentuk ternormalisasi) ----------
// Spec tersimpan di KV punya `keys`, bukan `answer`, jadi parse ulang bisa gagal.
// Panel harus tetap menampilkan slot gambar, bukan 0/0.
const storedSpec = JSON.stringify(gambarSpec);
check(
  'slot dari spec tersimpan tetap terbaca',
  collectMediaSlotsFromStored(storedSpec),
  collectMediaSlots(gambarSpec)
);
check(
  'slot dari spec tersimpan tanpa token tetap kosong',
  collectMediaSlotsFromStored(JSON.stringify(spec)),
  []
);

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

// ---------- Generate gambar AI (media-gen) ----------
check('config gen lengkap diterima', !!mediaGenConfig({ IMGGEN_API_URL: 'https://img.example.workers.dev', IMGGEN_API_KEY: 'rahasia' }), true);
check('config gen tanpa kunci ditolak', mediaGenConfig({ IMGGEN_API_URL: 'https://img.example.workers.dev' }), null);
check('config gen tanpa URL ditolak', mediaGenConfig({ IMGGEN_API_KEY: 'rahasia' }), null);
check('config gen http ditolak', mediaGenConfig({ IMGGEN_API_URL: 'http://img.example.workers.dev', IMGGEN_API_KEY: 'rahasia' }), null);
check('daftar model tidak kosong dan default = model bawaan proxy', IMGGEN_MODELS.length >= 4 && IMGGEN_MODELS[0].id === '@cf/bytedance/stable-diffusion-xl-lightning', true);
check('daftar model id unik', new Set(IMGGEN_MODELS.map((m) => m.id)).size === IMGGEN_MODELS.length, true);
check('prompt dibungkus instruksi & topik asli ikut', buildImagePrompt('  skema   relay lampu  ').includes('skema relay lampu'), true);
check('prompt kosong tetap menghasilkan teks', buildImagePrompt('   ').length > 20, true);
check('prompt panjang dipangkas (topik maks 400 karakter)', buildImagePrompt('x'.repeat(2000)).length < 1000, true);
check('prompt gambar minta gaya menarik & tidak terlalu sederhana', buildImagePrompt('skema relay').includes('menarik') && buildImagePrompt('skema relay').includes('terlalu sederhana'), true);

// ---------- Konteks slot untuk prompt AI / template Gemini ----------
check('konteks slot dari field image berisi tipe + teks soal', mediaSlotContext(gambarSpec, 'tumbuhan').includes('Perhatikan gambar berikut!'), true);
check('konteks slot ikut memuat pilihan jawaban', mediaSlotContext(gambarSpec, 'tumbuhan').includes('Fotosintesis'), true);
check('konteks slot ikut memuat tipe soal', mediaSlotContext(gambarSpec, 'tumbuhan').includes('pilihan ganda'), true);
check('token markdown dalam teks dibuang dari konteks', mediaSlotContext(gambarSpec, 'bagan-2').includes('Cermati bagan ini.'), true);
check('konteks kontekstual dibersihkan dari token media', mediaSlotContext(gambarSpec, 'peta-jawa').includes('Perhatikan peta.'), true);
check('slot tanpa referensi memberi kosong', mediaSlotContext(gambarSpec, 'tidak-ada'), '');
check('konteks dari stimulus dipakai', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Stimulus Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Perhatikan gambar berikut ini.\n\nmedia:batik' }],
      questions: [{ type: 'choice', question: 'Soal A', options: ['1', '2'], answer: '1' }],
    })
  );
  return mediaSlotContext(s, 'batik');
})().includes('Perhatikan gambar berikut ini.'), true);
check('stimulus didahulukan daripada teks soal', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Perhatikan gambar motif ini.\n\nmedia:batik' }],
      questions: [{ type: 'choice', question: 'media:batik Apa nama motif ini?', options: ['Batik', 'Tenun'], answer: 'Batik', stimulus_id: 's1' }],
    })
  );
  const ctx = mediaSlotContext(s, 'batik');
  return ctx.includes('Perhatikan gambar motif ini.') && !ctx.includes('Apa nama motif ini?');
})(), true);
check('konteks soal ikut memuat bacaan stimulus (slot ada di soal)', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Teks bacaan singkat tentang seni rupa.' }],
      questions: [{ type: 'choice', question: 'Amati lukisan ini.\n\nmedia:lukisan', options: ['Impressionisme', 'Realisme'], answer: 'Impressionisme', stimulus_id: 's1' }],
    })
  );
  const ctx = mediaSlotContext(s, 'lukisan');
  return ctx.includes('Amati lukisan ini.') && ctx.includes('Teks bacaan singkat tentang seni rupa.');
})(), true);
check('konteks dari teks mentah saat parse gagal', mediaContextFromRaw('{"title":"x","questions":[{"type":"choice","question":"Perhatikan.\n\nmedia:peta-kota","options":["A","B"],"answer":"A"}]}', 'peta-kota').includes('Perhatikan.'), true);
check('konteks mentah tanpa token memberi kosong', mediaContextFromRaw('{"title":"x","questions":[]}', 'peta-kota'), '');
check('spec simpanan (kunci keys) bisa dibaca ulang parseQuizSpec', (() => {
  const normalized = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Perhatikan gambar motif ini.\n\nmedia:batik' }],
      questions: [
        { type: 'choice', question: 'Apa nama motif ini?', options: ['Batik', 'Tenun'], answer: 'Batik', stimulus_id: 's1', level: 'L1' },
        { type: 'multi', question: 'Pilih dua.', options: ['A', 'B', 'C'], answer: ['A', 'C'], stimulus_id: 's1' },
      ],
    })
  );
  const re = parseQuizSpec(JSON.stringify(normalized));
  return (
    re.questions.length === 2 &&
    re.questions[0].keys.join() === normalized.questions[0].keys.join() &&
    re.questions[1].keys.join() === normalized.questions[1].keys.join() &&
    re.questions[0].stimulusId === 's1' &&
    mediaSlotContextFull(re, 'batik').includes('Perhatikan gambar motif ini.') &&
    mediaSlotContextFull(re, 'batik').includes('Apa nama motif ini?')
  );
})(), true);
check('spec simpanan dengan stimulusId tetap menyatu ke stimulus', (() => {
  const normalized = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'media:peta-jawa Teks bacaan tentang peta.' }],
      questions: [{ type: 'choice', question: 'Soal A', options: ['1', '2'], answer: '1', stimulus_id: 's1' }],
    })
  );
  const re = parseQuizSpec(JSON.stringify(normalized));
  return mediaSlotContextFull(re, 'peta-jawa').includes('Teks bacaan tentang peta.');
})(), true);
check('LaTeX $...$ dan markdown *...* dibersihkan dari konteks', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Pirolisis tanpa oksigen ($anoxic$) menghasilkan $CH_4, C_2H_6$ dan residu *char* karbon.\n\nmedia:skema' }],
      questions: [{ type: 'choice', question: 'Apa hasilnya?', options: ['Gas', 'Padat'], answer: 'Gas', stimulus_id: 's1', explanation: 'disebut **pirolisis**' }],
    })
  );
  const ctx = mediaSlotContextFull(s, 'skema');
  return (
    !/\$/.test(ctx) &&
    !/\*/.test(ctx) &&
    ctx.includes('anoxic') &&
    ctx.includes('CH_4, C_2H_6') &&
    ctx.includes('char') &&
    ctx.includes('pirolisis')
  );
})(), true);
check('asterisk perkalian angka tidak terhapus dari konteks', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      questions: [{ type: 'choice', question: 'Hitung 2 * 3 * 4.\n\nmedia:soal-angka', options: ['24', '9'], answer: '24' }],
    })
  );
  return mediaSlotContext(s, 'soal-angka').includes('2 * 3 * 4');
})(), true);
check('prompt Gemini full: stimulus + konteks soal digabung', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Perhatikan gambar motif ini.\n\nmedia:batik' }],
      questions: [{ type: 'choice', question: 'Apa nama motif ini?', options: ['Batik', 'Tenun'], answer: 'Batik', stimulus_id: 's1' }],
    })
  );
  const full = mediaSlotContextFull(s, 'batik');
  return full.includes('Perhatikan gambar motif ini.') && full.includes('Apa nama motif ini?') && full.includes('Soal:');
})(), true);
check('prompt Gemini full: stimulus tidak diduplikasi (muncul sekali)', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Gem',
      stimuli: [{ id: 's1', title: 'Bacaan teks', content: 'Perhatikan gambar motif ini.\n\nmedia:batik' }],
      questions: [{ type: 'choice', question: 'Apa nama motif ini?', options: ['Batik', 'Tenun'], answer: 'Batik', stimulus_id: 's1' }],
    })
  );
  return (mediaSlotContextFull(s, 'batik').match(/Perhatikan gambar motif ini\./g) || []).length === 1;
})(), true);
check('prompt Gemini full: tanpa stimulus sama dengan konteks ringkas', (() => {
  const ctx = mediaSlotContext(gambarSpec, 'tumbuhan');
  return mediaSlotContextFull(gambarSpec, 'tumbuhan') === ctx && ctx.includes('Perhatikan gambar berikut!');
})(), true);
check('prompt Gemini full: slot tanpa referensi kosong', mediaSlotContextFull(gambarSpec, 'tidak-ada'), '');
check('konteks dari judul kuis dipakai', (() => {
  const s = parseQuizSpec(
    JSON.stringify({
      title: 'Peta media:kepulauan',
      questions: [{ type: 'choice', question: 'Soal X', options: ['1', '2'], answer: '1' }],
    })
  );
  return mediaSlotContext(s, 'kepulauan');
})() === 'Peta', true);
check('prompt Gemini memuat topik asli', buildGeminiPrompt('  siklus   air  ').includes('siklus air'), true);
check('prompt Gemini tidak terpotong di 400 karakter', (() => {
  const long = 'konteks '.repeat(200);
  const p = buildGeminiPrompt(long);
  return p.includes('Topik: konteks konteks konteks') && p.includes(long.trim().slice(-20));
})(), true);
check('prompt Gemini utuh untuk topik kosong', (() => {
  const p = buildGeminiPrompt('   ');
  return p.length > 20 && p.includes('ilustrasi edukatif umum') && p.includes('Topik:');
})(), true);
check('prompt Gemini minta gaya menarik & enak dilihat', buildGeminiPrompt('siklus air').includes('menarik') && buildGeminiPrompt('siklus air').includes('enak dilihat'), true);

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

// ---------- LaTeX telanjang di pilihan jawaban dibungkus otomatis ----------
const latexSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Matematika XI',
    passing_score: 70,
    questions: [
      {
        type: 'choice',
        question: 'Jika $A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}$, tentukan $A^{-1}$.',
        options: ['\\begin{pmatrix} 6 & -2 \\\\ -5 & 7 \\end{pmatrix}', '\\frac{1}{4}(\\sqrt{6} + \\sqrt{2})', '1,732', '2'],
        answer: '\\frac{1}{4}(\\sqrt{6} + \\sqrt{2})',
      },
      {
        type: 'multi',
        question: 'Pilih semua yang benar.',
        options: ['\\sqrt{3} > 1', 'Operasi perkalian matriks bersifat komutatif: A \\times B = B \\times A', 'Pusat lingkaran (3, -4) dan jari-jarinya 6'],
        answer: ['\\sqrt{3} > 1', 'Operasi perkalian matriks bersifat komutatif: A \\times B = B \\times A'],
      },
    ],
  })
);
check('opsi matriks telanjang dibungkus $', latexSpec.questions[0].options[0], '$\\begin{pmatrix} 6 & -2 \\\\ -5 & 7 \\end{pmatrix}$');
check('opsi pegas telanjang dibungkus $', latexSpec.questions[0].options[1], '$\\frac{1}{4}(\\sqrt{6} + \\sqrt{2})$');
check('opsi angka biasa tidak tersentuh', latexSpec.questions[0].options[2], '1,732');
check('kunci choice tetap cocok setelah dibungkus', latexSpec.questions[0].keys, ['1']);
check('label kunci ikut memakai opsi ter-wrap', latexSpec.questions[0].keyLabel, 'B. $\\frac{1}{4}(\\sqrt{6} + \\sqrt{2})$');
check('opsi prose + rumus: prose tetap di luar $', latexSpec.questions[1].options[1], 'Operasi perkalian matriks bersifat komutatif: $A \\times B = B \\times A$');
check('opsi prosa tanpa Latex tetap utuh', latexSpec.questions[1].options[2], 'Pusat lingkaran (3, -4) dan jari-jarinya 6');
check('kunci multi tetap cocok setelah dibungkus', latexSpec.questions[1].keys, ['0|1']);
check('opsi ter-wrap tetap dirender server sebagai latex', renderQuizApp(latexSpec, 'mtk').includes('\\frac{1}{4}(\\sqrt{6} + \\sqrt{2})'), true);
check('wrap idempoten (satu kali lagi tidak berubah)', wrapBareLatex(wrapBareLatex('Operasi komutatif: A \\times B = B \\times A')), 'Operasi komutatif: $A \\times B = B \\times A$');
check('rumus yang sudah dibungkus tidak dinesting', wrapBareLatex('$\\frac{1}{2}$ dan $\\sqrt{3}$'), '$\\frac{1}{2}$ dan $\\sqrt{3}$');
check('teks tanpa Latex tidak pernah berubah', wrapBareLatex('Nilai k = 4 membuat matriks M singular'), 'Nilai k = 4 membuat matriks M singular');
check('nama variabel 2 huruf bukan prosa', wrapBareLatex('Invers dari perkalian dua matriks non-singular berlaku: (AB)^{-1} = \\B^{-1} A^{-1}'), 'Invers dari perkalian dua matriks non-singular berlaku: $(AB)^{-1} = \\B^{-1} A^{-1}$');
check('seluruh opsi hasil wrap selalu $ genap', latexSpec.questions.concat(parseQuizSpec(JSON.stringify(latexSpec)).questions).every((q) => q.options.every((opt) => opt.replace(/\$\$[\s\S]*?\$\$/g, '').split('$').length % 2 === 1)), true);
check('teks dengan $ ganjil tidak ditambah apa-apa', wrapBareLatex('harga $\\frac{1}{2}'), 'harga $\\frac{1}{2}');
check('pangkat tanpa backslash ikut jadi rumus', wrapBareLatex('Invers dari perkalian dua matriks berlaku: (AB)^{-1} = B^{-1} A^{-1}'), 'Invers dari perkalian dua matriks berlaku: $(AB)^{-1} = B^{-1} A^{-1}$');
check('indeks tanpa backslash ikut jadi rumus', wrapBareLatex('a_{12} dan b_{21}'), '$a_{12}$ dan $b_{21}$');
check('underscore nama file/slot media tidak memicu', wrapBareLatex('Lihat media:gambar_satu pada file_name.png'), 'Lihat media:gambar_satu pada file_name.png');
check('pangkat telanjang tanpa kurung kurawal tidak memicu', wrapBareLatex('Turunan x^2 di titik 3'), 'Turunan x^2 di titik 3');
check('spec tersimpan lama ikut ter-wrap', parseQuizSpec(JSON.stringify(latexSpec)).questions[0].options[0], '$\\begin{pmatrix} 6 & -2 \\\\ -5 & 7 \\end{pmatrix}$');
check('pilihan siswa tetap dinilai benar setelah wrap', gradeSubmission(latexSpec, [{ id: 'q1', value: 'B' }, { id: 'q2', value: ['A', 'B'] }]).detail[0].benar, true);

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

/* ==========================================================================
 * Tipe soal lanjutan: ordering, matching, table_fill, two_tier, highlight
 * ========================================================================== */

const pairSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Jodohkan Mesin',
    questions: [
      {
        type: 'matching',
        question: 'Jodohkan istilah dengan pengertiannya.',
        pairs: [
          { left: 'AGV', right: 'Kendaraan pemandu otomatis' },
          { left: 'HSE', right: 'Departemen keselamatan kerja' },
          { left: 'SOP', right: 'Prosedur baku pengerjaan' },
        ],
        scoring: 'partial',
        level: 'L2',
      },
    ],
  })
);
const pairQ = pairSpec.questions[0];
const pairKeys = pairQ.keys[0].split('|').map(Number);
check('matching: kolom kiri sesuai urutan tulis', pairQ.options, ['AGV', 'HSE', 'SOP']);
check('matching: kolom kanan ikut disimpan', pairQ.rights.length, 3);
check(
  'matching: kunci menunjuk pasangan yang benar',
  pairKeys.map((index) => pairQ.rights[index]),
  ['Kendaraan pemandu otomatis', 'Departemen keselamatan kerja', 'Prosedur baku pengerjaan']
);
check('matching: kolom kanan tidak sejajar dengan kolom kiri', pairKeys.join('|') !== '0|1|2', true);
check(
  'matching: pengacakan kolom kanan selalu sama',
  parseQuizSpec(JSON.stringify(quizToAuthoringSource(pairSpec))).questions[0].rights,
  pairQ.rights
);

const pairFull = gradeSubmission(pairSpec, [{ id: 'q1', value: pairKeys }]);
check('matching: semua pasangan benar -> nilai penuh', [pairFull.detail[0].benar, pairFull.score], [true, 100]);
const pairHalf = gradeSubmission(pairSpec, [{ id: 'q1', value: [pairKeys[0], pairKeys[1], pairKeys[0]] }]);
check('matching: sebagian benar dapat poin parsial', pairHalf.detail[0].poin, Math.round((2 / 3) * 100) / 100);
check('matching: baris kosong dihitung belum dijawab', gradeSubmission(pairSpec, [{ id: 'q1', value: [null, null, null] }]).score, 0);
check(
  'matching: rincian per baris ditampilkan',
  gradeSubmission(pairSpec, [{ id: 'q1', value: [null, pairKeys[1], null] }]).detail[0].statements.length,
  3
);

const ordSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Urutkan Langkah',
    questions: [
      {
        type: 'ordering',
        question: 'Urutkan langkah kalibrasi berikut.',
        items: ['Cek koneksi', 'Nyalakan mesin', 'Jalankan kalibrasi'],
        scoring: 'partial',
      },
    ],
  })
);
const ordQ = ordSpec.questions[0];
const ordKeys = ordQ.keys[0].split('|').map(Number);
check('ordering: semua item tampil', ordQ.options.length, 3);
check('ordering: urutan tampil diacak (tidak membocorkan kunci)', ordQ.keys[0] !== '0|1|2', true);
check(
  'ordering: jawaban benar mengikuti kunci',
  gradeSubmission(ordSpec, [{ id: 'q1', value: ordKeys }]).detail[0].benar,
  true
);
check(
  'ordering: rincian menyebut posisi urutan',
  gradeSubmission(ordSpec, [{ id: 'q1', value: ordKeys }]).detail[0].statements[0].kunci.startsWith('Urutan ke-'),
  true
);
// Digeser satu posisi: tidak ada item yang berada di posisi benarnya.
const ordRotated = ordKeys.slice(1).concat(ordKeys.slice(0, 1));
check('ordering: urutan salah semua dapat nol', gradeSubmission(ordSpec, [{ id: 'q1', value: ordRotated }]).detail[0].poin, 0);
check(
  'ordering: sebagian posisi benar dapat poin parsial',
  gradeSubmission(ordSpec, [
    { id: 'q1', value: [ordKeys[1], ordKeys[0], ordKeys[2]] },
  ]).detail[0].poin,
  Math.round((1 / 3) * 100) / 100
);
check('ordering: urutan belum lengkap dianggap kosong', gradeSubmission(ordSpec, [{ id: 'q1', value: [ordKeys[0]] }]).score, 0);

const ordLate = parseQuizSpec(
  JSON.stringify({
    title: 'Urutkan dengan kunci',
    questions: [
      {
        type: 'ordering',
        question: 'Urutkan.',
        items: ['Langkah B', 'Langkah C', 'Langkah A'],
        answer: ['Langkah A', 'Langkah B', 'Langkah C'],
      },
    ],
  })
);
const ordLateKeys = ordLate.questions[0].keys[0].split('|').map(Number);
check(
  'ordering: kunci eksplisit dipetakan ke urutan tampil',
  ordLateKeys.map((index) => ordLate.questions[0].options[index]),
  ['Langkah A', 'Langkah B', 'Langkah C']
);
check(
  'ordering: kunci tidak lengkap ditolak',
  (() => {
    try {
      parseQuizSpec(
        JSON.stringify({ questions: [{ type: 'ordering', question: 'x', items: ['a', 'b'], answer: ['a'] }] })
      );
      return 'tidak ditolak';
    } catch (error) {
      return error.message.includes('SEMUA') ? 'ditolak' : error.message;
    }
  })(),
  'ditolak'
);

const fillSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Lengkapi Tabel',
    questions: [
      {
        type: 'table_fill',
        question: 'Lengkapi titik lebur bahan berikut.',
        headers: ['Bahan', 'Titik lebur (\u00b0C)'],
        rows: [
          ['Timah', { answer: ['327'] }],
          ['Tembaga', { answer: ['1085', '1.085'] }],
        ],
        scoring: 'partial',
      },
    ],
  })
);
const fillQ = fillSpec.questions[0];
check('table_fill: dua sel rumpang terdeteksi', fillQ.blanks.length, 2);
check('table_fill: label sel memakai sel statis di barisnya', fillQ.blanks[0].label, 'Timah');
check('table_fill: sel statis tidak jadi rumpang', fillQ.tableRows[0][0], 'Timah');
check('table_fill: judul kolom tersimpan', fillQ.tableHeaders, ['Bahan', 'Titik lebur (\u00b0C)']);
check(
  'table_fill: jawaban toleran spasi & huruf besar',
  gradeSubmission(fillSpec, [{ id: 'q1', value: [' 327 ', '1085'] }]).detail[0].benar,
  true
);
check(
  'table_fill: satu sel benar dapat poin parsial',
  gradeSubmission(fillSpec, [{ id: 'q1', value: ['327', 'salah'] }]).detail[0].poin,
  0.5
);
check(
  'table_fill: rincian menyebut sel yang keliru',
  gradeSubmission(fillSpec, [{ id: 'q1', value: ['327', 'salah'] }]).detail[0].statements[1].kunci,
  '1085 / 1 085'
);
check('table_fill: tabel kosong ditolak', (() => {
  try {
    parseQuizSpec(JSON.stringify({ questions: [{ type: 'table_fill', question: 'x', rows: [['a', 'b']] }] }));
    return 'tidak ditolak';
  } catch (error) {
    return error.message.includes('sel rumpang') ? 'ditolak' : error.message;
  }
})(), 'ditolak');

const tierSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Pernyataan + Alasan',
    questions: [
      {
        type: 'two_tier',
        question: 'Setujukah kamu dengan pernyataan teknisi tersebut?',
        options: ['Setuju', 'Tidak setuju'],
        answer: 'Setuju',
        reasons: ['Karena manajemen mengabaikan jadwal perawatan', 'Karena mesinnya sudah tua'],
        reason_answer: 'Karena manajemen mengabaikan jadwal perawatan',
        scoring: 'partial',
      },
    ],
  })
);
check('two_tier: kunci dua tingkat', tierSpec.questions[0].keys, ['0|0']);
check('two_tier: pilihan alasan tersimpan', tierSpec.questions[0].reasons.length, 2);
check('two_tier: keduanya benar -> benar penuh', gradeSubmission(tierSpec, [{ id: 'q1', value: [0, 0] }]).detail[0].benar, true);
check('two_tier: alasan keliru dapat setengah poin', gradeSubmission(tierSpec, [{ id: 'q1', value: [0, 1] }]).detail[0].poin, 0.5);
check('two_tier: keduanya kosong dianggap belum dijawab', gradeSubmission(tierSpec, [{ id: 'q1', value: [null, null] }]).score, 0);
check('two_tier: tanpa alasan ditolak', (() => {
  try {
    parseQuizSpec(JSON.stringify({ questions: [{ type: 'two_tier', question: 'x', options: ['a', 'b'], answer: 'a' }] }));
    return 'tidak ditolak';
  } catch (error) {
    return error.message.includes('reasons') ? 'ditolak' : error.message;
  }
})(), 'ditolak');

const hlSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Klik Kata',
    questions: [
      {
        type: 'highlight',
        question: 'Klik kata yang menunjukkan sikap jujur.',
        text: 'Budi {mengembalikan} uang yang ia temukan kepada {guru} di sekolah.',
        answer: ['mengembalikan'],
        scoring: 'partial',
      },
    ],
  })
);
const hlQ = hlSpec.questions[0];
check('highlight: dua kata bisa diklik', hlQ.segments.filter((segment) => segment.selectable).length, 2);
check('highlight: bacaan disimpan tanpa kurawal', hlQ.passage, 'Budi mengembalikan uang yang ia temukan kepada guru di sekolah.');
check('highlight: kunci menunjuk kata yang benar', hlQ.keys, ['0']);
check('highlight: teks soal tetap instruksi', hlQ.question, 'Klik kata yang menunjukkan sikap jujur.');
check('highlight: kata benar saja -> benar penuh', gradeSubmission(hlSpec, [{ id: 'q1', value: [0] }]).detail[0].benar, true);
check('highlight: memilih kata salah -> nol', gradeSubmission(hlSpec, [{ id: 'q1', value: [1] }]).detail[0].poin, 0);
check('highlight: benar + salah sekaligus tidak dapat poin', gradeSubmission(hlSpec, [{ id: 'q1', value: [0, 1] }]).detail[0].poin, 0);
check('highlight: tanpa kata yang bisa diklik ditolak', (() => {
  try {
    parseQuizSpec(JSON.stringify({ questions: [{ type: 'highlight', question: 'x', text: 'tanpa penanda', answer: ['a'] }] }));
    return 'tidak ditolak';
  } catch (error) {
    return error.message.includes('kurawal') ? 'ditolak' : error.message;
  }
})(), 'ditolak');
check('highlight: kunci tidak ada di bacaan ditolak', (() => {
  try {
    parseQuizSpec(JSON.stringify({ questions: [{ type: 'highlight', question: 'x', text: 'Budi {datang} pagi.', answer: ['pulang'] }] }));
    return 'tidak ditolak';
  } catch (error) {
    return error.message.includes('tidak ditemukan') ? 'ditolak' : error.message;
  }
})(), 'ditolak');
check(
  'highlight: soal ditampilkan dengan seluruh bacaannya',
  gradeSubmission(hlSpec, [{ id: 'q1', value: [0] }]).detail[0].question_html.includes('uang yang ia temukan'),
  true
);

// Round-trip editor: spec -> format tulis guru -> spec lagi, tanpa kehilangan kunci.
const roundTrip = (quiz) => parseQuizSpec(JSON.stringify(quizToAuthoringSource(quiz)));
check('round-trip matching: kunci tetap sama', roundTrip(pairSpec).questions[0].keys, pairQ.keys);
check('round-trip matching: kolom kanan tetap sama', roundTrip(pairSpec).questions[0].rights, pairQ.rights);
check('round-trip matching: tipe tetap sama', roundTrip(pairSpec).questions[0].type, 'matching');
check('round-trip table_fill: kunci tetap sama', roundTrip(fillSpec).questions[0].blanks, fillQ.blanks);
check('round-trip table_fill: baris tetap sama', roundTrip(fillSpec).questions[0].tableRows, fillQ.tableRows);
check('round-trip two_tier: kunci tetap sama', roundTrip(tierSpec).questions[0].keys, ['0|0']);
check('round-trip highlight: kunci tetap sama', roundTrip(hlSpec).questions[0].keys, ['0']);
check('round-trip highlight: penanda kurawal ditulis ulang', roundTrip(hlSpec).questions[0].passage, hlQ.passage);
check(
  'round-trip ordering: kunci tetap setara',
  gradeSubmission(roundTrip(ordSpec), [
    { id: 'q1', value: roundTrip(ordSpec).questions[0].keys[0].split('|').map(Number) },
  ]).detail[0].benar,
  true
);
check(
  'round-trip semua tipe lanjutan sekaligus',
  [pairSpec, ordSpec, fillSpec, tierSpec, hlSpec].every((quiz) => roundTrip(quiz).questions.length === 1),
  true
);

// Tipe yang dipakai naskah TKA: stimulus dipakai bersama + kategori + pembahasan.
const tkaSpec = parseQuizSpec(
  JSON.stringify({
    title: 'TKA Bahasa Inggris SMK',
    passing_score: 70,
    stimuli: [{ id: 's1', title: 'Company Operational Memo', content: 'All technicians must wear high-visibility vests.' }],
    questions: [
      { type: 'choice', level: 'L1', stimulus: 's1', question: 'Where are the vests?', options: ['Gate 2', 'Office'], answer: 'Gate 2', explanation: 'Teks menyebut Gate 2.' },
      { type: 'mcma', level: 'L2', stimulus: 's1', question: 'Pilih dua yang benar.', options: ['a', 'b', 'c'], answer: ['a', 'b'] },
      {
        type: 'pg_kompleks_kategori',
        level: 'L3',
        stimulus: 's1',
        question: 'Tentukan status tiap pernyataan.',
        statements: [{ text: 'Vest wajib.', answer: true }, { text: 'Vest opsional.', answer: false }],
      },
    ],
  })
);
check('tka: alias mcma dikenali sebagai multi', tkaSpec.questions[1].type, 'multi');
check('tka: alias pg_kompleks_kategori jadi category', tkaSpec.questions[2].type, 'category');
check('tka: stimulus bersama dipakai tiga soal', tkaSpec.questions.map((question) => question.stimulusId), ['s1', 's1', 's1']);
check(
  'tka: bacaan didenormalisasi ke tiap soal (satu stimulus satu soal)',
  tkaSpec.questions.every(
    (question) =>
      question.stimulusTitle === 'Company Operational Memo' && question.stimulusContent === 'All technicians must wear high-visibility vests.'
  ),
  true
);
const tkaGrade = gradeSubmission(tkaSpec, [
  { id: 'q1', value: 0 },
  { id: 'q2', value: [0, 1] },
  { id: 'q3', value: [true, false] },
]);
check('tka: pembahasan ikut penilaian', tkaGrade.detail[0].pembahasan.includes('Gate 2'), true);
check('tka: level kognitif tersimpan', tkaSpec.questions.map((question) => question.level), ['L1', 'L2', 'L3']);
check('tka: label kolom kategori bisa diganti', (() => {
  const custom = parseQuizSpec(
    JSON.stringify({
      questions: [
        {
          type: 'category',
          question: 'x',
          labels: ['Sesuai', 'Tidak Sesuai'],
          statements: [{ text: 'a', answer: true }, { text: 'b', answer: false }],
        },
      ],
    })
  );
  return custom.questions[0].labels;
})(), ['Sesuai', 'Tidak Sesuai']);

/* Gemini kadang menulis dua nilai untuk kunci yang harus SATU boolean
   ("answer": [false, true]). Parser harus tetap terbaca, nilai pertama menang. */
const twoValueCat = parseQuizSpec(
  JSON.stringify({
    questions: [
      {
        type: 'category',
        question: 'Tentukan status.',
        statements: [
          { text: 'Pertama', answer: [false, true] },
          { text: 'Kedua', answer: 'benar, salah' },
          { text: 'Ketiga', answer: ['true'] },
          { text: 'Keempat', answer: false },
        ],
      },
    ],
  })
);
check('kategori: kunci dua nilai (array) dipakai nilai pertama', twoValueCat.questions[0].statements[0].answer, false);
check('kategori: kunci dua nilai (string) dipakai nilai pertama', twoValueCat.questions[0].statements[1].answer, true);
check('kategori: kunci array satu elemen tetap benar', twoValueCat.questions[0].statements[2].answer, true);
check('kategori: kunci boolean biasa tidak berubah', twoValueCat.questions[0].statements[3].answer, false);
check('kategori: dua nilai tetap bobotnya benar', twoValueCat.questions[0].keys, ['false', 'true', 'true', 'false']);
const twoValueTf = parseQuizSpec(
  JSON.stringify({ questions: [{ type: 'true_false', question: 'x', answer: [true, false] }] })
);
check('true_false: kunci dua nilai (array) dipakai nilai pertama', twoValueTf.questions[0].keys, ['true']);

/* --- Renderer: panel navigasi, tanda ragu, dan tata letak dua kolom --------- */
// Bagian markup saja (tanpa blok <script>), supaya hitungan tidak kena nama
// selector di dalam kode klien.
const markupOf = (html) => html.split('<script>')[0];

const navHtml = renderQuizApp(tkaSpec, 'tka-bahasa-inggris');
check('render: panel navigasi ada', navHtml.includes('id="nav-grid"'), true);
check('render: penghitung di panel navigasi ada', navHtml.includes('id="nav-count"'), true);
check('render: tombol tanda ragu ada di tiap kartu', (markupOf(navHtml).match(/data-flag/g) || []).length, 3);
check('render: tipe soal ikut ditulis di kartu', navHtml.includes('data-type="category"'), true);
check('render: tiap soal berbacaan memuat kartu stimulusnya sendiri', (markupOf(navHtml).match(/class="q-stimulus"/g) || []).length, 3);
check('render: bacaan tidak dikelompokkan (tanpa dua kolom kiri)', navHtml.includes('q-group-split'), false);
check('render: kotak tawaran melanjutkan ada', navHtml.includes('id="resume-box"'), true);
check('render: jawaban disimpan ke localStorage per aplikasi', navHtml.includes("'quiz-attempt:' + CFG.slug"), true);
check('render: pemulihan jawaban menunggu keputusan siswa', navHtml.includes("getElementById('resume-yes')"), true);
check('render: panel navigasi tidak ikut tercetak', navHtml.includes('q-nav q-no-print'), true);

const ordHtml = renderQuizApp(ordSpec, 'uji-urutan');
check('render ordering: tombol naik-turun ada', ordHtml.includes('data-move="-1"'), true);
check('render ordering: tiap item punya penanda posisi', (markupOf(ordHtml).match(/q-ord-pos/g) || []).length, 3);
const pairHtml = renderQuizApp(pairSpec, 'uji-jodohkan');
check('render matching: kolom kanan jadi daftar pilihan', (markupOf(pairHtml).match(/q-match-select/g) || []).length, 3);
check('render matching: opsi kanan diberi huruf', pairHtml.includes('>A. '), true);
const fillHtml = renderQuizApp(fillSpec, 'uji-tabel');
check('render table_fill: dua kotak isian dibuat', (fillHtml.match(/class="q-input q-fill"/g) || []).length, 2);
check('render table_fill: judul kolom tampil', fillHtml.includes('Titik lebur'), true);
const tierHtml = renderQuizApp(tierSpec, 'uji-alasan');
check('render two_tier: dua tingkat radio dibuat', (tierHtml.match(/name="ans-q1-t[12]"/g) || []).length, 4);
const hlHtml = renderQuizApp(hlSpec, 'uji-highlight');
check('render highlight: bacaan jadi tombol yang bisa diklik', (hlHtml.match(/class="q-hl"/g) || []).length, 2);
check('render highlight: teks biasa tidak jadi tombol', hlHtml.includes('di sekolah.'), true);

/* --- Print to PDF: lembar statis, tata letak 1/2 kolom, kunci opsional ------ */
check('render: tombol Cetak TIDAK dirender di header siswa', !navHtml.includes('href="?print=1"'), true);
check('render: placeholder alat admin ada di header', navHtml.includes('id="admin-tools"'), true);

const plainSheet = renderPrintSheet(tkaSpec, 'tka-bahasa-inggris');
check('print: semua teks soal ikut tercetak', tkaSpec.questions.every((question) => plainSheet.includes(question.question)), true);
check('print: bacaan dicetak per soal (kartu stimulus utuh)', (markupOf(plainSheet).match(/class="q-stimulus"/g) || []).length, 3);
check('print: tidak ada kontrol interaktif soal', /<input|<select|<textarea|data-move|class="q-hl"|data-flag/.test(markupOf(plainSheet)), false);
check('print: toolbar tata letak tampil saat non-auto', plainSheet.includes('data-cols-bar'), true);
check('print: default satu kolom', plainSheet.includes('q-print-cols is-2col'), false);
check('print: tanpa kunci saat showKunci false', plainSheet.includes('<strong>Kunci:</strong>'), false);
check('print: tanpa pembahasan saat showKunci false', plainSheet.includes('Teks menyebut Gate 2.'), false);
check('print: non-auto tidak langsung memicu dialog cetak', plainSheet.includes('setTimeout(function () { window.print(); }, 400)'), false);

const mathSheet = renderPrintSheet(spec, 'uji-lokal');
check('print: KaTeX CSS ikut dimuat', mathSheet.includes('katex.min.css'), true);
check('print: auto-render math memakai opsi aman', mathSheet.includes('throwOnError: false'), true);
check('print: form identitas di atas soal', plainSheet.includes('q-print-biodata') && plainSheet.includes('Nama') && plainSheet.includes('Kelas') && plainSheet.includes('Nomor Absen'), true);

const autoSheet = renderPrintSheet(tkaSpec, 'tka-bahasa-inggris', { auto: true });
check('print: auto langsung memicu dialog cetak', autoSheet.includes('setTimeout(function () { window.print(); }, 400)'), true);
check('print: auto tanpa toolbar', autoSheet.includes('data-cols-bar'), false);

const twoCol = renderPrintSheet(tkaSpec, 'tka-bahasa-inggris', { layout: '2col' });
check('print: dua kolom mengaktifkan is-2col', twoCol.includes('class="q-print-cols is-2col"'), true);
check('print: dua kolom tetap tanpa kunci', twoCol.includes('<strong>Kunci:</strong>'), false);

const keySheet = renderPrintSheet(tkaSpec, 'tka-bahasa-inggris', { showKunci: true });
check('print+kunci: blok kunci ada di tiap soal', (markupOf(keySheet).match(/class="q-print-key"/g) || []).length, 3);
check('print+kunci: keyLabel ikut tercetak', keySheet.includes(tkaSpec.questions[0].keyLabel), true);
check('print+kunci: pembahasan ikut tercetak', keySheet.includes('Teks menyebut Gate 2.'), true);
check('print+kunci: kategori kunci benar ditandai ceklis', /q-print-mark">✓</.test(keySheet), true);

/* --- Analisis butir untuk soal berbaris ------------------------------------ */
const weakSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Analisis Baris',
    questions: [
      {
        type: 'category',
        question: 'Tentukan status pernyataan berikut.',
        statements: [
          { text: 'Pernyataan pertama', answer: true },
          { text: 'Pernyataan kedua', answer: false },
        ],
      },
    ],
  })
);
const rowSubmission = (rows) => ({
  score: 50,
  lulus: false,
  detail: [
    {
      id: 'q1',
      type: 'category',
      benar: rows.every(Boolean),
      jawaban: 'x',
      statements: rows.map((benar, index) => ({
        text: index === 0 ? 'Pernyataan pertama' : 'Pernyataan kedua',
        benar,
      })),
    },
  ],
});
const weakReport = computeItemAnalysis(weakSpec, [
  rowSubmission([false, true]),
  rowSubmission([false, true]),
  rowSubmission([false, true]),
  rowSubmission([true, true]),
]);
check('analisis baris: bagian tersering keliru ditemukan', weakReport.items[0].weakestRows, [
  { text: 'Pernyataan pertama', wrong: 3, total: 4 },
]);
check('analisis baris: baris yang selalu benar tidak masuk daftar', weakReport.items[0].weakestRows.length, 1);
check('analisis baris: soal PG tidak punya daftar baris', analysis.items[0].weakestRows, null);
check(
  'analisis baris: ditampilkan di halaman rekap',
  renderItemAnalysis(weakReport).includes('Bagian tersering keliru'),
  true
);
check(
  'analisis: label tipe soal lanjutan dikenali',
  ['ordering', 'matching', 'table_fill', 'two_tier', 'highlight', 'category'].every((type) =>
    renderItemAnalysis(
      computeItemAnalysis(
        parseQuizSpec(
          JSON.stringify({
            title: 'Label',
            questions: [
              {
                type,
                question: 'x',
                ...(type === 'ordering' ? { items: ['a', 'b'] } : {}),
                ...(type === 'matching'
                  ? { pairs: [{ left: 'a', right: 'x' }, { left: 'b', right: 'y' }] }
                  : {}),
                ...(type === 'table_fill'
                  ? { rows: [['a', { answer: ['x'] }]] }
                  : {}),
                ...(type === 'two_tier'
                  ? { options: ['a', 'b'], answer: 'a', reasons: ['x', 'y'], reason_answer: 'x' }
                  : {}),
                ...(type === 'highlight' ? { text: 'a {b} c', answer: ['b'] } : {}),
                ...(type === 'category' ? { statements: [{ text: 'a', answer: true }] } : {}),
              },
            ],
          })
        ),
        [rowSubmission([false])]
      )
    ).includes('undefined') === false
  ),
  true
);

/* --- Editor soal: tipe lanjutan & konvensi tabel --------------------------- */
// Editor adalah skrip browser. Supaya logikanya tetap bisa diuji tanpa browser,
// ia membuka pintu window.QUIZ_EDITOR_HELPERS kalau boot.exposeHelpers diisi.
const editorSource = readFileSync(new URL('../public/vendor/quiz-editor.js', import.meta.url), 'utf8');

function stubElement() {
  return {
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelectorAll() { return []; },
  };
}

function runEditor(source) {
  const elements = new Map();
  const fakeWindow = {
    QUIZ_EDITOR: { slug: 'uji-editor', source, exposeHelpers: true },
    addEventListener() {},
    scrollTo() {},
    confirm() { return true; },
  };
  const fakeDocument = {
    body: { scrollHeight: 0 },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, stubElement());
      return elements.get(id);
    },
  };
  new Function('window', 'document', editorSource)(fakeWindow, fakeDocument);
  return fakeWindow.QUIZ_EDITOR_HELPERS;
}

const editorJson = {
  title: 'Editor Uji',
  questions: [
    { type: 'category', question: 'Kategori', statements: [{ text: 'a', answer: true }, { text: 'b', answer: false }] },
    { type: 'matching', question: 'Jodohkan', pairs: [{ left: 'a', right: 'p' }, { left: 'b', right: 'q' }] },
    { type: 'ordering', question: 'Urutkan', items: ['Pertama', 'Kedua', 'Ketiga'] },
    { type: 'table_fill', question: 'Tabel', headers: ['Bahan', 'Titik lebur'], rows: [['Timah', { answer: ['327'] }]] },
    {
      type: 'two_tier',
      question: 'Alasan',
      options: ['Setuju', 'Tidak setuju'],
      answer: 'Setuju',
      reasons: ['Karena a', 'Karena b'],
      reason_answer: 'Karena b',
    },
    { type: 'highlight', question: 'Klik kata', text: 'Budi {mengembalikan} uang itu.', answer: ['mengembalikan'] },
  ],
};
const editor = runEditor(editorJson);
check('editor: skrip editor bisa dijalankan tanpa browser', typeof editor.normalizeForSave, 'function');
check('editor: semua tipe lanjutan lolos validasi', editor.problems(), []);
check('editor: tabel ditampilkan dengan penanda kurawal', editor.tableRowsText(editorJson.questions[3]), 'Timah | {327}');
check(
  'editor: teks tabel dibaca kembali jadi kunci',
  editor.parseTableRows('Timah | {327 / 300}\nTembaga | {1085}'),
  [['Timah', { answer: ['327', '300'] }], ['Tembaga', { answer: ['1085'] }]]
);

editor.normalizeForSave();
check(
  'editor: urutan soal & tipe tetap utuh setelah disimpan',
  editor.state.questions.map((question) => question.type),
  ['category', 'matching', 'ordering', 'table_fill', 'two_tier', 'highlight']
);
check(
  'editor: hasil simpan tetap diterima parser kuis',
  parseQuizSpec(JSON.stringify(editor.state)).questions.map((question) => question.type),
  ['category', 'matching', 'ordering', 'table_fill', 'two_tier', 'highlight']
);
check(
  'editor: kunci alasan tetap benar setelah disimpan',
  parseQuizSpec(JSON.stringify(editor.state)).questions[4].keys,
  ['0|1']
);

const orderFix = runEditor({
  questions: [{ type: 'ordering', question: 'Urutkan', items: ['B', 'C', 'A'], answer: ['A', 'B', 'C'] }],
});
check('editor: urutan benar dipindah ke daftar item', orderFix.state.questions[0].items, ['A', 'B', 'C']);
check('editor: kunci eksplisit dibuang setelah dipindah', 'answer' in orderFix.state.questions[0], false);

// Stimulus masuk ke editor bisa berbentuk daftar bersama + id, teks langsung,
// atau objek {title, content}. Semua harus jadi objek per soal (satu stimulus
// untuk satu soal) supaya guru bisa mengedit bacaan tiap soal secara mandiri.
const legacyStim = runEditor({
  stimuli: [{ id: 's1', title: 'Memo', content: 'Teks memo bersama.' }],
  questions: [
    { type: 'choice', question: 'Soal 1', options: ['a', 'b'], answer: 'a', stimulus: 's1' },
    { type: 'short', question: 'Soal 2', answer: ['x'], stimulus: 'Teks langsung.' },
  ],
});
check('editor: stimulus bersama didenormalisasi per soal', legacyStim.state.questions[0].stimulus, {
  title: 'Memo',
  content: 'Teks memo bersama.',
});
check('editor: daftar stimulus level atas dibuang', 'stimuli' in legacyStim.state, false);
check('editor: stimulus teks langsung jadi konten per soal', legacyStim.state.questions[1].stimulus.content, 'Teks langsung.');
legacyStim.state.questions[0].stimulus.content = 'Memo diedit.';
legacyStim.normalizeForSave();
check('editor: stimulus tetap utuh setelah simpan', legacyStim.state.questions[0].stimulus, { title: 'Memo', content: 'Memo diedit.' });
check(
  'editor: hasil simpan stimulus diterima parser',
  parseQuizSpec(JSON.stringify(legacyStim.state)).questions[0].stimulusContent,
  'Memo diedit.'
);

const objStim = runEditor({
  questions: [
    {
      type: 'choice',
      question: 'Pilih.',
      options: ['a', 'b'],
      answer: 'a',
      stimulus: { title: 'Bacaan A', content: 'Teks A.' },
    },
  ],
});
objStim.normalizeForSave();
check('editor: stimulus objek dipertahankan', objStim.state.questions[0].stimulus, { title: 'Bacaan A', content: 'Teks A.' });
const emptyStim = runEditor({
  questions: [
    { type: 'choice', question: 'Pilih.', options: ['a', 'b'], answer: 'a', stimulus: { title: 'x', content: '   ' } },
  ],
});
emptyStim.normalizeForSave();
check('editor: stimulus kosong dibuang saat simpan', 'stimulus' in emptyStim.state.questions[0], false);

const badTable = runEditor({ questions: [{ type: 'table_fill', question: 'Tabel', rows: [['a', 'b']] }] });
check('editor: tabel tanpa sel rumpang ditolak', badTable.problems().length > 0, true);
const badHighlight = runEditor({
  questions: [{ type: 'highlight', question: 'Klik kata', text: 'tanpa penanda', answer: ['a'] }],
});
check('editor: bacaan tanpa kurawal ditolak', badHighlight.problems().length > 0, true);
const badPairs = runEditor({
  questions: [{ type: 'matching', question: 'Jodohkan', pairs: [{ left: 'a', right: '' }, { left: 'b', right: 'q' }] }],
});
check('editor: pasangan tidak lengkap ditolak', badPairs.problems().length > 0, true);

const messyCat = runEditor({
  questions: [
    {
      type: 'category',
      question: 'Rapikan',
      statements: [
        { text: 'a', answer: [false, true] },
        { text: 'b', answer: 'benar, salah' },
        { text: 'c', answer: true },
      ],
    },
    { type: 'true_false', question: 'x', answer: [true, false] },
  ],
});
messyCat.normalizeForSave();
check(
  'editor: kunci pernyataan duaan dirapikan jadi satu boolean',
  messyCat.state.questions[0].statements.map((statement) => statement.answer),
  [false, true, true]
);
check('editor: true_false duaan dirapikan jadi satu boolean', messyCat.state.questions[1].answer, true);
check(
  'editor: hasil rapikan tetap diterima parser kuis',
  parseQuizSpec(JSON.stringify(messyCat.state)).questions[0].keys,
  ['false', 'true', 'true']
);

/* --- Kebersihan halaman kuis dengan semua tipe sekaligus ------------------- */
const allTypesSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Semua Tipe',
    passing_score: 70,
    stimuli: [{
      id: 's1',
      title: 'Memo',
      content: 'Para teknisi wajib memakai vest dan menjaga jarak 2 meter dari jalur AGV.',
    }],
    questions: [
      { type: 'choice', question: 'Pilih.', options: ['a', 'b'], answer: 'a', stimulus: 's1' },
      { type: 'multi', question: 'Pilih banyak.', options: ['a', 'b', 'c'], answer: ['a', 'b'] },
      { type: 'category', question: 'Tentukan.', statements: [{ text: 'a', answer: true }, { text: 'b', answer: false }] },
      { type: 'matching', question: 'Jodohkan.', pairs: [{ left: 'a', right: 'p' }, { left: 'b', right: 'q' }] },
      { type: 'ordering', question: 'Urutkan.', items: ['satu', 'dua', 'tiga'] },
      { type: 'table_fill', question: 'Isi tabel.', headers: ['Bahan', 'Suhu'], rows: [['Timah', { answer: ['327'] }], ['Tembaga', { answer: ['1085'] }]] },
      {
        type: 'two_tier',
        question: 'Setujukah?',
        options: ['Setuju', 'Tidak'],
        answer: 'Tidak',
        reasons: ['Karena a', 'Karena b'],
        reason_answer: 'Karena a',
      },
      { type: 'highlight', question: 'Klik kata jujur.', text: 'Budi {mengembalikan} uang itu kepada {guru}.', answer: ['mengembalikan'] },
      { type: 'short', question: 'Isian.', answer: ['x'] },
      { type: 'essay', question: 'Uraikan.', points: 5 },
    ],
  })
);
const allHtml = renderQuizApp(allTypesSpec, 'uji-semua-tipe');
check('render semua tipe: parser menerima 10 butir', allTypesSpec.questions.length, 10);
check(
  'render semua tipe: stimulus bersama didenormalisasi ke soal',
  allTypesSpec.questions[0].stimulusContent,
  'Para teknisi wajib memakai vest dan menjaga jarak 2 meter dari jalur AGV.'
);
check('render semua tipe: kartu soal berbacaan diikuti stimulusnya', (markupOf(allHtml).match(/class="q-stimulus"/g) || []).length, 1);
// Dicek pada bagian markup saja: kode klien memang memakai kata "undefined".
check('render semua tipe: penanda sel rumpang tidak bocor ke halaman', markupOf(allHtml).includes('@@BLANK'), false);
check('render semua tipe: tidak ada nilai undefined di tampilan', markupOf(allHtml).includes('undefined'), false);
check('render semua tipe: tidak ada objek mentah di tampilan', markupOf(allHtml).includes('[object Object]'), false);
check('render semua tipe: kotak isian tabel dibuat sesuai jumlah rumpang', (markupOf(allHtml).match(/class="q-input q-fill"/g) || []).length, 2);
check('render semua tipe: kartu ditandai tipe masing-masing', (markupOf(allHtml).match(/data-type=/g) || []).length, 10);
check('render semua tipe: panel navigasi dapat 10 nomor saat dibuka', allHtml.includes("navGrid.appendChild(button)"), true);
check('render semua tipe: tombol kirim tetap ada', allHtml.includes('id="submit-btn"'), true);
check('render semua tipe: judul kolom rincian menyesuaikan tipe', allHtml.includes('item.row_label || '), true);

// Judul kolom rincian di layar pembahasan ikut tipe soalnya, bukan selalu "Pernyataan".
check(
  'rincian: label baris dikirim ke halaman hasil',
  [
    gradeSubmission(hlSpec, [{ id: 'q1', value: [0] }]).detail[0].row_label,
    gradeSubmission(fillSpec, [{ id: 'q1', value: ['327', '1085'] }]).detail[0].row_label,
    gradeSubmission(ordSpec, [{ id: 'q1', value: ordKeys }]).detail[0].row_label,
    gradeSubmission(pairSpec, [{ id: 'q1', value: pairKeys }]).detail[0].row_label,
    gradeSubmission(tierSpec, [{ id: 'q1', value: [0, 0] }]).detail[0].row_label,
  ],
  ['Kata/frasa', 'Sel', 'Langkah', 'Pernyataan', 'Bagian']
);
check(
  'rincian: soal PG tidak punya tabel rincian',
  gradeSubmission(ordSpec, [{ id: 'q1', value: ordKeys }]) &&
    gradeSubmission(parseQuizSpec(JSON.stringify({ questions: [{ type: 'choice', question: 'x', options: ['a', 'b'], answer: 'a' }] })), [
      { id: 'q1', value: 0 },
    ]).detail[0].statements,
  undefined
);

/* --- Dokumen prompt Gem: semua contoh JSON harus tetap valid -------------- */
const promptDoc = readFileSync(new URL('../docs/gemini-gem-prompt-full.md', import.meta.url), 'utf8');
// Pagarnya harus toleran CRLF: repo ini bisa di-checkout dengan line ending Windows,
// dan regex yang hardcode `\n` akan mengembalikan 0 blok sehingga semua test di bawah
// ini lulus tanpa benar-benar memeriksa apa pun.
const jsonBlocks = [...promptDoc.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
check('dokumen prompt: ada contoh JSON', jsonBlocks.length > 5, true);
const brokenBlocks = jsonBlocks.filter((block) => {
  try {
    JSON.parse(block);
    return false;
  } catch {
    return true;
  }
});
check('dokumen prompt: semua blok contoh adalah JSON valid', brokenBlocks.length, 0);
const fullExample = jsonBlocks.find((block) => {
  try {
    return Array.isArray(JSON.parse(block).questions) && JSON.parse(block).questions.length > 5;
  } catch {
    return false;
  }
});
check('dokumen prompt: ada satu contoh lengkap dari Gem', typeof fullExample, 'string');
const promptSpec = parseQuizSpec(fullExample);
check(
  'dokumen prompt: contoh lengkap memakai semua 11 tipe',
  [...new Set(promptSpec.questions.map((question) => question.type))].sort(),
  ['category', 'choice', 'essay', 'highlight', 'matching', 'multi', 'ordering', 'short', 'table_fill', 'true_false', 'two_tier']
);
check('dokumen prompt: contoh lengkap pakai stimulus per soal', promptSpec.questions.some((question) => question.stimulusContent), true);
check(
  'dokumen prompt: setiap tipe punya penjelasan di daftar tipe',
  ['matching', 'ordering', 'table_fill', 'two_tier', 'highlight', 'category'].every(
    (type) => promptDoc.includes('`' + type + '`')
  ),
  true
);
check(
  'dokumen prompt: kontrak endpoint submit disebut persis',
  promptDoc.includes('/api/submit/') && promptDoc.includes('student_name'),
  true
);
check('dokumen prompt: larangan base64 ada', promptDoc.includes('base64'), true);

// ---------- Durasi latihan (timer) + identitas nama+kelas ------------------
const timerSpec = parseQuizSpec(
  JSON.stringify({
    title: 'Kuis Timer',
    passing_score: 60,
    duration_minutes: 45,
    identity_fields: 'name_class',
    questions: [{ type: 'short', question: '1+1?', answer: ['2'] }],
  })
);
check('durasi: dibaca dari duration_minutes', timerSpec.durationMinutes, 45);
check('identitas: name_class dikenali', timerSpec.identityFields, 'name_class');
check('durasi: di luar 1-600 dibuang', parseQuizSpec(JSON.stringify({ title: 'x', duration_minutes: 6000, questions: [{ type: 'short', question: 'a', answer: ['a'] }] })).durationMinutes, null);
check('durasi: tidak diset = null (tanpa timer)', parseQuizSpec(JSON.stringify({ title: 'x', questions: [{ type: 'short', question: 'a', answer: ['a'] }] })).durationMinutes, null);
check('identitas: tidak diset = name (perilaku lama)', parseQuizSpec(JSON.stringify({ title: 'x', questions: [{ type: 'short', question: 'a', answer: ['a'] }] })).identityFields, 'name');

const timerHtml = renderQuizApp(timerSpec, 'uji-timer');
check('render: kotak timer ada saat durasi diset', timerHtml.includes('id="quiz-timer"'), true);
check('render: form identitas dua kolom ada', timerHtml.includes('id="student-class"'), true);

// Gerbang mulai: modal petunjuk + identitas. Timer TIDAK menyala saat halaman
// dibuka — hanya setelah tombol Mulai Mengerjakan (startTimerNow) ditekan.
check('gerbang: modal petunjuk dirender', timerHtml.includes('id="start-gate"'), true);
check('gerbang: tombol mulai ada', timerHtml.includes('id="gate-start"'), true);
check('gerbang: judul aplikasi di modal', timerHtml.includes('id="gate-title"'), true);
check('gerbang: input nama di modal', timerHtml.includes('id="gate-name"'), true);
check('gerbang: input kelas di modal (name_class)', timerHtml.includes('id="gate-class"'), true);
const noTimerGateHtml = renderQuizApp(
  parseQuizSpec(JSON.stringify({ title: 'Kuis Tanpa Timer', questions: [{ type: 'short', question: 'a', answer: ['a'] }] })),
  'uji-gate-tanpa-timer'
);
check('gerbang: input nama ikut mode name', noTimerGateHtml.includes('id="gate-name"'), true);
check('gerbang: tanpa kelas di modal (mode name)', !noTimerGateHtml.includes('id="gate-class"'), true);
check('gerbang: tersembunyi saat load (anti kedip)', /id="start-gate"[^>]*hidden/.test(timerHtml), true);
check('gerbang: ketentuan durasi disebut', timerHtml.includes('Waktu pengerjaan'), true);
check('gerbang: tanpa durasi tetap ada ketentuan', noTimerGateHtml.includes('Tidak ada batas waktu'), true);
check('gerbang: timer start lewat tombol, bukan load', timerHtml.includes("startTimerNow() dari gerbang mulai") || timerHtml.includes('function startTimerNow'), true);
check('gerbang: tidak ada setInterval langsung di init', !/timerBox\.style\.display = '';\s*\n\s*tickTimer\(\);\s*\n\s*setInterval/.test(timerHtml), true);
check('gerbang: petunjuk esai muncul saat ada esai', (() => { const spec = parseQuizSpec(JSON.stringify({ title: 'E', questions: [{ type: 'essay', question: 'x', points: 10 }] })); return renderQuizApp(spec, 'uji-esai').includes('dikoreksi oleh guru'); })(), true);

// Header siswa: timer + Cetak + zoom dikelompokkan dalam satu cluster kanan
// (.q-header-tools), jadi timer selalu sebelahan tombol Cetak.
const headerBlock = timerHtml.slice(timerHtml.indexOf('q-header-inner'), timerHtml.indexOf('</header>'));
const toolsStart = headerBlock.indexOf('q-header-tools');
const timerStart = headerBlock.indexOf('id="quiz-timer"');
const adminToolsStart = headerBlock.indexOf('id="admin-tools"');
const zoomStart = headerBlock.indexOf('id="zoom-out"');
check('header: cluster tools ada', toolsStart !== -1, true);
check('header: timer di dalam cluster tools', toolsStart !== -1 && timerStart > toolsStart, true);
check('header: placeholder alat admin sebelum zoom', toolsStart !== -1 && adminToolsStart > toolsStart && adminToolsStart < zoomStart, true);
check('header: timer pakai ikon jam', headerBlock.includes('q-timer-ico'), true);
const noTimerSpec = parseQuizSpec(JSON.stringify({ title: 'Kuis Tanpa Timer', questions: [{ type: 'short', question: 'a', answer: ['a'] }] }));
const noTimerHtml = renderQuizApp(noTimerSpec, 'uji-tanpa-timer');
check('render: tanpa durasi tidak ada timer', noTimerHtml.includes('id="quiz-timer"'), false);
check('header: tanpa durasi tetap ada cluster tools', noTimerHtml.includes('q-header-tools'), true);
check('render: tanpa name_class tidak ada input kelas', noTimerHtml.includes('id="student-class"'), false);
check('render: form siswa tetap ada tanpa opsi baru', noTimerHtml.includes('id="student-name"'), true);

// Round-trip: durasi dan identitas ikut tersimpan saat editor menyimpan ulang.
const timerRt = quizToAuthoringSource(timerSpec);
check('round-trip: duration_minutes ikut', timerRt.duration_minutes, 45);
check('round-trip: identity_fields ikut', timerRt.identity_fields, 'name_class');
const tanpaTimerRt = quizToAuthoringSource(noTimerSpec);
check('round-trip: tanpa durasi tidak menulis field', 'duration_minutes' in tanpaTimerRt, false);
check('round-trip: tanpa name_class tidak menulis field', 'identity_fields' in tanpaTimerRt, false);

console.log(failed === 0 ? '\nSemua tes lulus.' : `\n${failed} tes GAGAL.`);
process.exit(failed === 0 ? 0 : 1);
