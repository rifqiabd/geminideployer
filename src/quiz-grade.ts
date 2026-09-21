/* ==========================================================================
 * Penilaian otomatis soal objektif + dukungan esai (server-side).
 * ========================================================================== */

import { asStringList, normalizeAnswer, optionLetter } from './quiz-util.ts';
import { matchOptionIndex, resolveBoolean, statementDisplay } from './quiz-parse.ts';
import { renderRichText } from './quiz-rich.ts';
import type {
  Feature,
  GradedDetail,
  GradedStatement,
  GradeResult,
  QuestionType,
  QuizQuestion,
  QuizSpec,
} from './quiz-types.ts';


/* -------------------------------------------------------------------------- */
/* Penilaian                                                                  */
/* -------------------------------------------------------------------------- */

export type Evaluated = {
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


/**
 * Penilaian satu soal. Tiap tipe punya aturannya sendiri, jadi menambah tipe
 * baru cukup menambah satu cabang di sini tanpa mengubah seluruh penilai.
 */
export function evaluate(question: QuizQuestion, raw: unknown): Evaluated {
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

  if (question.type === 'matching') {
    const values = Array.isArray(raw) ? raw : [];
    const keys = (question.keys[0] ?? '').split('|').map(Number);
    // Satu pilihan kanan per baris kiri; null = baris yang belum diisi.
    const picked: Array<number | null> = question.options.map((_left, index) => {
      const value = values[index];
      if (value === undefined || value === null || value === '') return null;
      const chosen = matchOptionIndex(value, question.rights);
      return chosen >= 0 && chosen < question.rights.length ? chosen : null;
    });
    if (picked.every((value) => value === null)) return unanswered;

    let right = 0;
    picked.forEach((value, index) => {
      if (value !== null && value === keys[index]) right += 1;
    });
    return {
      display: picked.map((value, index) => `${index + 1}: ${value === null ? '-' : optionLetter(value)}`).join(' \u00b7 '),
      correct: right === question.options.length,
      ratio: right / (question.options.length || 1),
    };
  }

  if (question.type === 'ordering') {
    const values = Array.isArray(raw) ? raw : [];
    const picked: number[] = [];
    for (const item of values) {
      const index = matchOptionIndex(item, question.options);
      if (index >= 0 && index < question.options.length && !picked.includes(index)) picked.push(index);
    }
    // Urutan baru lengkap kalau semua item ikut terdaftar.
    if (picked.length !== question.options.length) return unanswered;

    const keys = (question.keys[0] ?? '')
      .split('|')
      .filter((value) => value !== '')
      .map(Number);
    let right = 0;
    picked.forEach((value, position) => {
      if (keys[position] === value) right += 1;
    });
    return {
      display: picked.map((value, position) => `${position + 1}. ${question.options[value]}`).join(' \u00b7 '),
      correct: right === question.options.length,
      ratio: right / (question.options.length || 1),
    };
  }

  if (question.type === 'table_fill') {
    const values = Array.isArray(raw) ? raw : [];
    const texts = question.blanks.map((_blank, index) => String(values[index] ?? '').trim());
    if (texts.every((text) => text === '')) return unanswered;

    let right = 0;
    question.blanks.forEach((blank, index) => {
      if (texts[index] !== '' && blank.accepted.includes(normalizeAnswer(texts[index]))) right += 1;
    });
    return {
      display: texts.map((text, index) => `${index + 1}: ${text || '(kosong)'}`).join(' \u00b7 '),
      correct: right === question.blanks.length,
      ratio: right / (question.blanks.length || 1),
    };
  }

  if (question.type === 'two_tier') {
    const values = Array.isArray(raw) ? raw : [];
    const pickIndex = (value: unknown, choices: string[]): number => {
      if (value === undefined || value === null || value === '') return -1;
      const index = matchOptionIndex(value, choices);
      return index >= 0 && index < choices.length ? index : -1;
    };
    const first = pickIndex(values[0], question.options);
    const second = pickIndex(values[1], question.reasons);
    if (first < 0 && second < 0) return unanswered;

    const keys = (question.keys[0] ?? '').split('|').map(Number);
    const hits = (first === keys[0] ? 1 : 0) + (second === keys[1] ? 1 : 0);
    const show = (index: number, choices: string[]) =>
      index < 0 ? '(kosong)' : `${optionLetter(index)}. ${choices[index]}`;
    return {
      display: `${show(first, question.options)} \u2014 ${show(second, question.reasons)}`,
      correct: hits === 2,
      ratio: hits / 2,
    };
  }

  if (question.type === 'highlight') {
    const selectableAt = question.segments
      .map((segment, index) => (segment.selectable ? index : -1))
      .filter((index) => index >= 0);
    const choices = selectableAt.map((index) => question.segments[index].text);
    const picked: number[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const index = matchOptionIndex(item, choices);
      if (index >= 0 && index < choices.length && !picked.includes(index)) picked.push(index);
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
      display: picked.map((index) => question.segments[selectableAt[index]].text).join(', '),
      correct: keys.length > 0 && hits === keys.length && misses === 0,
      // Memilih kata yang salah mengurangi, tapi skor tidak pernah negatif.
      ratio: Math.max(0, Math.min(1, (hits - misses) / (keys.length || 1))),
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

/**
 * Teks soal untuk layar pembahasan. Soal highlight perlu bacaannya ikut
 * ditampilkan, karena teks soal cuma berisi instruksinya.
 */


/**
 * Teks soal untuk layar pembahasan. Soal highlight perlu bacaannya ikut
 * ditampilkan, karena teks soal cuma berisi instruksinya.
 */
export function questionHtml(question: QuizQuestion, features: Set<Feature>, mediaBase: string): string {
  const head = renderRichText(question.question, features, mediaBase);
  if (question.type !== 'highlight' || !question.passage) return head;
  return `${head}${renderRichText(question.passage, features, mediaBase)}`;
}

/** Judul kolom pertama tabel rincian di layar pembahasan, per tipe soal. */


/** Judul kolom pertama tabel rincian di layar pembahasan, per tipe soal. */
export const ROW_LABELS: Partial<Record<QuestionType, string>> = {
  category: 'Pernyataan',
  matching: 'Pernyataan',
  ordering: 'Langkah',
  table_fill: 'Sel',
  two_tier: 'Bagian',
  highlight: 'Kata/frasa',
};

/** Rincian per bagian, supaya siswa tahu baris mana yang keliru. */


/** Rincian per bagian, supaya siswa tahu baris mana yang keliru. */
export function toGradedRows(question: QuizQuestion, raw: unknown): { rows: GradedStatement[]; label: string } | undefined {
  const values = Array.isArray(raw) ? raw : [];
  const label = ROW_LABELS[question.type];
  if (!label) return undefined;

  if (question.type === 'category') {
    return {
      label,
      rows: question.statements.map((statement, index) => {
        const picked = values[index] === undefined ? null : resolveBoolean(values[index]);
        return {
          text: statement.text,
          jawaban: picked === null ? '(kosong)' : picked ? question.labels[0] : question.labels[1],
          kunci: statement.answer ? question.labels[0] : question.labels[1],
          benar: picked === statement.answer,
        };
      }),
    };
  }

  if (question.type === 'matching') {
    const keys = (question.keys[0] ?? '').split('|').map(Number);
    return {
      label,
      rows: question.options.map((left, index) => {
        const value = values[index];
        const picked =
          value === undefined || value === null || value === '' ? -1 : matchOptionIndex(value, question.rights);
        const chosen = picked >= 0 && picked < question.rights.length ? picked : -1;
        const right = keys[index];
        return {
          text: left,
          jawaban: chosen < 0 ? '(kosong)' : question.rights[chosen],
          kunci: right >= 0 && right < question.rights.length ? question.rights[right] : '',
          benar: chosen === right,
        };
      }),
    };
  }

  if (question.type === 'ordering') {
    const keys = (question.keys[0] ?? '')
      .split('|')
      .filter((value) => value !== '')
      .map(Number);
    const picked: number[] = [];
    for (const item of values) {
      const index = matchOptionIndex(item, question.options);
      if (index >= 0 && index < question.options.length && !picked.includes(index)) picked.push(index);
    }
    return {
      label,
      rows: question.options.map((item, index) => {
        const studentPosition = picked.indexOf(index);
        const rightPosition = keys.indexOf(index) + 1;
        return {
          text: item,
          jawaban: studentPosition < 0 ? '(kosong)' : `Urutan ke-${studentPosition + 1}`,
          kunci: `Urutan ke-${rightPosition}`,
          benar: studentPosition + 1 === rightPosition,
        };
      }),
    };
  }

  if (question.type === 'table_fill') {
    return {
      label,
      rows: question.blanks.map((blank, index) => {
        const text = String(values[index] ?? '').trim();
        return {
          text: blank.label,
          jawaban: text || '(kosong)',
          kunci: blank.accepted.join(' / '),
          benar: text !== '' && blank.accepted.includes(normalizeAnswer(text)),
        };
      }),
    };
  }

  if (question.type === 'two_tier') {
    const keys = (question.keys[0] ?? '').split('|').map(Number);
    const pickIndex = (value: unknown, choices: string[]) => {
      if (value === undefined || value === null || value === '') return -1;
      const index = matchOptionIndex(value, choices);
      return index >= 0 && index < choices.length ? index : -1;
    };
    const parts = [
      { text: 'Pernyataan yang dipilih', choices: question.options, key: keys[0], value: values[0] },
      { text: 'Alasan yang dipilih', choices: question.reasons, key: keys[1], value: values[1] },
    ];
    return {
      label,
      rows: parts.map((part) => {
        const picked = pickIndex(part.value, part.choices);
        return {
          text: part.text,
          jawaban: picked < 0 ? '(kosong)' : part.choices[picked],
          kunci: part.key >= 0 && part.key < part.choices.length ? part.choices[part.key] : '',
          benar: picked === part.key,
        };
      }),
    };
  }

  // highlight: tiap kata yang bisa diklik jadi satu baris hasil.
  const selectableAt = question.segments
    .map((segment, index) => (segment.selectable ? index : -1))
    .filter((index) => index >= 0);
  const choices = selectableAt.map((index) => question.segments[index].text);
  const keys = (question.keys[0] ?? '')
    .split('|')
    .filter((value) => value !== '')
    .map(Number);
  const picked: number[] = [];
  for (const item of values) {
    const index = matchOptionIndex(item, choices);
    if (index >= 0 && index < choices.length && !picked.includes(index)) picked.push(index);
  }
  return {
    label,
    rows: choices.map((word, index) => {
      const chosen = picked.includes(index);
      const isKey = keys.includes(index);
      return {
        text: word,
        jawaban: chosen ? 'Dipilih' : 'Tidak dipilih',
        kunci: isKey ? 'Dipilih' : 'Tidak dipilih',
        benar: chosen === isKey,
      };
    }),
  };
}



export function normalizeSubmission(raw: unknown): Map<string, unknown> {
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
        question_html: questionHtml(question, features, mediaBase),
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

    const rows = toGradedRows(question, rawAnswer);
    detail.push({
      no: question.no,
      id: question.id,
      type: question.type,
      question_html: questionHtml(question, features, mediaBase),
      jawaban: evaluated.display,
      kunci: question.keyLabel,
      benar: evaluated.correct,
      poin: awarded,
      poin_maks: question.points,
      pembahasan: question.explanation ? renderRichText(question.explanation, features, mediaBase) : '',
      statements: rows?.rows,
      row_label: rows?.label,
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
