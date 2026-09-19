/* ==========================================================================
 * Media: resolusi URL, koleksi slot media:<nama>, dan pembuatan konteks
 * untuk prompt gambar/Gemini. Memakai parseQuizSpec (quiz-parse).
 * ========================================================================== */

import { sanitizeMediaName } from './quiz-util.ts';
import { MEDIA_SLOT_SCAN } from './quiz-types.ts';
import type { QuestionType, QuizQuestion, QuizSpec, QuizStimulus } from './quiz-types.ts';
import { parseQuizSpec } from './quiz-parse.ts';


/**
 * Daftar nama slot media langsung dari teks JSON yang disimpan, TANPA harus
 * lolos parseQuizSpec. Dipakai panel Gambar sebagai jaring pengaman: spec yang
 * disimpan di KV sudah bentuk ternormalisasi (kuncinya `keys`, bukan `answer`),
 * sehingga parse ulang bisa gagal dan membuat jumlah slot terbaca 0/0 padahal
 * soalnya bergambar. Cukup pindai token `media:nama` dari seluruh teks.
 */
export function collectMediaSlotsFromRaw(raw: string): string[] {
  const found = new Set<string>();
  for (const match of raw.matchAll(new RegExp(MEDIA_SLOT_SCAN.source, 'gi'))) {
    const name = sanitizeMediaName(match[1]);
    if (name) found.add(name);
  }
  return [...found].sort();
}

/**
 * Slot media untuk panel Gambar: coba parse dulu (akurat, ikut aturan sanitasi
 * per-bagian), lalu kalau gagal jatuh ke pemindaian token mentah supaya guru
 * tetap melihat daftar slot yang diminta soal.
 */


/**
 * Slot media untuk panel Gambar: coba parse dulu (akurat, ikut aturan sanitasi
 * per-bagian), lalu kalau gagal jatuh ke pemindaian token mentah supaya guru
 * tetap melihat daftar slot yang diminta soal.
 */
export function collectMediaSlotsFromStored(raw: string): string[] {
  try {
    return collectMediaSlots(parseQuizSpec(raw));
  } catch {
    return collectMediaSlotsFromRaw(raw);
  }
}

/** Daftar nama slot media yang dipakai sebuah kuis (untuk panel Gambar guru). */


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
    scan(question.passage);
    for (const option of question.options) scan(option);
    for (const right of question.rights) scan(right);
    for (const reason of question.reasons) scan(reason);
    for (const statement of question.statements) scan(statement.text);
    for (const segment of question.segments) scan(segment.text);
    for (const header of question.tableHeaders) scan(header);
    for (const row of question.tableRows) for (const cell of row) scan(cell);
  }
  return [...found].sort();
}



export const MEDIA_TYPE_LABELS: Record<QuestionType, string> = {
  choice: 'pilihan ganda',
  multi: 'pilihan ganda (pilih beberapa)',
  true_false: 'benar/salah',
  category: 'tabel kategori benar/salah',
  short: 'isian singkat',
  essay: 'esai',
  matching: 'menjodohkan',
  ordering: 'mengurutkan',
  table_fill: 'melengkapi tabel',
  two_tier: 'dua tingkat (pernyataan dan alasan)',
  highlight: 'memilih kata dalam bacaan',
};

/** Buang noise dari teks soal agar jadi konteks yang rapi untuk prompt gambar. */


/** Buang noise dari teks soal agar jadi konteks yang rapi untuk prompt gambar. */
export function cleanContextText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, src) => (/^media:/i.test(src) ? '' : match))
    .replace(/media:\s*[A-Za-z0-9_.\-]+/gi, '')
    .replace(/@@BLANK\d+@@/g, '...')
    // LaTeX: buang pembatas $$...$$ / $...$ tapi isinya (rumus) tetap dipakai.
    .replace(/\$\$([^$\n]+)\$\$/g, '$1')
    .replace(/\$([^$\n]+?)\$/g, '$1')
    // Markdown: cetak tebal **...** dan miring *...* jadi teks polos. Asterisks
    // yang memisahkan angka ("2 * 3") tidak disentuh (ada spasi di dalamnya).
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** true kalau teks menyebut slot media ini (tokenizer sama dengan collectMediaSlots). */


/** true kalau teks menyebut slot media ini (tokenizer sama dengan collectMediaSlots). */
export function textUsesSlot(text: string, slot: string): boolean {
  if (!text || !slot) return false;
  for (const match of text.matchAll(new RegExp(MEDIA_SLOT_SCAN.source, 'gi'))) {
    if (sanitizeMediaName(match[1]) === slot) return true;
  }
  return false;
}

/**
 * Konteks sebuah slot media menjadi paragraf topik ringkas, dipakai panel Gambar
 * untuk mengisi otomatis prompt gambar AI (atau prompt Gemini milik guru).
 * Sumber dicari dengan prioritas — bacaan/stimulus DIDAHULUKAN, karena gambar
 * di soal AKM/TKA biasanya melekat pada bacaan bersama, bukan pada soalnya:
 *   1. Stimulus (bacaan bersama) yang memakai token media-nya.
 *   2. Teks soal yang langsung menyebut token (pertanyaan/passage).
 *   3. Bagian lain soal yang menyebut token (pilihan/pernyataan/tabel/pembahasan).
 *   4. Deskripsi kuis → judul kuis (paling malas).
 * Kalau tidak ada yang menyebut, hasilnya string kosong (pemanggil menangani).
 */


/**
 * Konteks sebuah slot media menjadi paragraf topik ringkas, dipakai panel Gambar
 * untuk mengisi otomatis prompt gambar AI (atau prompt Gemini milik guru).
 * Sumber dicari dengan prioritas — bacaan/stimulus DIDAHULUKAN, karena gambar
 * di soal AKM/TKA biasanya melekat pada bacaan bersama, bukan pada soalnya:
 *   1. Stimulus (bacaan bersama) yang memakai token media-nya.
 *   2. Teks soal yang langsung menyebut token (pertanyaan/passage).
 *   3. Bagian lain soal yang menyebut token (pilihan/pernyataan/tabel/pembahasan).
 *   4. Deskripsi kuis → judul kuis (paling malas).
 * Kalau tidak ada yang menyebut, hasilnya string kosong (pemanggil menangani).
 */
export function mediaSlotContext(quiz: QuizSpec, slot: string): string {
  const parts = collectSlotContext(quiz, slot);
  if (!parts) return '';
  if (parts.stimulus) return parts.stimulus;
  if (parts.question) return parts.question;
  return parts.fallback;
}

/**
 * Varian "lengkap" untuk prompt Gemini yang disalin guru: kalau slotnya ada di
 * bacaan bersama, konteks soal ikut dimuat (mis. soal menanyakan nama motif
 * yang gambarannya ada di bacaan). Tombol generate AI tetap memakai varian
 * ringkas (mediaSlotContext).
 */


/**
 * Varian "lengkap" untuk prompt Gemini yang disalin guru: kalau slotnya ada di
 * bacaan bersama, konteks soal ikut dimuat (mis. soal menanyakan nama motif
 * yang gambarannya ada di bacaan). Tombol generate AI tetap memakai varian
 * ringkas (mediaSlotContext).
 */
export function mediaSlotContextFull(quiz: QuizSpec, slot: string): string {
  const parts = collectSlotContext(quiz, slot);
  if (!parts) return '';
  if (parts.stimulus && parts.question) return `${parts.stimulus}. Soal: ${parts.question}`;
  if (parts.stimulus) return parts.stimulus;
  if (parts.question) return parts.question;
  return parts.fallback;
}



export function collectSlotContext(quiz: QuizSpec, slot: string): { stimulus: string; question: string; fallback: string } | null {
  const slotName = sanitizeMediaName(slot);
  if (!slotName) return null;

  const stimuliById = new Map((quiz.stimuli ?? []).map((stimulus) => [stimulus.id, stimulus]));

  const questionContext = (question: QuizQuestion, appendReading: boolean): string => {
    const type = MEDIA_TYPE_LABELS[question.type] ?? question.type;
    const isHighlight = question.type === 'highlight';
    let subject = cleanContextText(question.passage || question.question);
    if (isHighlight && !subject) subject = cleanContextText(question.question);
    const bits: string[] = [];
    if (type) bits.push(type);
    if (subject) bits.push(subject);
    if (question.options.length) bits.push('pilihan: ' + question.options.map((o) => cleanContextText(o)).join('; '));
    if (question.statements.length) {
      bits.push('pernyataan: ' + question.statements.map((statement) => cleanContextText(statement.text)).join('; '));
    }
    if (question.rights.length) bits.push('jodohan: ' + question.rights.map((right) => cleanContextText(right)).join('; '));
    if (question.reasons.length) {
      bits.push('alasan: ' + question.reasons.map((reason) => cleanContextText(reason)).join('; '));
    }
    if (question.tableRows.length) {
      bits.push('tabel: ' + question.tableRows.map((row) => row.map((cell) => cleanContextText(cell)).join(' | ')).join(' / '));
    }
    if (question.explanation) bits.push('penjelasan: ' + cleanContextText(question.explanation));
    // Bacaan bersama ikut menempel ke konteks soal (kecuali varian lengkap yang
    // sudah menampilkan stimulus lebih dulu — mencegah bacaan muncul dua kali).
    if (appendReading && question.stimulusId) {
      const stimulus = stimuliById.get(question.stimulusId);
      if (stimulus) {
        const reading = cleanContextText(`${stimulus.title ? stimulus.title + '. ' : ''}${stimulus.content}`);
        if (reading) bits.push('stimulus: ' + reading);
      }
    }
    // Dibatasi supaya pas batas endpoint generate (700 karakter) sekaligus fokus
    // ke bagian yang paling relevan (teks soal & bacaan diletakkan di depan).
    return bits.filter(Boolean).join('. ').trim().slice(0, 600);
  };

  // Lewati satu kali mengumpulkan konteks tiap soal supaya tidak dihitung ulang.
  const questionContexts: { question: QuizQuestion; ctx: string; primaryRaw: string; all: string[] }[] = quiz.questions.map((question) => {
    const ctx = questionContext(question, true);
    // `primaryRaw` sengaja TANPA dibersihkan: dipakai untuk mencocokkan token
    // media, karena pembersihan justru membuang tokennya.
    const primaryRaw = question.passage || question.question;
    const all = [primaryRaw, ctx].filter(Boolean);
    return { question, ctx, primaryRaw, all };
  });

  // Prioritas 1: STIMULUS yang memakai token — bacaan bersama didahulukan karena
  // itulah bagian yang guru maksudkan untuk digambarkan (stimulus "untuk soal 1-3").
  let stimulus = '';
  let stimulusWithSlot: QuizStimulus | null = null;
  for (const candidate of quiz.stimuli ?? []) {
    for (const text of [candidate.title, candidate.content]) {
      if (textUsesSlot(text, slotName)) {
        const cleaned = cleanContextText(text);
        const heading = sanitizeMediaName(candidate.title)
          ? `stimulus. ${cleanContextText(candidate.title)}`
          : 'stimulus';
        stimulus = cleaned ? `${heading}. ${cleaned}` : heading;
        stimulusWithSlot = candidate;
        break;
      }
    }
    if (stimulusWithSlot) break;
  }

  // Konteks soal terbaik: soal yang menyebut token langsung (teks → bagian lain),
  // kalau tidak ada, soal pertama yang memakai stimulus berisi token itu.
  let question = '';
  const byText = questionContexts.find((entry) => textUsesSlot(entry.primaryRaw, slotName));
  const byParts = byText ? null : questionContexts.find((entry) => entry.all.some((text) => textUsesSlot(text, slotName)));
  const entry = byText ?? byParts;
  if (entry) {
    question = entry.ctx;
  } else if (stimulusWithSlot) {
    const companion = questionContexts.find((candidate) => candidate.question.stimulusId === stimulusWithSlot.id);
    if (companion) question = questionContext(companion.question, false);
  }

  // Paling malas: deskripsi kuis → judul kuis.
  let fallback = '';
  if (textUsesSlot(quiz.description, slotName)) fallback = cleanContextText(quiz.description);
  else if (textUsesSlot(quiz.title, slotName)) fallback = cleanContextText(quiz.title);

  return { stimulus, question, fallback };
}

/**
 * Cadangan di luar parser: kalau spec tersimpan tidak bisa di-parse ulang
 * (parser versi baru menolak bentuk lama), konteks tetap diambil dari teks
 * mentah di sekitar token `media:<slot>`.
 */


/**
 * Cadangan di luar parser: kalau spec tersimpan tidak bisa di-parse ulang
 * (parser versi baru menolak bentuk lama), konteks tetap diambil dari teks
 * mentah di sekitar token `media:<slot>`.
 */
export function mediaContextFromRaw(raw: string, slot: string): string {
  const slotName = sanitizeMediaName(slot);
  if (!slotName || !raw) return '';
  const lower = raw.toLowerCase();
  const token = `media:${slotName}`;
  let index = lower.indexOf(token);
  if (index < 0) index = lower.indexOf(`media: ${slotName}`);
  if (index < 0) return '';
  const start = Math.max(0, index - 260);
  const end = Math.min(raw.length, index + token.length + 260);
  return cleanContextText(raw.slice(start, end)).slice(0, 600);
}

