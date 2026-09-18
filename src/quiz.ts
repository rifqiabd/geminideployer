/* ==========================================================================
 * Mode "JSON Soal"
 * --------------------------------------------------------------------------
 * Satu objek JSON diubah jadi aplikasi kuis siap pakai:
 *   1. parseQuizSpec()     - validasi + normalisasi spec dari guru
 *   2. gradeSubmission()   - penilaian otomatis DI SERVER (skor tidak bisa
 *                            dipalsukan dari sisi browser)
 *   3. renderQuizApp()     - generator halaman kuis (vanilla JS, tanpa CDN
 *                            kecuali fitur math/code yang memang diminta)
 *
 * Aset yang di-vendor di domain sendiri: /vendor/quiz.css + font Amiri
 * (/vendor/fonts/*). CDN cuma dipakai untuk KaTeX dan highlight.js.
 * ========================================================================== */

export class QuizError extends Error {}

export type QuestionType = 'choice' | 'multi' | 'true_false' | 'category' | 'short' | 'essay';
export type Feature = 'math' | 'arabic' | 'image' | 'audio' | 'table' | 'code';

/**
 * `all`     : poin penuh hanya kalau jawabannya persis benar (perilaku lama).
 * `partial` : poin dibagi proporsional, dipakai soal MCMA/kategori bergaya AKM.
 */
export type ScoringMode = 'all' | 'partial';

/** Satu pernyataan pada soal kategori (tabel Benar/Salah). */
export type QuizStatement = { text: string; answer: boolean };

/**
 * Satu bacaan/stimulus yang dipakai bersama oleh beberapa soal — seperti
 * "Stimulus 1 untuk soal 1-3" pada naskah TKA. Dirender SEKALI di atas
 * kelompok soalnya, bukan diulang di tiap soal.
 */
export type QuizStimulus = { id: string; title: string; content: string };

export type QuizQuestion = {
  id: string;
  no: number;
  type: QuestionType;
  question: string;
  options: string[];
  points: number;
  /** Kunci jawaban bentuk kanonik. Kosong = tidak dinilai otomatis (esai). */
  keys: string[];
  /** Kunci jawaban untuk ditampilkan ke guru/siswa. */
  keyLabel: string;
  /** Khusus tipe `category`: daftar pernyataan beserta kunci benar/salahnya. */
  statements: QuizStatement[];
  /** Judul dua kolom pada soal kategori, mis. ['Sesuai', 'Tidak Sesuai']. */
  labels: [string, string];
  scoring: ScoringMode;
  /** Pembahasan yang ditulis guru/Gem, ditampilkan setelah siswa mengirim. */
  explanation: string;
  /** Label ranah kognitif bebas, mis. "L1", "Penalaran", "HOTS". */
  level: string;
  /** Id stimulus yang dipakai soal ini ('' kalau berdiri sendiri). */
  stimulusId: string;
};

export type QuizSpec = {
  title: string;
  description: string;
  /** Slug mentah dari JSON (opsional); disanitasi oleh pemanggil. */
  slug: string;
  passingScore: number;
  features: Feature[];
  stimuli: QuizStimulus[];
  /** false = pembahasan tidak ditampilkan ke siswa (tetap tersimpan untuk guru). */
  showExplanation: boolean;
  questions: QuizQuestion[];
};

export type GradedStatement = { text: string; jawaban: string; kunci: string; benar: boolean };

export type GradedDetail = {
  no: number;
  id: string;
  type: QuestionType;
  question_html: string;
  jawaban: string;
  kunci: string | null;
  /** Benar hanya kalau jawabannya persis tepat (untuk skor parsial, lihat `poin`). */
  benar: boolean | null;
  poin: number;
  poin_maks: number;
  /** Pembahasan (HTML) kalau guru/Gem menuliskannya. */
  pembahasan: string;
  /** Rincian per pernyataan, khusus soal kategori. */
  statements?: GradedStatement[];
};

export type GradeResult = {
  /** Nilai dari soal objektif saja (perilaku lama, tetap dipakai di halaman siswa). */
  score: number;
  points_earned: number;
  points_total: number;
  full_points: number;
  essay_pending: number;
  /** Esai yang sudah diberi nilai guru. */
  essay_graded: number;
  essay_earned: number;
  essay_total: number;
  /**
   * Nilai akhir (objektif + esai) setelah SEMUA esai dikoreksi. `null` selama
   * masih ada esai yang belum dikoreksi, supaya nilai siswa tidak turun sepihak
   * hanya karena esainya belum selesai dinilai.
   */
  final_score: number | null;
  detail: GradedDetail[];
};

const MAX_QUESTIONS = 300;

// Versi di-pin: kalau CDN diam-diam naik versi, tampilan kuis tidak berubah.
const KATEX_VERSION = '0.18.6';
const HLJS_VERSION = '11.11.2';
const KATEX_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/' + KATEX_VERSION;
const HLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/' + HLJS_VERSION;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|oga|aac|opus)(\?|#|$)/i;
const ARABIC_RUN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Token gambar tanpa file: `media:nama-slot`. Gemini cuma menulis nama slotnya,
// guru yang mengunggah fotonya lewat panel Gambar. Halaman siswa menerjemahkan
// token ini jadi /media/<slug>/<nama-slot>.
const MEDIA_TOKEN = /^media:\s*([A-Za-z0-9_.\-]+)$/i;
const MEDIA_SLOT_SCAN = /media:\s*([A-Za-z0-9_.\-]+)/gi;

const TYPE_ALIASES: Record<string, QuestionType> = {
  choice: 'choice',
  pg: 'choice',
  pilihan_ganda: 'choice',
  'pilihan-ganda': 'choice',
  multiple_choice: 'choice',
  single: 'choice',
  multi: 'multi',
  multiple: 'multi',
  checkbox: 'multi',
  multi_jawaban: 'multi',
  mcma: 'multi',
  pilihan_ganda_kompleks: 'multi',
  pg_kompleks: 'multi',
  // Soal kategori: satu tabel berisi beberapa pernyataan yang masing-masing
  // dinilai Benar/Salah (gaya AKM "Pilihan Ganda Kompleks - Kategori").
  category: 'category',
  kategori: 'category',
  matrix: 'category',
  matriks: 'category',
  multi_true_false: 'category',
  benar_salah_tabel: 'category',
  tabel_benar_salah: 'category',
  tabel_kategori: 'category',
  mcma_kategori: 'category',
  sesuai_tidak_sesuai: 'category',
  true_false: 'true_false',
  'benar-salah': 'true_false',
  benar_salah: 'true_false',
  tf: 'true_false',
  boolean: 'true_false',
  short: 'short',
  isian: 'short',
  isian_singkat: 'short',
  short_answer: 'short',
  singkat: 'short',
  essay: 'essay',
  esai: 'essay',
  uraian: 'essay',
  text: 'essay',
};

const FEATURE_ALIASES: Record<string, Feature> = {
  math: 'math',
  rumus: 'math',
  matematika: 'math',
  latex: 'math',
  katex: 'math',
  arab: 'arabic',
  arabic: 'arabic',
  arabika: 'arabic',
  rtl: 'arabic',
  gambar: 'image',
  image: 'image',
  img: 'image',
  foto: 'image',
  audio: 'audio',
  suara: 'audio',
  listening: 'audio',
  tabel: 'table',
  table: 'table',
  kode: 'code',
  code: 'code',
  pemrograman: 'code',
};

/* -------------------------------------------------------------------------- */
/* Helper teks                                                                */
/* -------------------------------------------------------------------------- */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalisasi untuk pencocokan jawaban.
 * Toleran terhadap: harakat/tanda Arab, hamza (أ/إ/آ -> ا), alif maqsura (ى -> ي),
 * ta marbuta (ة -> ه), tatweel, huruf besar-kecil, dan tanda baca.
 */
function normalizeAnswer(text: string): string {
  return String(text)
    .normalize('NFKD')
    // Tanda diakritik Latin + harakat Arab (fathah, kasrah, dhammah, sukun,
    // tasydid, hamza di atas/bawah, maddah). Wajib: NFKD memecah "إ" jadi
    // alif + U+0655, jadi tanpa ini "لا اله" tidak akan pernah cocok dengan
    // kunci "لا إله" — padahal itulah cara siswa menulis.
    .replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0640/g, '')
    // Angka Arab (٠-٩ dan ۰-۹) disamakan dengan angka Latin.
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nama slot media — dipakai di token `media:nama` dan di URL /media/<slug>/<nama>.
 * Selalu huruf kecil, tanpa garis miring, tanpa titik di awal/akhir, jadi tidak
 * bisa dipakai keluar dari folder aplikasi (path traversal) atau menyembunyikan file.
 */
export function sanitizeMediaName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, 64);
}

/** Basis URL semua media milik satu aplikasi. */
export function mediaBaseFor(slug: string): string {
  return `/media/${encodeURIComponent(slug)}/`;
}

/**
 * Ubah nilai gambar jadi URL yang aman dipakai di src:
 *   - `media:fotosintesis` -> /media/<slug>/fotosintesis (diisi guru lewat panel Gambar)
 *   - `https://...`        -> dipakai apa adanya
 *   - `/path/relatif`      -> dipakai apa adanya (mis. hasil unggahan di domain sendiri)
 * Selain itu ditolak, termasuk `javascript:` dan `data:` (data URI bisa menyelundupkan HTML).
 */
export function resolveMediaUrl(raw: unknown, mediaBase = ''): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/^media:/i.test(value)) {
    const name = sanitizeMediaName(value.replace(/^media:/i, ''));
    return name && mediaBase ? mediaBase + encodeURIComponent(name) : '';
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('..')) return value;
  return '';
}

/**
 * Field gambar terpisah (`"image": "media:bagan"`) diubah jadi markdown supaya
 * ikut diproses renderer yang sama dengan gambar di dalam teks soal.
 */
function imageFieldToMarkdown(rawImage: unknown): string {
  let src = '';
  let alt = 'Gambar soal';
  if (typeof rawImage === 'string') {
    src = rawImage.trim();
  } else if (rawImage && typeof rawImage === 'object' && !Array.isArray(rawImage)) {
    const obj = rawImage as Record<string, unknown>;
    const slot = pick(obj, ['media', 'slot', 'nama']);
    src = slot !== undefined ? `media:${String(slot).trim()}` : String(pick(obj, ['src', 'url', 'file']) ?? '').trim();
    alt = String(pick(obj, ['alt', 'caption', 'keterangan']) ?? alt).trim() || alt;
  }
  if (!src) return '';
  return `![${alt.replace(/[[\]]/g, '')}](${src})`;
}

/** Daftar nama slot media yang dipakai sebuah kuis (untuk panel Gambar guru). */
export function collectMediaSlots(quiz: QuizSpec): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(new RegExp(MEDIA_SLOT_SCAN.source, 'gi'))) {
      const name = sanitizeMediaName(match[1]);
      if (name) found.add(name);
    }
  };
  scan(quiz.title);
  scan(quiz.description);
  for (const stimulus of quiz.stimuli ?? []) {
    scan(stimulus.title);
    scan(stimulus.content);
  }
  for (const question of quiz.questions) {
    scan(question.question);
    scan(question.explanation);
    for (const option of question.options) scan(option);
    for (const statement of question.statements ?? []) scan(statement.text);
  }
  return [...found].sort();
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim() !== '');
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [String(value)];
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Ambil JSON mentah (setelah melepas pagar ``` kalau ada) untuk disimpan apa adanya. */
export function parseQuizJson(raw: string): unknown {
  return JSON.parse(stripFences(raw));
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|JSON)?\s*\r?\n?/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Parsing spec                                                               */
/* -------------------------------------------------------------------------- */

function matchOptionIndex(value: unknown, options: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return -1;
  // 1) cocokkan dengan teks pilihan lebih dulu, supaya opsi berupa angka
  //    (misal ["10","20","30"] dengan kunci "20") tidak salah dibaca sebagai indeks.
  const byText = options.findIndex((opt) => normalizeAnswer(opt) === normalizeAnswer(text));
  if (byText >= 0) return byText;
  if (/^[A-Za-z]$/.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
  if (/^\d+$/.test(text)) return Number(text);
  return -1;
}

function resolveBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = normalizeAnswer(String(value ?? ''));
  if (['true', 'benar', 'betul', 'b', 'ya', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'salah', 's', 'tidak', 'no', 'n', '0'].includes(text)) return false;
  return null;
}

/**
 * Daftar pernyataan soal kategori. Tiap pernyataan boleh ditulis sebagai objek
 * `{ "text": "...", "answer": true }`, atau sebagai teks biasa sementara
 * kuncinya ditaruh sejajar di `"answers": [true, false, true]`.
 */
function normalizeStatements(rawValue: unknown, fallback: string[], no: number): QuizStatement[] {
  if (!Array.isArray(rawValue)) return [];
  const statements: QuizStatement[] = [];
  rawValue.forEach((entry, index) => {
    let text = '';
    let answer: unknown;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      text = String(pick(obj, ['text', 'pernyataan', 'statement', 'label', 'isi']) ?? '').trim();
      answer = pick(obj, ['answer', 'kunci', 'kunci_jawaban', 'jawaban', 'benar', 'value']);
    } else {
      text = String(entry ?? '').trim();
    }
    if (answer === undefined) answer = fallback[index];
    const truth = resolveBoolean(answer);
    if (!text) throw new QuizError(`Soal #${no}: pernyataan ke-${index + 1} tidak punya teks.`);
    if (truth === null) {
      throw new QuizError(
        `Soal #${no}: pernyataan ke-${index + 1} belum punya kunci. Tulis "answer": true/false di pernyataan itu, atau isi "answers": [true, false, ...].`
      );
    }
    statements.push({ text, answer: truth });
  });
  return statements;
}

/** Judul dua kolom tabel kategori; bisa diganti mis. Sesuai / Tidak Sesuai. */
function normalizeLabels(raw: Record<string, unknown>): [string, string] {
  const pair = pick(raw, ['labels', 'kolom', 'label_kolom', 'columns']);
  if (Array.isArray(pair) && pair.length >= 2) return [String(pair[0]), String(pair[1])];
  const yes = pick(raw, ['label_benar', 'label_true', 'label_sesuai']);
  const no = pick(raw, ['label_salah', 'label_false', 'label_tidak_sesuai']);
  if (yes !== undefined || no !== undefined) return [String(yes ?? 'Benar'), String(no ?? 'Salah')];
  return ['Benar', 'Salah'];
}

/** Jawaban soal kategori jadi satu baris ringkas: "1: Salah · 2: Benar". */
function statementDisplay(question: QuizQuestion, values: Array<boolean | null>): string {
  return question.statements
    .map((_statement, index) => {
      const value = values[index];
      const label = value === null || value === undefined ? '(kosong)' : value ? question.labels[0] : question.labels[1];
      return `${index + 1}: ${label}`;
    })
    .join(' · ');
}

/** Bacaan/stimulus yang dipakai bersama oleh beberapa soal. */
function normalizeStimuli(rawValue: unknown): QuizStimulus[] {
  const list = Array.isArray(rawValue) ? rawValue : rawValue === undefined || rawValue === null ? [] : [rawValue];
  const stimuli: QuizStimulus[] = [];
  list.forEach((entry, index) => {
    let id = '';
    let title = '';
    let content = '';
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      id = String(pick(obj, ['id', 'kode']) ?? '').trim();
      title = String(pick(obj, ['title', 'judul', 'nama']) ?? '').trim();
      content = String(pick(obj, ['content', 'text', 'teks', 'isi', 'bacaan', 'konten']) ?? '').trim();
    } else {
      content = String(entry ?? '').trim();
    }
    if (!content) return;
    stimuli.push({ id: id || `s${index + 1}`, title: title || `Bacaan ${index + 1}`, content });
  });
  return stimuli;
}

function normalizeQuestion(rawValue: unknown, index: number): QuizQuestion {
  const no = index + 1;
  if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
    throw new QuizError(`Soal #${no}: tiap soal harus berupa objek { ... }.`);
  }

  const raw = rawValue as Record<string, unknown>;
  const rawQuestion = String(pick(raw, ['question', 'pertanyaan', 'soal', 'text', 'teks']) ?? '').trim();
  if (!rawQuestion) throw new QuizError(`Soal #${no}: field "question" (teks soal) wajib diisi.`);

  // Soal bergambar boleh menaruh gambarnya di field terpisah (`image`/`gambar`/`foto`).
  // Isinya `media:nama-slot` (diunggah lewat panel Gambar) atau URL http(s).
  const imageMarkdown = imageFieldToMarkdown(pick(raw, ['image', 'gambar', 'foto', 'img']));
  const question = imageMarkdown ? `${rawQuestion}\n\n${imageMarkdown}` : rawQuestion;

  // Soal kategori: pernyataan + kuncinya. Lebih diperiksa dulu sebelum tipe
  // dipastikan, supaya `type: "true_false"` yang isinya tabel ikut tertangkap.
  const statementFallback = asStringList(pick(raw, ['answers', 'kunci_benar_salah']));
  const statements = normalizeStatements(
    pick(raw, ['statements', 'pernyataan', 'rows', 'baris', 'daftar_pernyataan', 'list_pernyataan']),
    statementFallback,
    no
  );

  const rawType = String(pick(raw, ['type', 'tipe', 'jenis']) ?? '')
    .toLowerCase()
    .replace(/[-\s/]/g, '_');

  let type = rawType ? TYPE_ALIASES[rawType] : undefined;
  if (!type) {
    if (rawType) {
      throw new QuizError(
        `Soal #${no}: tipe "${rawType}" tidak dikenal. Pakai: choice, multi, true_false, category, short, atau essay.`
      );
    }
    type = statements.length ? 'category' : 'choice';
  } else if (type === 'true_false' && statements.length) {
    // Gemini kadang menulis type "true_false" padahal isinya tabel pernyataan.
    type = 'category';
  }

  const rawPoints = Number(pick(raw, ['points', 'poin', 'bobot', 'skor']) ?? 1);
  const points = Number.isFinite(rawPoints) && rawPoints > 0 ? rawPoints : 1;

  const rawScoring = String(pick(raw, ['scoring', 'penilaian', 'skor_parsial', 'model_skor']) ?? '')
    .toLowerCase()
    .replace(/[-\s]/g, '_');
  const scoring: ScoringMode = ['partial', 'parsial', 'sebagian', 'proporsional', 'partial_credit'].includes(rawScoring)
    ? 'partial'
    : 'all';

  const answer = pick(raw, ['answer', 'kunci', 'kunci_jawaban', 'jawaban_benar', 'correct', 'correct_answer']);
  const base = {
    id: '',
    no,
    type,
    question,
    points,
    statements: [] as QuizStatement[],
    labels: normalizeLabels(raw),
    scoring,
    explanation: String(
      pick(raw, ['explanation', 'pembahasan', 'penjelasan', 'bahasan', 'reasoning', 'uraian_jawaban']) ?? ''
    ).trim(),
    level: String(pick(raw, ['level', 'level_kognitif', 'kognitif', 'cognitive_level', 'ranah']) ?? '').trim(),
    // Diisi di parseQuizSpec setelah daftar stimulus dikumpulkan, karena isinya
    // bisa berupa id stimulus bersama ATAU teks bacaan yang ditulis langsung.
    stimulusId: '',
  };

  if (type === 'category') {
    if (!statements.length) {
      throw new QuizError(
        `Soal #${no}: tipe category butuh daftar "statements" berisi pernyataan beserta kunci benar/salahnya.`
      );
    }
    const keyLabel = statements
      .map((statement, index) => `${index + 1}: ${statement.answer ? base.labels[0] : base.labels[1]}`)
      .join(' · ');
    return {
      ...base,
      options: [],
      statements,
      keys: statements.map((statement) => String(statement.answer)),
      keyLabel,
    };
  }

  if (type === 'choice' || type === 'multi') {
    const rawOptions = pick(raw, ['options', 'opsi', 'pilihan', 'choices', 'daftar_pilihan']);
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((opt) => String(opt).trim()).filter((opt) => opt !== '')
      : [];
    if (options.length < 2) {
      throw new QuizError(`Soal #${no}: tipe ${type} butuh "options" berisi minimal 2 pilihan.`);
    }
    if (answer === undefined) throw new QuizError(`Soal #${no}: field "answer" (kunci jawaban) wajib diisi.`);

    if (type === 'choice') {
      const idx = matchOptionIndex(answer, options);
      if (idx < 0 || idx >= options.length) {
        throw new QuizError(`Soal #${no}: kunci "${String(answer)}" tidak cocok dengan pilihan yang tersedia.`);
      }
      return { ...base, options, keys: [String(idx)], keyLabel: `${optionLetter(idx)}. ${options[idx]}` };
    }

    const list = asStringList(answer);
    if (!list.length) throw new QuizError(`Soal #${no}: kunci multi-jawaban tidak boleh kosong.`);
    const indexes: number[] = [];
    for (const item of list) {
      const idx = matchOptionIndex(item, options);
      if (idx < 0 || idx >= options.length) {
        throw new QuizError(`Soal #${no}: kunci "${item}" tidak cocok dengan pilihan yang tersedia.`);
      }
      if (!indexes.includes(idx)) indexes.push(idx);
    }
    indexes.sort((a, b) => a - b);
    return {
      ...base,
      options,
      keys: [indexes.join('|')],
      keyLabel: indexes.map((idx) => `${optionLetter(idx)}. ${options[idx]}`).join(' | '),
    };
  }

  if (type === 'true_false') {
    const truth = resolveBoolean(answer);
    if (truth === null) {
      throw new QuizError(`Soal #${no}: kunci benar/salah harus "benar"/"salah" (atau true/false).`);
    }
    return { ...base, options: ['Benar', 'Salah'], keys: [String(truth)], keyLabel: truth ? 'Benar' : 'Salah' };
  }

  if (type === 'short') {
    const accepted = asStringList(answer).map((item) => normalizeAnswer(item)).filter(Boolean);
    if (!accepted.length) {
      throw new QuizError(`Soal #${no}: tipe isian butuh "answer" berisi jawaban yang diterima.`);
    }
    return { ...base, options: [], keys: accepted, keyLabel: asStringList(answer).join(' / ') };
  }

  // essay
  return { ...base, options: [], keys: [], keyLabel: '' };
}

function detectFeatures(rawText: string, questions: QuizQuestion[]): Set<Feature> {
  // JSON mentah menulis baris baru sebagai escape "\n" (dua karakter), jadi
  // deteksi berbasis baris (mis. tabel markdown) gagal kalau escape-nya tidak
  // dibuka lebih dulu. Membuka escape juga menghindari false positive "\"...""
  // yang tidak sengaja terbaca sebagai rumus LaTeX.
  const decoded = rawText.replace(/\\[nrt]/g, '\n').replace(/\\"/g, '"');
  const blob =
    decoded +
    '\n' +
    questions
      .map((q) => [q.question, q.options.join('\n'), (q.statements ?? []).map((s) => s.text).join('\n'), q.explanation].join('\n'))
      .join('\n');
  const found = new Set<Feature>();
  if (/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\[a-zA-Z]{2,}/.test(blob)) found.add('math');
  if (ARABIC_RUN.test(blob)) found.add('arabic');
  if (/```/.test(blob)) found.add('code');
  if (/^[^\S\r\n]*\|.*\|[^\S\r\n]*$/m.test(blob)) found.add('table');
  if (/!\[[^\]]*\]\([^)]+\)/.test(blob) || IMAGE_EXT.test(blob) || /media:[A-Za-z0-9_.\-]+/i.test(blob)) found.add('image');
  if (/@audio\([^)]+\)|!\[[^\]]*\]\([^)]+\)/.test(blob) || AUDIO_EXT.test(blob)) found.add('audio');
  return found;
}

export function parseQuizSpec(raw: string): QuizSpec {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch {
    throw new QuizError(
      'Teks bukan JSON yang valid. Pastikan memakai kurung kurawal { } dan tanda kutip ganda ("), bukan kutip tunggal.'
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new QuizError('JSON harus berupa satu objek, contoh: { "title": "...", "questions": [ ... ] }');
  }

  const obj = data as Record<string, unknown>;
  const rawQuestions = pick(obj, ['questions', 'soal', 'items', 'daftar_soal']);
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new QuizError('Field "questions" wajib ada dan berisi minimal satu soal.');
  }
  if (rawQuestions.length > MAX_QUESTIONS) {
    throw new QuizError(`Jumlah soal ${rawQuestions.length} melebihi batas ${MAX_QUESTIONS} soal.`);
  }

  const questions = rawQuestions.map((item, index) => normalizeQuestion(item, index));
  const seen = new Set<string>();
  for (const question of questions) {
    let id = String((rawQuestions[question.no - 1] as Record<string, unknown>)?.id ?? `q${question.no}`).trim() || `q${question.no}`;
    while (seen.has(id)) id = `${id}-${question.no}`;
    seen.add(id);
    question.id = id;
  }

  // Bacaan bersama ("Stimulus 1 untuk soal 1-3"): dikumpulkan dulu, lalu tiap
  // soal diarahkan ke stimulusnya. Bisa berupa id bersama, atau teks bacaan yang
  // ditulis langsung di soal — yang kedua otomatis dibuatkan stimulus sendiri.
  const stimuli = normalizeStimuli(pick(obj, ['stimuli', 'stimulus', 'bacaan', 'daftar_bacaan', 'wacana']));
  const knownStimulus = new Set(stimuli.map((stimulus) => stimulus.id));
  let autoStimulus = 0;
  for (const question of questions) {
    const rawQuestion = rawQuestions[question.no - 1] as Record<string, unknown>;
    const reference = pick(rawQuestion, ['stimulus', 'stimulus_id', 'bacaan', 'wacana']);
    if (reference === undefined) continue;

    if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
      const obj = reference as Record<string, unknown>;
      const content = String(pick(obj, ['content', 'text', 'teks', 'isi', 'bacaan', 'konten']) ?? '').trim();
      if (!content) continue;
      autoStimulus += 1;
      const id = `s-auto-${autoStimulus}`;
      stimuli.push({ id, title: String(pick(obj, ['title', 'judul', 'nama']) ?? `Bacaan ${autoStimulus}`), content });
      question.stimulusId = id;
      continue;
    }

    const text = String(reference).trim();
    if (!text) continue;
    if (knownStimulus.has(text)) {
      question.stimulusId = text;
      continue;
    }
    autoStimulus += 1;
    const id = `s-auto-${autoStimulus}`;
    stimuli.push({ id, title: `Bacaan ${autoStimulus}`, content: text });
    question.stimulusId = id;
  }

  const features = detectFeatures(raw, questions);
  const addFeatures = asStringList(pick(obj, ['features', 'fitur']));
  const removeFeatures = asStringList(pick(obj, ['without_features', 'tanpa_fitur']));
  for (const name of addFeatures) {
    const feature = FEATURE_ALIASES[name.toLowerCase().trim()];
    if (!feature) throw new QuizError(`Fitur "${name}" tidak dikenal. Pilihan: math, arabic, image, audio, table, code.`);
    features.add(feature);
  }
  for (const name of removeFeatures) features.delete(FEATURE_ALIASES[name.toLowerCase().trim()]);

  const rawKkm = Number(pick(obj, ['passing_score', 'kkm', 'nilai_minimum', 'nilai_lulus']) ?? 70);
  const passingScore = Number.isFinite(rawKkm) ? Math.min(100, Math.max(0, Math.round(rawKkm))) : 70;

  return {
    title: String(pick(obj, ['title', 'judul', 'nama']) ?? '').trim(),
    description: String(pick(obj, ['description', 'deskripsi', 'petunjuk', 'instruksi']) ?? '').trim(),
    slug: String(pick(obj, ['slug']) ?? '').trim(),
    passingScore,
    features: [...features],
    stimuli,
    showExplanation: resolveBoolean(pick(obj, ['show_explanation', 'tampilkan_pembahasan'])) !== false,
    questions,
  };
}

/**
 * Kebalikan dari parseQuizSpec: susun kembali format tulis yang guru kenal
 * (`options` + `answer` + `points`) dari spec yang sudah dinormalisasi.
 * Dipakai editor soal — termasuk menarik kembali gambar yang tadi ditempelkan
 * ke ujung teks soal supaya tidak jadi gambar dobel saat disimpan ulang.
 */
const APPENDED_IMAGE_RE = /\r?\n\r?\n(!\[[^\]]*\]\(media:[^)\s]+\)|media:[A-Za-z0-9_.\-]+)\s*$/i;

function pullTrailingImage(text: string): { text: string; image: string } {
  const match = text.match(APPENDED_IMAGE_RE);
  if (!match) return { text, image: '' };
  const slot = match[1].match(/media:[A-Za-z0-9_.\-]+/i);
  return { text: text.slice(0, match.index), image: slot ? slot[0] : '' };
}

export function quizToAuthoringSource(quiz: QuizSpec): Record<string, unknown> {
  const questions = quiz.questions.map((question) => {
    const { text, image } = pullTrailingImage(question.question);
    const item: Record<string, unknown> = {
      id: question.id,
      type: question.type,
      question: text,
    };
    if (image) item.image = image;
    if (question.points !== 1) item.points = question.points;
    if (question.level) item.level = question.level;
    if (question.explanation) item.explanation = question.explanation;
    if (question.scoring === 'partial') item.scoring = 'partial';
    if (question.stimulusId) item.stimulus = question.stimulusId;

    if (question.type === 'choice') {
      item.options = question.options;
      item.answer = optionLetter(Number(question.keys[0]));
    } else if (question.type === 'multi') {
      item.options = question.options;
      item.answer = question.keys[0].split('|').map((index) => optionLetter(Number(index)));
    } else if (question.type === 'true_false') {
      item.answer = question.keys[0] === 'true';
    } else if (question.type === 'category') {
      item.statements = question.statements.map((statement) => ({ text: statement.text, answer: statement.answer }));
      if (question.labels[0] !== 'Benar' || question.labels[1] !== 'Salah') item.labels = question.labels;
    } else if (question.type === 'short') {
      item.answer = question.keys;
    }
    return item;
  });

  const stimuli = quiz.stimuli ?? [];
  return {
    title: quiz.title,
    description: quiz.description,
    passing_score: quiz.passingScore,
    ...(stimuli.length ? { stimuli } : {}),
    ...(quiz.showExplanation === false ? { show_explanation: false } : {}),
    questions,
  };
}

/* -------------------------------------------------------------------------- */
/* Renderer teks kaya (subset markdown aman)                                  */
/* -------------------------------------------------------------------------- */

function createStash() {
  const items: string[] = [];
  return {
    put(html: string): string {
      items.push(html);
      return `\u0000${items.length - 1}\u0000`;
    },
    has(text: string): boolean {
      return text.includes('\u0000');
    },
    restore(text: string): string {
      return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => items[Number(index)] ?? '');
    },
  };
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return trimmed
    .replace(/^\||\|$/g, '')
    .split('|')
    .every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][], features: Set<Feature>, mediaBase: string): string {
  const head = header.map((cell) => `<th>${inlineRich(cell, features, mediaBase)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = header.map((_unused, index) => `<td>${inlineRich(row[index] ?? '', features, mediaBase)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="q-table-wrap"><table class="q-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function inlineRich(text: string, features: Set<Feature>, mediaBase: string): string {
  const stash = createStash();
  let out = text;

  if (features.has('code')) {
    out = out.replace(/`([^`]+)`/g, (_match, code: string) => stash.put(`<code>${escapeHtml(code)}</code>`));
  }
  if (features.has('math')) {
    // Biarkan KaTeX yang mengurus isi rumus; cuma dikeluarkan dari proses escape.
    out = out.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (match) => stash.put(match));
  }

  const media = /!\[([^\]]*)\]\(([^)\s]+)\)|@(img|audio)\(([^)\s]+)\)/g;
  out = out.replace(media, (match, alt: string | undefined, mdUrl: string | undefined, kind: string | undefined, atUrl: string | undefined) => {
    const url = resolveMediaUrl(mdUrl ?? atUrl, mediaBase);
    if (!url) return match;
    const isAudio = kind === 'audio' || String(alt ?? '').toLowerCase() === 'audio' || AUDIO_EXT.test(url);
    if (isAudio) {
      if (!features.has('audio')) return match;
      return stash.put(`<audio class="q-audio" controls preload="none" src="${url}"></audio>`);
    }
    if (!features.has('image')) return match;
    return stash.put(`<img class="q-img" src="${url}" alt="${escapeHtml(alt ?? '')}" loading="lazy">`);
  });

  out = escapeHtml(out);

  if (features.has('arabic')) {
    out = out.replace(
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF](?:[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\d\p{M}]*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF])?/gu,
      (match) => `<span class="q-ar-inline">${match}</span>`
    );
  }

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  out = out.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trailing = url.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    if (features.has('image') && IMAGE_EXT.test(clean)) {
      return `<img class="q-img" src="${clean}" alt="" loading="lazy">${trailing}`;
    }
    if (features.has('audio') && AUDIO_EXT.test(clean)) {
      return `<audio class="q-audio" controls preload="none" src="${clean}"></audio>${trailing}`;
    }
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
  });

  return stash.restore(out);
}

function isArabicLine(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters) return false;
  const arabic = letters.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? [];
  return arabic.length / letters.length > 0.5;
}

export function renderRichText(source: unknown, features: Set<Feature>, mediaBase = ''): string {
  const text = String(source ?? '');
  if (!text.trim()) return '';

  const stash = createStash();
  let prepared = text;
  if (features.has('code')) {
    prepared = prepared.replace(/```([a-zA-Z0-9+#-]*)\r?\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return stash.put(`<pre class="q-code"><code${cls}>${escapeHtml(code.replace(/\s+$/, ''))}</code></pre>`);
    });
  }

  const lines = prepared.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    // Baris yang isinya murni placeholder (blok kode / media) dikeluarkan
    // sebagai blok sendiri supaya tidak ada <pre> di dalam <p>.
    if (/^(?:\u0000\d+\u0000\s*)+$/.test(trimmed)) {
      flush();
      out.push(stash.restore(trimmed));
      continue;
    }

    // Baris yang isinya cuma token slot (`media:fotosintesis`) jadi gambar sendiri.
    if (features.has('image') && MEDIA_TOKEN.test(trimmed)) {
      const url = resolveMediaUrl(trimmed, mediaBase);
      if (url) {
        flush();
        out.push(`<img class="q-img" src="${url}" alt="" loading="lazy">`);
        continue;
      }
    }

    if (features.has('table') && /^\|.*\|$/.test(trimmed) && isTableSeparator(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      i -= 1;
      out.push(renderTable(header, rows, features, mediaBase));
      continue;
    }

    if (features.has('arabic') && isArabicLine(trimmed)) {
      flush();
      out.push(`<div class="q-ar">${inlineRich(trimmed, features, mediaBase)}</div>`);
      continue;
    }

    paragraph.push(inlineRich(trimmed, features, mediaBase));
  }
  flush();

  return stash.restore(out.join('\n'));
}

/* -------------------------------------------------------------------------- */
/* Penilaian                                                                  */
/* -------------------------------------------------------------------------- */

type Evaluated = {
  /** Teks jawaban siswa, dipakai di layar pembahasan. */
  display: string;
  /** Benar secara utuh. Dipakai statistik analisis butir soal. */
  correct: boolean;
  /** Proporsi 0..1 untuk perhitungan skor parsial. */
  ratio: number;
};

/**
 * Penilaian satu soal. Tiap tipe punya aturannya sendiri, jadi menambah tipe
 * baru cukup menambah satu cabang di sini tanpa mengubah seluruh penilai.
 */
function evaluate(question: QuizQuestion, raw: unknown): Evaluated {
  const unanswered: Evaluated = { display: '', correct: false, ratio: 0 };

  if (question.type === 'essay') {
    return { display: String(raw ?? '').trim(), correct: false, ratio: 0 };
  }

  if (question.type === 'short') {
    const text = String(raw ?? '').trim();
    const canon = normalizeAnswer(text);
    const correct = canon !== '' && question.keys.includes(canon);
    return { display: text, correct, ratio: correct ? 1 : 0 };
  }

  if (question.type === 'true_false') {
    const truth = resolveBoolean(raw);
    if (truth === null) return unanswered;
    const correct = String(truth) === question.keys[0];
    return { display: truth ? 'Benar' : 'Salah', correct, ratio: correct ? 1 : 0 };
  }

  if (question.type === 'choice') {
    const index = matchOptionIndex(raw, question.options);
    if (index < 0 || index >= question.options.length) return unanswered;
    const correct = String(index) === question.keys[0];
    return { display: `${optionLetter(index)}. ${question.options[index]}`, correct, ratio: correct ? 1 : 0 };
  }

  if (question.type === 'category') {
    const values = Array.isArray(raw) ? raw : [];
    const picked: Array<boolean | null> = question.statements.map((_statement, index) =>
      values[index] === undefined ? null : resolveBoolean(values[index])
    );
    if (picked.every((value) => value === null)) return unanswered;

    let right = 0;
    question.statements.forEach((statement, index) => {
      if (picked[index] === statement.answer) right += 1;
    });
    const total = question.statements.length || 1;
    return {
      display: statementDisplay(question, picked),
      correct: question.statements.length > 0 && right === question.statements.length,
      ratio: right / total,
    };
  }

  // multi / MCMA: skor parsial memberi ruang untuk jawaban yang sebagian benar.
  const list = asStringList(raw);
  if (!list.length) return unanswered;
  const picked: number[] = [];
  for (const item of list) {
    const index = matchOptionIndex(item, question.options);
    if (index >= 0 && index < question.options.length && !picked.includes(index)) picked.push(index);
  }
  if (!picked.length) return unanswered;
  picked.sort((a, b) => a - b);

  const keys = (question.keys[0] ?? '')
    .split('|')
    .filter((value) => value !== '')
    .map(Number);
  const hits = picked.filter((index) => keys.includes(index)).length;
  const misses = picked.filter((index) => !keys.includes(index)).length;
  return {
    display: picked.map((index) => optionLetter(index)).join(', '),
    correct: keys.length > 0 && hits === keys.length && misses === 0,
    // Pilihan yang salah mengurangi, tapi skor tidak pernah negatif.
    ratio: Math.max(0, Math.min(1, (hits - misses) / (keys.length || 1))),
  };
}

/** Rincian per pernyataan supaya siswa tahu baris mana yang keliru. */
function toGradedStatements(question: QuizQuestion, raw: unknown): GradedStatement[] | undefined {
  if (question.type !== 'category') return undefined;
  const values = Array.isArray(raw) ? raw : [];
  return question.statements.map((statement, index) => {
    const picked = values[index] === undefined ? null : resolveBoolean(values[index]);
    return {
      text: statement.text,
      jawaban: picked === null ? '(kosong)' : picked ? question.labels[0] : question.labels[1],
      kunci: statement.answer ? question.labels[0] : question.labels[1],
      benar: picked === statement.answer,
    };
  });
}

function normalizeSubmission(raw: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const key = record.id ?? record.q ?? record.key;
        if (key !== undefined && key !== null) {
          map.set(String(key), record.value ?? record.answer ?? record.jawaban);
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) map.set(key, value);
  }
  return map;
}

export function gradeSubmission(
  quiz: QuizSpec,
  rawAnswers: unknown,
  mediaBase = '',
  /** Poin yang diberikan guru per id soal esai, mis. { q7: 3 }. */
  essayScores: Record<string, number> = {}
): GradeResult {
  const submitted = normalizeSubmission(rawAnswers);
  const features = new Set(quiz.features);

  let earned = 0;
  let objectiveTotal = 0;
  let fullPoints = 0;
  let essayPending = 0;
  let essayGraded = 0;
  let essayEarned = 0;
  let essayTotal = 0;
  const detail: GradedDetail[] = [];

  for (const question of quiz.questions) {
    fullPoints += question.points;
    const rawAnswer = submitted.get(question.id);
    const evaluated = evaluate(question, rawAnswer);

    if (question.type === 'essay') {
      essayTotal += question.points;
      const rawScore = essayScores[question.id];
      const alreadyGraded = typeof rawScore === 'number' && Number.isFinite(rawScore);
      const awarded = alreadyGraded ? Math.min(question.points, Math.max(0, rawScore)) : 0;
      if (alreadyGraded) {
        essayGraded += 1;
        essayEarned += awarded;
      } else {
        essayPending += 1;
      }
      detail.push({
        no: question.no,
        id: question.id,
        type: question.type,
        question_html: renderRichText(question.question, features, mediaBase),
        jawaban: evaluated.display,
        kunci: null,
        benar: null,
        poin: awarded,
        poin_maks: question.points,
        pembahasan: question.explanation ? renderRichText(question.explanation, features, mediaBase) : '',
      });
      continue;
    }

    objectiveTotal += question.points;
    // Skor parsial (AKM) memakai proporsi; mode biasa tetap poin penuh atau nol.
    const gained =
      question.scoring === 'partial' ? question.points * evaluated.ratio : evaluated.correct ? question.points : 0;
    const awarded = Math.round(gained * 100) / 100;
    earned += awarded;

    detail.push({
      no: question.no,
      id: question.id,
      type: question.type,
      question_html: renderRichText(question.question, features, mediaBase),
      jawaban: evaluated.display,
      kunci: question.keyLabel,
      benar: evaluated.correct,
      poin: awarded,
      poin_maks: question.points,
      pembahasan: question.explanation ? renderRichText(question.explanation, features, mediaBase) : '',
      statements: toGradedStatements(question, rawAnswer),
    });
  }

  return {
    score: objectiveTotal ? Math.round((earned / objectiveTotal) * 100) : 0,
    points_earned: earned,
    points_total: objectiveTotal,
    full_points: fullPoints,
    essay_pending: essayPending,
    essay_graded: essayGraded,
    essay_earned: essayEarned,
    essay_total: essayTotal,
    final_score: essayPending === 0 && fullPoints ? Math.round(((earned + essayEarned) / fullPoints) * 100) : null,
    detail,
  };
}

/* -------------------------------------------------------------------------- */
/* Generator halaman kuis                                                     */
/* -------------------------------------------------------------------------- */

/** Kartu bacaan/stimulus bersama, ditampilkan sekali di atas kelompok soalnya. */
function renderStimulusCard(stimulus: QuizStimulus, features: Set<Feature>, mediaBase: string, order: number): string {
  return `
    <section class="q-stimulus" id="stim-${escapeHtml(stimulus.id)}">
      <div class="q-stimulus-head">
        <span class="q-stimulus-badge">Bacaan ${order}</span>
        <h2>${escapeHtml(stimulus.title)}</h2>
      </div>
      <div class="q-stimulus-body">${renderRichText(stimulus.content, features, mediaBase)}</div>
    </section>`;
}

/** Tabel pernyataan Benar/Salah untuk soal kategori. */
function renderCategoryTable(question: QuizQuestion, features: Set<Feature>, mediaBase: string): string {
  const rows = question.statements
    .map((statement, index) => {
      const name = `cat-${question.id}-${index}`;
      return `
        <tr data-statement="${index}">
          <td class="q-matrix-text"><span class="q-matrix-no">${index + 1}</span>${inlineRich(statement.text, features, mediaBase)}</td>
          <td class="q-matrix-pick"><label><input type="radio" name="${name}" value="true"><span>${escapeHtml(question.labels[0])}</span></label></td>
          <td class="q-matrix-pick"><label><input type="radio" name="${name}" value="false"><span>${escapeHtml(question.labels[1])}</span></label></td>
        </tr>`;
    })
    .join('');

  return `<div class="q-matrix-wrap">
      <table class="q-matrix">
        <thead>
          <tr><th>Pernyataan</th><th>${escapeHtml(question.labels[0])}</th><th>${escapeHtml(question.labels[1])}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderQuestionCard(question: QuizQuestion, features: Set<Feature>, mediaBase: string): string {
  const name = `ans-${question.id}`;
  const tags: string[] = [];
  if (question.points !== 1) tags.push(`Bobot ${question.points}`);
  if (question.type === 'multi') tags.push('Pilih semua yang benar');
  if (question.type === 'category') tags.push('Nilai tiap pernyataan');
  if (question.type === 'essay') tags.push('Dikoreksi guru');
  if (question.scoring === 'partial' && (question.type === 'multi' || question.type === 'category')) {
    tags.push('Skor parsial');
  }
  const tagHtml = tags.length ? ` <span class="q-tag">${escapeHtml(tags.join(' • '))}</span>` : '';
  const levelHtml = question.level ? ` <span class="q-tag q-tag-level">${escapeHtml(question.level)}</span>` : '';
  const jumpHtml = question.stimulusId
    ? ` <a class="q-jump" href="#stim-${escapeHtml(question.stimulusId)}"><i class="q-jump-icon"></i>Lihat bacaan</a>`
    : '';

  let controls = '';
  if (question.type === 'choice' || question.type === 'multi') {
    const inputType = question.type === 'choice' ? 'radio' : 'checkbox';
    controls =
      '<div class="q-opts">' +
      question.options
        .map(
          (option, index) => `
        <label class="q-opt">
          <input type="${inputType}" name="${name}" value="${index}">
          <span class="q-opt-box">
            <span class="q-opt-key">${optionLetter(index)}</span>
            <span class="q-opt-text">${inlineRich(option, features, mediaBase)}</span>
          </span>
        </label>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'true_false') {
    const options: Array<[string, string]> = [
      ['true', 'Benar'],
      ['false', 'Salah'],
    ];
    controls =
      '<div class="q-opts">' +
      options
        .map(
          ([value, label], index) => `
        <label class="q-opt">
          <input type="radio" name="${name}" value="${value}">
          <span class="q-opt-box">
            <span class="q-opt-key">${optionLetter(index)}</span>
            <span class="q-opt-text">${label}</span>
          </span>
        </label>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'category') {
    controls = renderCategoryTable(question, features, mediaBase);
  } else if (question.type === 'short') {
    controls = `<input class="q-input" type="text" name="${name}" autocomplete="off" placeholder="Tulis jawaban singkat..." style="margin-top:12px">`;
  } else {
    controls = `<textarea class="q-textarea" name="${name}" placeholder="Tulis jawabanmu di sini..." style="margin-top:12px"></textarea>`;
  }

  return `
    <div class="q-card" data-qid="${escapeHtml(question.id)}" data-type="${question.type}">
      <div class="q-card-head">
        <span class="q-num">${question.no}</span>
        <div class="q-text">${renderRichText(question.question, features, mediaBase)}${levelHtml}${tagHtml}${jumpHtml}</div>
      </div>
      ${controls}
    </div>`;
}

export function renderQuizApp(quiz: QuizSpec, slug: string): string {
  const features = new Set(quiz.features);
  const mediaBase = mediaBaseFor(slug);

  // Soal dikelompokkan mengikuti bacaan bersamanya, supaya satu stimulus tampil
  // SEKALI di atas kelompok soalnya — bukan diulang di tiap soal (seperti naskah
  // TKA: "Stimulus 1 untuk soal 1-3").
  const groups: Array<{ stimulus: QuizStimulus | null; questions: QuizQuestion[] }> = [];
  const groupSlot = new Map<string, number>();
  for (const question of quiz.questions) {
    const slot = groupSlot.get(question.stimulusId);
    if (slot !== undefined) {
      groups[slot].questions.push(question);
      continue;
    }
    groupSlot.set(question.stimulusId, groups.length);
    groups.push({
      stimulus: question.stimulusId
        ? quiz.stimuli.find((stimulus) => stimulus.id === question.stimulusId) ?? null
        : null,
      questions: [question],
    });
  }

  let stimulusOrder = 0;
  const cards = groups
    .map((group) => {
      let head = '';
      if (group.stimulus) {
        stimulusOrder += 1;
        head = renderStimulusCard(group.stimulus, features, mediaBase, stimulusOrder);
      }
      return head + group.questions.map((question) => renderQuestionCard(question, features, mediaBase)).join('');
    })
    .join('');
  const objectivePoints = quiz.questions
    .filter((question) => question.type !== 'essay')
    .reduce((sum, question) => sum + question.points, 0);
  const essayCount = quiz.questions.filter((question) => question.type === 'essay').length;

  // Pemetaan ranah kognitif (L1/L2/L3 atau label bebas) untuk ditampilkan di kepala halaman.
  const levelCounts = new Map<string, number>();
  for (const question of quiz.questions) {
    if (!question.level) continue;
    levelCounts.set(question.level, (levelCounts.get(question.level) ?? 0) + 1);
  }
  const levelLine = levelCounts.size
    ? ` • <span class="q-levels">${[...levelCounts.entries()]
        .map(([level, count]) => `${escapeHtml(level)} ${count}`)
        .join(' • ')}</span>`
    : '';

  const config = JSON.stringify({
    slug,
    title: quiz.title,
    total: quiz.questions.length,
    objectivePoints,
    essayCount,
    kkm: quiz.passingScore,
    showExplanation: quiz.showExplanation,
  }).replace(/</g, '\\u003c');

  const headExtra = [
    features.has('math') ? `<link rel="stylesheet" href="${KATEX_BASE}/katex.min.css">` : '',
    features.has('code') ? `<link rel="stylesheet" href="${HLJS_BASE}/styles/github-dark.min.css">` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  const scripts = [
    features.has('math') ? `<script src="${KATEX_BASE}/katex.min.js"></script>` : '',
    features.has('math') ? `<script src="${KATEX_BASE}/contrib/auto-render.min.js"></script>` : '',
    features.has('code') ? `<script src="${HLJS_BASE}/highlight.min.js"></script>` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  const description = quiz.description ? `<p class="q-hint">${renderRichText(quiz.description, features, mediaBase)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(quiz.title || 'Kuis')}</title>
  <link rel="stylesheet" href="/vendor/quiz.css">
  ${headExtra}
</head>
<body>
  <header class="q-header">
    <div class="q-header-inner">
      <div class="q-logo">
        <svg viewBox="0 0 24 24"><path d="M9 11l2 2 4-4"></path><path d="M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"></path></svg>
      </div>
      <div>
        <h1>${escapeHtml(quiz.title || 'Kuis')}</h1>
        <p>${quiz.questions.length} soal • nilai minimal lulus ${quiz.passingScore}${levelLine}</p>
      </div>
    </div>
  </header>

  <main class="q-wrap">
    <div id="quiz-view">
      <div class="q-card">
        <label class="q-idlabel" for="student-name">Nama siswa</label>
        <input class="q-input" id="student-name" type="text" autocomplete="off" placeholder="Tulis nama lengkap dan kelas...">
        ${description}
      </div>

      <div class="q-alert q-alert-error q-hidden" id="alert-box"></div>

      <form id="quiz-form">
        ${cards}
      </form>
    </div>

    <div id="result-view" class="q-hidden"></div>
  </main>

  <div class="q-bar" id="action-bar">
    <div class="q-bar-inner">
      <div class="q-progress" id="progress">Terjawab <strong>0</strong> dari <strong>${quiz.questions.length}</strong> soal</div>
      <button class="q-btn" id="submit-btn" type="submit" form="quiz-form">Kirim Jawaban</button>
    </div>
  </div>

  ${scripts}
  <script>
(function () {
  var CFG = ${config};
  var KEY = 'quiz-student-name';
  var form = document.getElementById('quiz-form');
  var nameInput = document.getElementById('student-name');
  var progress = document.getElementById('progress');
  var submitBtn = document.getElementById('submit-btn');
  var quizView = document.getElementById('quiz-view');
  var resultView = document.getElementById('result-view');
  var alertBox = document.getElementById('alert-box');
  var actionBar = document.getElementById('action-bar');

  try { if (localStorage.getItem(KEY)) nameInput.value = localStorage.getItem(KEY); } catch (err) {}

  function cardList() { return Array.prototype.slice.call(document.querySelectorAll('[data-qid]')); }

  function readAnswers() {
    return cardList().map(function (card) {
      var type = card.getAttribute('data-type');
      var value = '';
      if (type === 'choice' || type === 'true_false') {
        var checked = card.querySelector('input[type=radio]:checked');
        if (checked) value = type === 'true_false' ? (checked.value === 'true') : Number(checked.value);
      } else if (type === 'multi') {
        var picked = Array.prototype.slice.call(card.querySelectorAll('input[type=checkbox]:checked'))
          .map(function (el) { return Number(el.value); });
        picked.sort(function (a, b) { return a - b; });
        value = picked;
      } else if (type === 'category') {
        // Satu jawaban boolean per pernyataan; null = baris yang belum diisi.
        var rows = [];
        Array.prototype.slice.call(card.querySelectorAll('[data-statement]')).forEach(function (row) {
          var chosen = row.querySelector('input[type=radio]:checked');
          rows.push(chosen ? chosen.value === 'true' : null);
        });
        value = rows;
      } else {
        var field = card.querySelector('input[type=text], textarea');
        if (field) value = field.value.trim();
      }
      return { id: card.getAttribute('data-qid'), value: value };
    });
  }

  function isAnswered(type, value) {
    if (type === 'multi') return Array.isArray(value) && value.length > 0;
    if (type === 'category') {
      return Array.isArray(value) && value.length > 0 && value.every(function (item) { return typeof item === 'boolean'; });
    }
    if (type === 'choice') return typeof value === 'number';
    if (type === 'true_false') return typeof value === 'boolean';
    return typeof value === 'string' && value.length > 0;
  }

  function refresh() {
    var cards = cardList();
    var done = readAnswers().filter(function (answer, index) {
      return isAnswered(cards[index].getAttribute('data-type'), answer.value);
    }).length;
    progress.innerHTML = 'Terjawab <strong>' + done + '</strong> dari <strong>' + CFG.total + '</strong> soal';
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();

  function renderMath(scope) {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(scope || document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } catch (err) {}
  }

  function highlightCode(scope) {
    if (!window.hljs) return;
    try {
      (scope || document).querySelectorAll('pre.q-code code').forEach(function (block) { hljs.highlightElement(block); });
    } catch (err) {}
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('q-hidden');
    window.scrollTo(0, 0);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    alertBox.classList.add('q-hidden');

    var name = nameInput.value.trim();
    if (!name) {
      showAlert('Isi nama dulu ya sebelum mengirim jawaban.');
      nameInput.focus();
      return;
    }
    try { localStorage.setItem(KEY, name); } catch (err) {}

    var cards = cardList();
    var answers = readAnswers();
    var blank = answers.filter(function (answer, index) {
      return !isAnswered(cards[index].getAttribute('data-type'), answer.value);
    }).length;
    if (blank > 0 && !window.confirm('Masih ada ' + blank + ' soal yang belum dijawab. Kirim sekarang?')) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengirim...';

    fetch('/api/submit/' + encodeURIComponent(CFG.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_name: name, quiz_title: CFG.title, answers: answers })
    })
      .then(function (response) {
        return response.json().then(function (data) { return { ok: response.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Server menolak jawaban ini.');
        }
        showResult(result.data.grading, name);
      })
      .catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Jawaban';
        showAlert('Jawaban gagal dikirim (' + error.message + '). Coba klik kirim sekali lagi — jawabanmu masih ada di halaman ini.');
      });
  });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showResult(grading, name) {
    if (!grading) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Kirim Jawaban';
      showAlert('Jawaban tersimpan, tapi nilainya belum bisa dihitung. Beritahu gurumu ya.');
      return;
    }

    quizView.classList.add('q-hidden');
    actionBar.classList.add('q-hidden');
    resultView.classList.remove('q-hidden');
    resultView.innerHTML = '';
    window.scrollTo(0, 0);

    var head = el('div', 'q-result-head');
    var circle = el('div', 'q-score');
    circle.appendChild(el('div', 'q-score-num', String(grading.points_total ? grading.score : '—')));
    circle.appendChild(el('div', 'q-score-label', 'Nilai'));
    head.appendChild(circle);
    head.appendChild(el('p', null, 'Nama: ' + name));

    var badge;
    if (grading.essay_pending > 0) badge = el('span', 'q-badge q-badge-wait', 'Menunggu koreksi esai');
    else if (grading.lulus) badge = el('span', 'q-badge q-badge-pass', 'LULUS (KKM ' + grading.passing_score + ')');
    else badge = el('span', 'q-badge q-badge-fail', 'BELUM LULUS (KKM ' + grading.passing_score + ')');
    head.appendChild(badge);

    var scoreLine = 'Poin soal objektif: ' + grading.points_earned + ' / ' + grading.points_total;
    if (grading.full_points > grading.points_total) scoreLine += '  •  total dengan esai: ' + grading.full_points;
    head.appendChild(el('p', 'q-result-line', scoreLine));

    if (grading.essay_pending > 0) {
      head.appendChild(el('p', 'q-result-line', grading.essay_pending + ' soal esai akan dikoreksi guru, jadi nilaimu masih bisa berubah.'));
    }
    resultView.appendChild(head);

    var list = el('ol', 'q-review');
    (grading.detail || []).forEach(function (item) {
      var points = Math.round((item.poin || 0) * 100) / 100;
      var partial = !item.benar && item.benar !== null && points > 0;
      var cls = item.benar === null ? 'q-pending' : (item.benar ? 'q-ok' : partial ? 'q-partial' : 'q-no');
      var status = item.benar === null
        ? 'Belum dinilai'
        : item.benar
          ? 'Benar (+' + points + ')'
          : partial
            ? 'Sebagian benar (+' + points + ')'
            : 'Salah';
      var row = el('li', 'q-review-item ' + cls);
      row.appendChild(el('span', 'q-review-status', status));

      var questionNode = el('div', 'q-review-q');
      questionNode.innerHTML = '<strong>Soal ' + item.no + '.</strong> ' + (item.question_html || '');
      row.appendChild(questionNode);

      row.appendChild(el('div', 'q-review-a', 'Jawabanmu: ' + (item.jawaban ? item.jawaban : '(kosong)')));
      if (item.kunci) row.appendChild(el('div', 'q-review-key', 'Kunci: ' + item.kunci));

      // Soal kategori: tandai pernyataan mana yang keliru.
      if (item.statements && item.statements.length) {
        var table = el('table', 'q-review-statements');
        var head = el('thead');
        head.innerHTML = '<tr><th>Pernyataan</th><th>Jawabanmu</th><th>Kunci</th></tr>';
        table.appendChild(head);
        var body = el('tbody');
        item.statements.forEach(function (statement) {
          var line = el('tr', statement.benar ? 'q-ok' : 'q-no');
          line.appendChild(el('td', null, statement.text));
          line.appendChild(el('td', null, statement.jawaban));
          line.appendChild(el('td', null, statement.kunci));
          body.appendChild(line);
        });
        table.appendChild(body);
        row.appendChild(table);
      }

      if (CFG.showExplanation !== false && item.pembahasan) {
        var expl = el('div', 'q-review-expl');
        expl.innerHTML = '<strong>Pembahasan</strong>' + item.pembahasan;
        row.appendChild(expl);
      }
      list.appendChild(row);
    });
    resultView.appendChild(list);

    var actions = el('div', 'q-no-print');
    actions.style.marginTop = '20px';
    actions.style.display = 'flex';
    actions.style.gap = '10px';

    var again = el('button', 'q-btn q-btn-ghost', 'Kerjakan Ulang');
    again.type = 'button';
    again.addEventListener('click', function () { window.location.reload(); });

    var printBtn = el('button', 'q-btn', 'Cetak / Simpan PDF');
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () { window.print(); });

    actions.appendChild(again);
    actions.appendChild(printBtn);
    resultView.appendChild(actions);

    renderMath(resultView);
  }

  renderMath(document.body);
  highlightCode(document);
})();
  </script>
</body>
</html>`;
}
