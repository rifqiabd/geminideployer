/* ==========================================================================
 * Jenis data + konstanta inti mode "JSON Soal", dipakai semua modul kuis.
 * Dipisah dari src/quiz.ts (refactor) supaya tiap concern punya rumah sendiri.
 * ========================================================================== */

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



export type QuestionType =
  | 'choice'
  | 'multi'
  | 'true_false'
  | 'category'
  | 'short'
  | 'essay'
  // --- Tipe lanjutan bergaya AKM/TKA ---
  /** Menjodohkan: tiap pernyataan kiri dipasangkan satu pilihan kanan. */
  | 'matching'
  /** Mengurutkan: siswa menyusun langkah/objek jadi urutan yang benar. */
  | 'ordering'
  /** Melengkapi tabel: satu tabel dengan beberapa sel rumpang. */
  | 'table_fill'
  /** Dua tingkat: siswa memilih pernyataan lalu memilih alasan pendukungnya. */
  | 'two_tier'
  /** Memilih kata/frasa di dalam bacaan (gaya AKM literasi membaca). */
  | 'highlight';

export type Feature = 'math' | 'arabic' | 'jawa' | 'image' | 'audio' | 'table' | 'code';

/**
 * `all`     : poin penuh hanya kalau jawabannya persis benar (perilaku lama).
 * `partial` : poin dibagi proporsional, dipakai soal MCMA/kategori bergaya AKM.
 */


/**
 * `all`     : poin penuh hanya kalau jawabannya persis benar (perilaku lama).
 * `partial` : poin dibagi proporsional, dipakai soal MCMA/kategori bergaya AKM.
 */
export type ScoringMode = 'all' | 'partial';

/** Satu pernyataan pada soal kategori (tabel Benar/Salah). */


/** Satu pernyataan pada soal kategori (tabel Benar/Salah). */
export type QuizStatement = { text: string; answer: boolean };

/** Satu sel rumpang pada soal melengkapi tabel (table_fill). */


/** Satu sel rumpang pada soal melengkapi tabel (table_fill). */
export type QuizBlank = {
  /** Teks kiri untuk ditampilkan saat pembahasan, mis. "Timah" atau "Baris 2". */
  label: string;
  /** Semua jawaban yang diterima untuk sel ini (sudah dinormalisasi). */
  accepted: string[];
};

/** Satu potongan bacaan pada soal highlight. */


/** Satu potongan bacaan pada soal highlight. */
export type QuizSegment = {
  text: string;
  /** true = bisa diklik siswa. */
  selectable: boolean;
  /** true = termasuk kunci (hanya bermakna kalau selectable). */
  answer: boolean;
};

/**
 * Satu bacaan/stimulus yang dipakai bersama oleh beberapa soal — seperti
 * "Stimulus 1 untuk soal 1-3" pada naskah TKA. Dirender SEKALI di atas
 * kelompok soalnya, bukan diulang di tiap soal.
 */


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
  /** Judul bacaan/stimulus milik soal ini sendiri (denormalisasi dari stimulusId). */
  stimulusTitle: string;
  /** Konten bacaan/stimulus milik soal ini sendiri (denormalisasi dari stimulusId). */
  stimulusContent: string;
  /** Khusus `matching`: teks kolom kanan (sudah diacak saat parsing). */
  rights: string[];
  /** Khusus `table_fill`: sel rumpang berurutan baris demi baris. */
  blanks: QuizBlank[];
  /** Khusus `two_tier`: pilihan pada tingkat kedua (alasan). */
  reasons: string[];
  /** Khusus `highlight`: potongan bacaan, sebagian bisa diklik. */
  segments: QuizSegment[];
  /** Khusus `highlight`: bacaan sebagai teks biasa (tanpa penanda kurawal). */
  passage: string;
  /** Khusus `table_fill`: judul kolom tabel. */
  tableHeaders: string[];
  /** Khusus `table_fill`: baris tabel; sel rumpang ditandai `@@BLANK0@@`. */
  tableRows: string[][];
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
  /** Rincian per bagian: pernyataan kategori, pasangan, urutan, atau sel tabel. */
  statements?: GradedStatement[];
  /** Judul kolom pertama tabel rincian di layar pembahasan. */
  row_label?: string;
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



export const MAX_QUESTIONS = 300;

// Versi di-pin: kalau CDN diam-diam naik versi, tampilan kuis tidak berubah.


// Versi di-pin: kalau CDN diam-diam naik versi, tampilan kuis tidak berubah.
export const KATEX_VERSION = '0.18.6';

export const HLJS_VERSION = '11.11.2';

export const KATEX_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/' + KATEX_VERSION;

export const HLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/' + HLJS_VERSION;



export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

export const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|oga|aac|opus)(\?|#|$)/i;

export const ARABIC_RUN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Aksara Jawa (Hanacaraka): sandhangan U+A980-A9BF, pangkon U+A9C0, angka Jawa U+A9D0-A9D9.
export const JAVANESE_RUN = /[\uA980-\uA9DF]/;

// Token gambar tanpa file: `media:nama-slot`. Gemini cuma menulis nama slotnya,
// guru yang mengunggah fotonya lewat panel Gambar. Halaman siswa menerjemahkan
// token ini jadi /media/<slug>/<nama-slot>.


// Token gambar tanpa file: `media:nama-slot`. Gemini cuma menulis nama slotnya,
// guru yang mengunggah fotonya lewat panel Gambar. Halaman siswa menerjemahkan
// token ini jadi /media/<slug>/<nama-slot>.
export const MEDIA_TOKEN = /^media:\s*([A-Za-z0-9_.\-]+)$/i;

export const MEDIA_SLOT_SCAN = /media:\s*([A-Za-z0-9_.\-]+)/gi;



export const TYPE_ALIASES: Record<string, QuestionType> = {
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
  pg_kompleks_kategori: 'category',
  pg_kategori: 'category',
  pilihan_ganda_kategori: 'category',
  kompleks_kategori: 'category',
  kategori_benar_salah: 'category',
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
  // --- Tipe lanjutan ---
  matching: 'matching',
  match: 'matching',
  menjodohkan: 'matching',
  jodohkan: 'matching',
  pasangkan: 'matching',
  memasangkan: 'matching',
  pairs: 'matching',
  pairing: 'matching',
  matching_test: 'matching',
  ordering: 'ordering',
  order: 'ordering',
  urut: 'ordering',
  urutan: 'ordering',
  mengurutkan: 'ordering',
  sequence: 'ordering',
  sequencing: 'ordering',
  sortir: 'ordering',
  table_fill: 'table_fill',
  tabel_isian: 'table_fill',
  melengkapi_tabel: 'table_fill',
  isian_tabel: 'table_fill',
  fill_table: 'table_fill',
  table: 'table_fill',
  tabel: 'table_fill',
  two_tier: 'two_tier',
  dua_tingkat: 'two_tier',
  twotier: 'two_tier',
  jawaban_alasan: 'two_tier',
  pilih_alasan: 'two_tier',
  setuju_alasan: 'two_tier',
  highlight: 'highlight',
  menandai_kata: 'highlight',
  pilih_kata: 'highlight',
  klik_kata: 'highlight',
  memilih_kata: 'highlight',
  tandai_kata: 'highlight',
  cloze: 'highlight',
};



export const FEATURE_ALIASES: Record<string, Feature> = {
  math: 'math',
  rumus: 'math',
  matematika: 'math',
  latex: 'math',
  katex: 'math',
  arab: 'arabic',
  arabic: 'arabic',
  arabika: 'arabic',
  rtl: 'arabic',
  jawa: 'jawa',
  javanese: 'jawa',
  aksara: 'jawa',
  aksara_jawa: 'jawa',
  hanacaraka: 'jawa',
  carakan: 'jawa',
  java: 'jawa',
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

