/* ==========================================================================
 * Parsing spec dari guru: normalisasi tiap tipe soal, rehidrasi spec simpanan,
 * deteksi fitur, dan penyusunan ulang format tulisan (quizToAuthoringSource).
 * ========================================================================== */

import {
  asStringList,
  hashString,
  imageFieldToMarkdown,
  normalizeAnswer,
  optionLetter,
  pick,
  stripFences,
  wrapBareLatex,
} from './quiz-util.ts';
import {
  ARABIC_RUN,
  AUDIO_EXT,
  FEATURE_ALIASES,
  IMAGE_EXT,
  JAVANESE_RUN,
  MAX_QUESTIONS,
  QuizError,
  TYPE_ALIASES,
} from './quiz-types.ts';
import type {
  Feature,
  QuizBlank,
  QuizQuestion,
  QuizSegment,
  QuizSpec,
  QuizStatement,
  QuizStimulus,
  ScoringMode,
} from './quiz-types.ts';



/**
 * Batas waktu default (menit) untuk kuis yang tidak menyebut `duration_minutes`.
 * Dipakai parser dan kotak "Durasi latihan" di editor soal, jadi keduanya
 * menampilkan angka yang sama. Menghapus kunci (atau mengosongkan field editor)
 * berarti "pakai default ini"; untuk men-disable timer tulis eksplisit `0`.
 */
export const DEFAULT_DURATION_MINUTES = 90;


/* -------------------------------------------------------------------------- */
/* Parsing spec                                                               */
/* -------------------------------------------------------------------------- */

export function matchOptionIndex(value: unknown, options: string[]): number {
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



export function resolveBoolean(value: unknown): boolean | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return resolveBoolean(value[0]);
  }
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return null;
  // Gemini kadang menulis DUA nilai untuk kunci yang seharusnya satu, mis.
  // "answer": [true, false], "answer": "false, true", atau "benar/salah".
  // Ambil nilai pertama yang dikenal supaya soal tetap terbaca dan kunci tidak
  // ganda; guru bisa mengoreksinya via editor soal.
  const parts = String(value)
    .split(/[,/|;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const text = normalizeAnswer(part);
    if (['true', 'benar', 'betul', 'b', 'ya', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'salah', 's', 'tidak', 'no', 'n', '0'].includes(text)) return false;
  }
  return null;
}

/**
 * Daftar pernyataan soal kategori. Tiap pernyataan boleh ditulis sebagai objek
 * `{ "text": "...", "answer": true }`, atau sebagai teks biasa sementara
 * kuncinya ditaruh sejajar di `"answers": [true, false, true]`.
 */


/**
 * Daftar pernyataan soal kategori. Tiap pernyataan boleh ditulis sebagai objek
 * `{ "text": "...", "answer": true }`, atau sebagai teks biasa sementara
 * kuncinya ditaruh sejajar di `"answers": [true, false, true]`.
 */
export function normalizeStatements(rawValue: unknown, fallback: string[], no: number): QuizStatement[] {
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
    statements.push({ text: wrapBareLatex(text), answer: truth });
  });
  return statements;
}

/** Judul dua kolom tabel kategori; bisa diganti mis. Sesuai / Tidak Sesuai. */


/** Judul dua kolom tabel kategori; bisa diganti mis. Sesuai / Tidak Sesuai. */
export function normalizeLabels(raw: Record<string, unknown>): [string, string] {
  const pair = pick(raw, ['labels', 'kolom', 'label_kolom', 'columns']);
  if (Array.isArray(pair) && pair.length >= 2) return [String(pair[0]), String(pair[1])];
  const yes = pick(raw, ['label_benar', 'label_true', 'label_sesuai']);
  const no = pick(raw, ['label_salah', 'label_false', 'label_tidak_sesuai']);
  if (yes !== undefined || no !== undefined) return [String(yes ?? 'Benar'), String(no ?? 'Salah')];
  return ['Benar', 'Salah'];
}

/** Jawaban soal kategori jadi satu baris ringkas: "1: Salah · 2: Benar". */


/** Jawaban soal kategori jadi satu baris ringkas: "1: Salah · 2: Benar". */
export function statementDisplay(question: QuizQuestion, values: Array<boolean | null>): string {
  return question.statements
    .map((_statement, index) => {
      const value = values[index];
      const label = value === null || value === undefined ? '(kosong)' : value ? question.labels[0] : question.labels[1];
      return `${index + 1}: ${label}`;
    })
    .join(' · ');
}

/* --- Tipe lanjutan: helper parsing ------------------------------------------ */

/**
 * Hash FNV-1a sederhana, dipakai sebagai bibit pengacakan. Tujuannya bukan
 * keamanan, cuma supaya urutan yang tampil ke siswa SELALU sama untuk soal yang
 * sama — kalau tidak, halaman kuis berubah tiap kali dirender ulang dan kunci
 * guru tidak lagi cocok dengan urutan yang dilihat siswa.
 */


/** Urutan indeks hasil pengacakan deterministik (Fisher-Yates berbenih). */
export function seededOrder(count: number, seed: string): number[] {
  const indexes = Array.from({ length: count }, (_unused, index) => index);
  let state = hashString(seed) || 1;
  for (let i = count - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const swap = indexes[i];
    indexes[i] = indexes[j];
    indexes[j] = swap;
  }
  return indexes;
}

/**
 * Urutan tampil yang dijamin BUKAN urutan kunci, supaya jawaban tidak terbaca
 * langsung dari tata letaknya (mis. soal mengurutkan yang ditulis sudah benar).
 */


/**
 * Urutan tampil yang dijamin BUKAN urutan kunci, supaya jawaban tidak terbaca
 * langsung dari tata letaknya (mis. soal mengurutkan yang ditulis sudah benar).
 */
export function scrambleOrder(count: number, seed: string, isIdentity: (order: number[]) => boolean): number[] {
  const order = seededOrder(count, seed);
  if (count > 1 && isIdentity(order)) {
    const swap = order[0];
    order[0] = order[1];
    order[1] = swap;
  }
  return order;
}

/** `leftIndex -> posisi` dari urutan tampil. */


/** `leftIndex -> posisi` dari urutan tampil. */
export function positionMap(order: number[]): number[] {
  const positions = new Array<number>(order.length);
  order.forEach((source, shown) => {
    positions[source] = shown;
  });
  return positions;
}

/**
 * Bacaan soal highlight ditulis dengan kata yang bisa diklik diapit kurawal:
 *   "Budi {mengembalikan} uang yang ia temukan, lalu {menyimpannya}."
 * Mana di antaranya yang BENAR ditentukan field `answer`, bukan oleh penandanya
 * — jadi guru tidak perlu dua macam tanda dan tidak bingung mana yang kunci.
 */


/**
 * Bacaan soal highlight ditulis dengan kata yang bisa diklik diapit kurawal:
 *   "Budi {mengembalikan} uang yang ia temukan, lalu {menyimpannya}."
 * Mana di antaranya yang BENAR ditentukan field `answer`, bukan oleh penandanya
 * — jadi guru tidak perlu dua macam tanda dan tidak bingung mana yang kunci.
 */
export function parseSegments(rawText: string): QuizSegment[] {
  const segments: QuizSegment[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawText)) !== null) {
    if (match.index > last) segments.push({ text: rawText.slice(last, match.index), selectable: false, answer: false });
    segments.push({ text: match[1], selectable: true, answer: false });
    last = match.index + match[0].length;
  }
  if (last < rawText.length) segments.push({ text: rawText.slice(last), selectable: false, answer: false });
  return segments;
}

/**
 * Soal menjodohkan.
 *
 * Bentuk yang diterima:
 *   "pairs": [ { "left": "AGV", "right": "Kendaraan pemandu otomatis" }, ... ]
 *   "pairs": [ ["AGV", "Kendaraan pemandu otomatis"], ... ]
 *   "left": [...], "right": [...]        (berpasangan sesuai urutan)
 *   "items": [...], "answers": [...]     (alias lain untuk kiri/kanan)
 */


/**
 * Soal menjodohkan.
 *
 * Bentuk yang diterima:
 *   "pairs": [ { "left": "AGV", "right": "Kendaraan pemandu otomatis" }, ... ]
 *   "pairs": [ ["AGV", "Kendaraan pemandu otomatis"], ... ]
 *   "left": [...], "right": [...]        (berpasangan sesuai urutan)
 *   "items": [...], "answers": [...]     (alias lain untuk kiri/kanan)
 */
export function normalizePairs(
  raw: Record<string, unknown>,
  no: number
): { lefts: string[]; rights: string[]; rightOrder: number[] } {
  const lefts: string[] = [];
  const rights: string[] = [];
  const rawPairs = pick(raw, ['pairs', 'pasangan', 'jodohkan', 'matching']);

  if (Array.isArray(rawPairs)) {
    rawPairs.forEach((entry, index) => {
      let left = '';
      let right = '';
      if (Array.isArray(entry)) {
        left = String(entry[0] ?? '').trim();
        right = String(entry[1] ?? '').trim();
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        left = String(pick(obj, ['left', 'kiri', 'a', 'soal', 'pernyataan', 'text', 'teks']) ?? '').trim();
        right = String(pick(obj, ['right', 'kanan', 'b', 'pasangan', 'jawaban', 'match', 'answer']) ?? '').trim();
      }
      if (!left || !right) {
        throw new QuizError(`Soal #${no}: pasangan ke-${index + 1} harus punya "left" dan "right" yang terisi.`);
      }
      lefts.push(wrapBareLatex(left));
      rights.push(wrapBareLatex(right));
    });
  } else {
    const leftList = asStringList(pick(raw, ['left', 'kiri', 'items', 'pernyataan', 'daftar_kiri']));
    const rightList = asStringList(pick(raw, ['right', 'kanan', 'answers', 'pasangan', 'daftar_kanan']));
    if (leftList.length !== rightList.length) {
      throw new QuizError(
        `Soal #${no}: tipe matching butuh "pairs" (atau "left" dan "right" dengan jumlah sama). Jumlah kiri ${leftList.length} dan kanan ${rightList.length} tidak sama.`
      );
    }
    lefts.push(...leftList.map(wrapBareLatex));
    rights.push(...rightList.map(wrapBareLatex));
  }

  if (lefts.length < 2) throw new QuizError(`Soal #${no}: tipe matching butuh minimal 2 pasangan.`);
  // Kolom kanan diacak supaya posisinya tidak sejajar dengan kolom kiri.
  const rightOrder = scrambleOrder(rights.length, `pair:${no}:${lefts.join('\u0001')}`, (order) =>
    order.every((value, index) => value === index)
  );
  return { lefts, rights, rightOrder };
}

/**
 * Soal mengurutkan. `items` = kumpulan objek/langkah apa adanya.
 * Kalau `answer` diisi, itulah urutan benarnya; kalau tidak, `items` dianggap
 * sudah ditulis dalam urutan benar (lalu diacak saat ditampilkan).
 */


/**
 * Soal mengurutkan. `items` = kumpulan objek/langkah apa adanya.
 * Kalau `answer` diisi, itulah urutan benarnya; kalau tidak, `items` dianggap
 * sudah ditulis dalam urutan benar (lalu diacak saat ditampilkan).
 */
export function normalizeOrdering(
  raw: Record<string, unknown>,
  no: number
): { items: string[]; presentOrder: number[]; correctOrder: number[] } {
  const items = asStringList(
    pick(raw, ['items', 'langkah', 'steps', 'urutkan', 'urutan', 'daftar', 'options', 'pilihan', 'choices'])
  ).map(wrapBareLatex);
  if (items.length < 2) throw new QuizError(`Soal #${no}: tipe ordering butuh minimal 2 item pada "items".`);

  const rawAnswer = pick(raw, ['answer', 'kunci', 'kunci_jawaban', 'urutan_benar', 'correct_order']);
  const correct: number[] = [];
  for (const entry of asStringList(rawAnswer)) {
    const index = matchOptionIndex(entry, items);
    if (index < 0 || index >= items.length) {
      throw new QuizError(`Soal #${no}: urutan benar "${entry}" tidak cocok dengan item yang tersedia.`);
    }
    if (!correct.includes(index)) correct.push(index);
  }
  const correctOrder = correct.length ? correct : items.map((_item, index) => index);
  if (correctOrder.length !== items.length) {
    throw new QuizError(
      `Soal #${no}: urutan benar harus memuat SEMUA ${items.length} item (baru ${correctOrder.length} yang tertulis).`
    );
  }

  const position = positionMap(correctOrder);
  const presentOrder = scrambleOrder(
    items.length,
    `order:${no}:${items.join('\u0001')}`,
    (order) => order.every((item, index) => position[item] === index)
  );
  return { items, presentOrder, correctOrder };
}

/**
 * Soal melengkapi tabel. Sel berupa teks biasa = statis, sedangkan sel berupa
 * objek `{ "answer": ["327"] }` = rumpang yang harus diisi siswa.
 */


/**
 * Soal melengkapi tabel. Sel berupa teks biasa = statis, sedangkan sel berupa
 * objek `{ "answer": ["327"] }` = rumpang yang harus diisi siswa.
 */
export function normalizeTableFill(raw: Record<string, unknown>, no: number): { rows: string[][]; blanks: QuizBlank[] } {
  const rawRows = pick(raw, ['rows', 'baris', 'data', 'tabel', 'grid', 'cells']);
  const rows: string[][] = [];
  const blanks: QuizBlank[] = [];

  const cellToText = (cell: unknown, rowLabel: string, rowNumber: number, positionInRow: number): string => {
    if (cell === undefined || cell === null) return '';
    if (typeof cell === 'object' && !Array.isArray(cell)) {
      const obj = cell as Record<string, unknown>;
      const accepted = asStringList(pick(obj, ['answer', 'answers', 'kunci', 'kunci_jawaban', 'jawaban']))
        .map((value) => normalizeAnswer(value))
        .filter(Boolean);
      if (!accepted.length) {
        throw new QuizError(
          `Soal #${no}: sel rumpang ke-${blanks.length + 1} belum punya kunci. Isi "answer": ["jawaban"] pada sel itu.`
        );
      }
      blanks.push({
        label: rowLabel || `Baris ${rowNumber}`,
        accepted,
      });
      return `@@BLANK${blanks.length - 1}@@`;
    }
    return wrapBareLatex(String(cell));
  };

  const rawList = Array.isArray(rawRows)
    ? rawRows
    : (() => {
        // Bentuk ringkas: daftar { label, answer } untuk tabel dua kolom.
        const flat = pick(raw, ['items', 'pernyataan', 'soal_tabel']);
        return Array.isArray(flat) ? flat : [];
      })();

  rawList.forEach((entry, index) => {
    const rowNumber = index + 1;
    if (Array.isArray(entry)) {
      // Label baris diambil dari sel statis pertama supaya pembahasan enak dibaca.
      const rowLabel = entry.find((cell) => typeof cell === 'string' && String(cell).trim() !== '');
      const text = entry.map((cell, cellIndex) => cellToText(cell, String(rowLabel ?? ''), rowNumber, cellIndex));
      rows.push(text);
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const label = String(pick(obj, ['label', 'text', 'pernyataan', 'nama', 'baris']) ?? '').trim();
      const answer = pick(obj, ['answer', 'answers', 'kunci', 'kunci_jawaban', 'jawaban']);
      rows.push([label, cellToText({ answer }, label, rowNumber, 1)]);
    }
  });

  if (!blanks.length) {
    throw new QuizError(
      `Soal #${no}: tipe table_fill butuh "rows" berisi sel rumpang, mis. "rows": [["Timah", { "answer": ["327"] }]].`
    );
  }
  return { rows, blanks };
}

/** Bacaan/stimulus yang dipakai bersama oleh beberapa soal. */


/** Bacaan/stimulus yang dipakai bersama oleh beberapa soal. */
export function normalizeStimuli(rawValue: unknown): QuizStimulus[] {
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

/**
 * Spec yang disimpan parseQuizSpec ke KV (`quiz:<slug>`) sudah berbentuk
 * ternormalisasi: kunci jawaban di `keys`, bukan `answer`. Kalau spec itu
 * dibaca ulang (panel media, editor, laporan, dll.), parseQuizSpec tidak
 * boleh memaksakan format tulis guru — cukup rehidrasi objek yang sudah jadi.
 */


/**
 * Spec yang disimpan parseQuizSpec ke KV (`quiz:<slug>`) sudah berbentuk
 * ternormalisasi: kunci jawaban di `keys`, bukan `answer`. Kalau spec itu
 * dibaca ulang (panel media, editor, laporan, dll.), parseQuizSpec tidak
 * boleh memaksakan format tulis guru — cukup rehidrasi objek yang sudah jadi.
 */
export function rehydrateQuestion(rawValue: unknown, index: number): QuizQuestion {
  const no = index + 1;
  if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
    throw new QuizError(`Soal #${no}: tiap soal harus berupa objek { ... }.`);
  }
  const raw = rawValue as Record<string, unknown>;

  const rawType = String(raw.type ?? '').trim();
  const canonicalType = TYPE_ALIASES[rawType];
  if (!canonicalType) {
    throw new QuizError(
      `Soal #${no}: tipe "${rawType}" tidak dikenal. Pakai: choice, multi, true_false, category, matching, ordering, table_fill, two_tier, highlight, short, atau essay.`
    );
  }

  const question = String(raw.question ?? '').trim();
  if (!question) throw new QuizError(`Soal #${no}: field "question" (teks soal) wajib diisi.`);

  const keys = Array.isArray(raw.keys) ? raw.keys.map((key) => String(key)) : [];
  if (canonicalType !== 'essay' && keys.length === 0) {
    throw new QuizError(`Soal #${no}: kunci jawaban (keys) kosong.`);
  }

  const rawLabels = Array.isArray(raw.labels) ? raw.labels.map((label) => String(label)) : [];
  const labels: [string, string] =
    rawLabels.length >= 2 ? [rawLabels[0], rawLabels[1]] : ['Benar', 'Salah'];

  // Spec lama bisa menyimpan LaTeX telanjang di pilihan jawaban; disamakan
  // dengan hasil parseQuizSpec supaya tampilan dan kunci tetap sinkron.
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((entry) => wrapBareLatex(String(entry))) : [];

  const statements = (Array.isArray(raw.statements) ? raw.statements : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      text: wrapBareLatex(String(entry.text ?? '').toString()),
      answer: Boolean(entry.answer) || String(entry.answer) === 'true',
    }));

  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      text: String(entry.text ?? ''),
      selectable: Boolean(entry.selectable),
      answer: Boolean(entry.answer),
    }));

  const blanks = (Array.isArray(raw.blanks) ? raw.blanks : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      label: String(entry.label ?? ''),
      accepted: Array.isArray(entry.accepted) ? entry.accepted.map((item) => String(item)) : [],
    }));

  const tableRows = (Array.isArray(raw.tableRows) ? raw.tableRows : [])
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => wrapBareLatex(String(cell ?? ''))));

  const scoring: ScoringMode = raw.scoring === 'partial' ? 'partial' : 'all';

  return {
    id: String(raw.id ?? ''),
    no,
    type: canonicalType,
    question,
    options: stringList(raw.options),
    points: Number(raw.points) > 0 ? Number(raw.points) : 1,
    keys,
    keyLabel: String(raw.keyLabel ?? ''),
    statements,
    labels,
    scoring,
    explanation: String(raw.explanation ?? '').trim(),
    level: String(raw.level ?? '').trim(),
    stimulusId: String(raw.stimulusId ?? '').trim(),
    stimulusTitle: String(raw.stimulusTitle ?? '').trim(),
    stimulusContent: String(raw.stimulusContent ?? '').trim(),
    rights: stringList(raw.rights),
    blanks,
    reasons: stringList(raw.reasons),
    segments,
    passage: String(raw.passage ?? ''),
    tableHeaders: stringList(raw.tableHeaders),
    tableRows,
  };
}



export function normalizeQuestion(rawValue: unknown, index: number): QuizQuestion {
  const no = index + 1;
  if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
    throw new QuizError(`Soal #${no}: tiap soal harus berupa objek { ... }.`);
  }

  const raw = rawValue as Record<string, unknown>;

  // Tipe dibaca lebih dulu karena beberapa nama field punya arti berbeda per
  // tipe: `text` = bacaan pada highlight tapi = teks soal pada tipe lain, dan
  // `rows` = baris tabel pada table_fill tapi = pernyataan pada kategori.
  // Tanpa ini, soal melengkapi tabel akan salah dibaca sebagai tabel Benar/Salah.
  const rawType = String(pick(raw, ['type', 'tipe', 'jenis']) ?? '')
    .toLowerCase()
    .replace(/[-\s/]/g, '_');
  const declaredType = rawType ? TYPE_ALIASES[rawType] : undefined;

  const rawQuestion =
    declaredType === 'highlight'
      ? String(pick(raw, ['question', 'pertanyaan', 'instruksi', 'perintah', 'prompt']) ?? '').trim() ||
        'Pilih kata atau frasa yang tepat pada bacaan berikut.'
      : String(pick(raw, ['question', 'pertanyaan', 'soal', 'text', 'teks']) ?? '').trim();
  if (!rawQuestion) throw new QuizError(`Soal #${no}: field "question" (teks soal) wajib diisi.`);

  // Soal bergambar boleh menaruh gambarnya di field terpisah (`image`/`gambar`/`foto`).
  // Isinya `media:nama-slot` (diunggah lewat panel Gambar) atau URL http(s).
  const imageMarkdown = imageFieldToMarkdown(pick(raw, ['image', 'gambar', 'foto', 'img']));
  const question = imageMarkdown ? `${rawQuestion}\n\n${imageMarkdown}` : rawQuestion;

  // Soal kategori: pernyataan + kuncinya. Lebih diperiksa dulu sebelum tipe
  // dipastikan, supaya `type: "true_false"` yang isinya tabel ikut tertangkap.
  // Tipe yang memakai `pernyataan`/`rows` untuk hal lain tidak ikut diproses.
  const usesStatements = declaredType !== 'table_fill' && declaredType !== 'matching';
  const statementFallback = asStringList(pick(raw, ['answers', 'kunci_benar_salah']));
  const statements = usesStatements
    ? normalizeStatements(
        pick(raw, ['statements', 'pernyataan', 'rows', 'baris', 'daftar_pernyataan', 'list_pernyataan']),
        statementFallback,
        no
      )
    : [];

  let type = declaredType;
  if (!type) {
    if (rawType) {
      throw new QuizError(
        `Soal #${no}: tipe "${rawType}" tidak dikenal. Pakai: choice, multi, true_false, category, matching, ordering, table_fill, two_tier, highlight, short, atau essay.`
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
    stimulusTitle: '',
    stimulusContent: '',
    rights: [] as string[],
    blanks: [] as QuizBlank[],
    reasons: [] as string[],
    segments: [] as QuizSegment[],
    passage: '',
    tableHeaders: [] as string[],
    tableRows: [] as string[][],
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
      ? rawOptions.map((opt) => wrapBareLatex(String(opt).trim())).filter((opt) => opt !== '')
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

  if (type === 'matching') {
    const { lefts, rights, rightOrder } = normalizePairs(raw, no);
    // Kunci = posisi tiap pasangan di kolom kanan yang sudah diacak.
    const positions = positionMap(rightOrder);
    return {
      ...base,
      options: lefts,
      rights: rightOrder.map((source) => rights[source]),
      keys: [lefts.map((_left, index) => String(positions[index])).join('|')],
      keyLabel: lefts.map((left, index) => `${left} \u2192 ${rights[index]}`).join(' \u00b7 '),
    };
  }

  if (type === 'ordering') {
    const { items, presentOrder, correctOrder } = normalizeOrdering(raw, no);
    const positions = positionMap(presentOrder);
    return {
      ...base,
      options: presentOrder.map((source) => items[source]),
      keys: [correctOrder.map((source) => String(positions[source])).join('|')],
      keyLabel: correctOrder.map((source, index) => `${index + 1}. ${items[source]}`).join(' \u00b7 '),
    };
  }

  if (type === 'table_fill') {
    const { rows, blanks } = normalizeTableFill(raw, no);
    return {
      ...base,
      options: [],
      blanks,
      tableHeaders: asStringList(pick(raw, ['headers', 'header', 'kolom', 'judul_kolom'])).map(wrapBareLatex),
      tableRows: rows,
      keys: [],
      keyLabel: blanks.map((blank, index) => `${index + 1}. ${blank.accepted.join(' / ')}`).join(' \u00b7 '),
    };
  }

  if (type === 'two_tier') {
    const options = asStringList(pick(raw, ['options', 'pilihan', 'tier1', 'pernyataan'])).map(wrapBareLatex);
    const reasons = asStringList(pick(raw, ['reasons', 'alasan', 'options2', 'pilihan_alasan', 'tier2'])).map(wrapBareLatex);
    if (options.length < 2) throw new QuizError(`Soal #${no}: tipe two_tier butuh "options" (pernyataan) minimal 2 pilihan.`);
    if (reasons.length < 2) throw new QuizError(`Soal #${no}: tipe two_tier butuh "reasons" (pilihan alasan) minimal 2 pilihan.`);

    const first = matchOptionIndex(pick(raw, ['answer', 'kunci', 'kunci_jawaban']), options);
    if (first < 0 || first >= options.length) {
      throw new QuizError(`Soal #${no}: kunci pernyataan two_tier tidak cocok dengan "options" yang tersedia.`);
    }
    const second = matchOptionIndex(
      pick(raw, ['reason_answer', 'kunci_alasan', 'answer2', 'kunci_2', 'alasan_benar']),
      reasons
    );
    if (second < 0 || second >= reasons.length) {
      throw new QuizError(`Soal #${no}: kunci alasan two_tier tidak cocok dengan "reasons" yang tersedia.`);
    }
    return {
      ...base,
      options,
      reasons,
      keys: [`${first}|${second}`],
      keyLabel: `${optionLetter(first)}. ${options[first]} \u2014 ${optionLetter(second)}. ${reasons[second]}`,
    };
  }

  if (type === 'highlight') {
    const rawPassage = String(
      pick(raw, ['passage', 'text', 'teks', 'bacaan', 'teks_bacaan', 'paragraph', 'isi', 'content']) ?? ''
    ).trim();
    if (!rawPassage) {
      throw new QuizError(
        `Soal #${no}: tipe highlight butuh "text" berisi bacaan, dengan kata yang boleh dipilih diapit kurawal { }.`
      );
    }
    const segments = parseSegments(rawPassage);
    const selectableAt = segments
      .map((segment, index) => (segment.selectable ? index : -1))
      .filter((index) => index >= 0);
    if (!selectableAt.length) {
      throw new QuizError(
        `Soal #${no}: belum ada kata yang bisa diklik. Apit kata yang boleh dipilih dengan kurawal, mis. "Budi {mengembalikan} uang itu."`
      );
    }

    const list = asStringList(pick(raw, ['answer', 'kunci', 'kunci_jawaban', 'targets', 'kata_kunci']));
    if (!list.length) {
      throw new QuizError(`Soal #${no}: tipe highlight butuh "answer" berisi kata/frasa yang benar.`);
    }
    const picked: number[] = [];
    for (const item of list) {
      const index = selectableAt.findIndex(
        (position) => normalizeAnswer(segments[position].text) === normalizeAnswer(item)
      );
      if (index < 0) {
        throw new QuizError(`Soal #${no}: kunci "${item}" tidak ditemukan di antara kata yang boleh diklik.`);
      }
      if (!picked.includes(index)) picked.push(index);
    }
    picked.sort((a, b) => a - b);
    for (const index of picked) segments[selectableAt[index]].answer = true;

    return {
      ...base,
      options: [],
      segments,
      passage: segments.map((segment) => segment.text).join(''),
      keys: [picked.join('|')],
      keyLabel: picked.map((index) => segments[selectableAt[index]].text).join(' / '),
    };
  }

  // essay
  return { ...base, options: [], keys: [], keyLabel: '' };
}



export function detectFeatures(rawText: string, questions: QuizQuestion[]): Set<Feature> {
  // JSON mentah menulis baris baru sebagai escape "\n" (dua karakter), jadi
  // deteksi berbasis baris (mis. tabel markdown) gagal kalau escape-nya tidak
  // dibuka lebih dulu. Membuka escape juga menghindari false positive "\"...""
  // yang tidak sengaja terbaca sebagai rumus LaTeX.
  const decoded = rawText.replace(/\\[nrt]/g, '\n').replace(/\\"/g, '"');
  const blob =
    decoded +
    '\n' +
    questions
      .map((q) =>
        [
          q.question,
          q.passage,
          q.options.join('\n'),
          q.rights.join('\n'),
          q.reasons.join('\n'),
          q.statements.map((s) => s.text).join('\n'),
          q.segments.map((s) => s.text).join('\n'),
          q.tableHeaders.join('\n'),
          q.tableRows.map((row) => row.join('\n')).join('\n'),
          q.explanation,
        ].join('\n')
      )
      .join('\n');
  const found = new Set<Feature>();
  if (/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\[a-zA-Z]{2,}/.test(blob)) found.add('math');
  if (ARABIC_RUN.test(blob)) found.add('arabic');
  if (JAVANESE_RUN.test(blob)) found.add('jawa');
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

  // Spec simpanan parseQuizSpec memakai kunci `keys` per soal (bukan `answer`).
  // Deteksi bentuk ternormalisasi agar baca-ulang spec lama tidak gagal.
  const allNormalized = rawQuestions.every(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).keys)
  );
  const questions = allNormalized
    ? rawQuestions.map((item, index) => rehydrateQuestion(item, index))
    : rawQuestions.map((item, index) => normalizeQuestion(item, index));
  const seen = new Set<string>();
  for (const question of questions) {
    let id = String((rawQuestions[question.no - 1] as Record<string, unknown>)?.id ?? `q${question.no}`).trim() || `q${question.no}`;
    while (seen.has(id)) id = `${id}-${question.no}`;
    seen.add(id);
    question.id = id;
  }

  // Bacaan/stimulus: bisa berupa id bersama, objek {title, content}, atau teks
  // yang ditulis langsung di soal. Format lama (daftar "stimuli" + rujukan id
  // grup) tetap diterima, lalu SEMUA bacaan didenormalisasi ke tiap soal —
  // setiap butir akhirnya memegang salinan bacaannya sendiri (satu stimulus
  // untuk satu soal), sehingga rendering tidak perlu lagi mengelompokkan.
  const stimuli = normalizeStimuli(pick(obj, ['stimuli', 'stimulus', 'bacaan', 'daftar_bacaan', 'wacana']));
  const knownStimulus = new Set(stimuli.map((stimulus) => stimulus.id));
  let autoStimulus = 0;
  for (const question of questions) {
    const rawQuestion = rawQuestions[question.no - 1] as Record<string, unknown>;
    const reference = pick(rawQuestion, ['stimulus', 'stimulus_id', 'bacaan', 'wacana']);
    if (reference === undefined) continue;

    if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
      const entry = reference as Record<string, unknown>;
      const content = String(pick(entry, ['content', 'text', 'teks', 'isi', 'bacaan', 'konten']) ?? '').trim();
      if (!content) continue;
      question.stimulusTitle = String(pick(entry, ['title', 'judul', 'nama']) ?? '').trim();
      question.stimulusContent = content;
      if (question.stimulusId) continue;
      autoStimulus += 1;
      const id = `s-auto-${autoStimulus}`;
      if (!question.stimulusTitle) question.stimulusTitle = `Bacaan ${autoStimulus}`;
      stimuli.push({ id, title: question.stimulusTitle, content });
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
    question.stimulusContent = text;
    question.stimulusTitle = `Bacaan ${autoStimulus}`;
  }

  // Denormalisasi: salin bacaan ke tiap soal (mencakup rujukan grup lama pada
  // spec mentah maupun spec tersimpan yang dibaca ulang via rehydrate).
  for (const question of questions) {
    if (question.stimulusContent || !question.stimulusId) continue;
    const stimulus = stimuli.find((entry) => entry.id === question.stimulusId);
    if (stimulus) {
      question.stimulusTitle = stimulus.title;
      question.stimulusContent = stimulus.content;
    }
  }

  const features = detectFeatures(raw, questions);
  const addFeatures = asStringList(pick(obj, ['features', 'fitur']));
  const removeFeatures = asStringList(pick(obj, ['without_features', 'tanpa_fitur']));
  for (const name of addFeatures) {
    const feature = FEATURE_ALIASES[name.toLowerCase().trim()];
    if (!feature) throw new QuizError(`Fitur "${name}" tidak dikenal. Pilihan: math, arabic, jawa, image, audio, table, code.`);
    features.add(feature);
  }
  for (const name of removeFeatures) features.delete(FEATURE_ALIASES[name.toLowerCase().trim()]);

  const rawKkm = Number(pick(obj, ['passing_score', 'kkm', 'nilai_minimum', 'nilai_lulus']) ?? 70);
  const passingScore = Number.isFinite(rawKkm) ? Math.min(100, Math.max(0, Math.round(rawKkm))) : 70;

  // Durasi latihan opsional (menit).
  //   - kunci `duration_minutes` tidak ada  -> DEFAULT_DURATION_MINUTES (90)
  //   - `duration_minutes: 0` atau teks aneh -> tanpa timer (sengaja dikosongkan)
  // Batas 1-600 menit supaya typo (mis. 6000) tidak jadi penghitung yang tidak
  // masuk akal. Perhatikan bedanya: "tidak ada" berarti 90, "0" berarti sengaja
  // tanpa timer — jangan disamakan, karena itu cara guru mematikan timer.
  const rawDuration = Number(pick(obj, ['duration_minutes', 'durasi_menit']) ?? DEFAULT_DURATION_MINUTES);
  const durationMinutes =
    Number.isFinite(rawDuration) && rawDuration >= 1 && rawDuration <= 600 ? Math.round(rawDuration) : null;

  // Bentuk identitas: default 'name' (perilaku lama). 'name_class' menambah
  // input kelas wajib di halaman siswa.
  const rawIdentity = String(pick(obj, ['identity_fields', 'identitas']) ?? 'name').trim();
  const identityFields = rawIdentity === 'name_class' || rawIdentity === 'nama_kelas' ? 'name_class' : 'name';

  return {
    title: String(pick(obj, ['title', 'judul', 'nama']) ?? '').trim(),
    description: String(pick(obj, ['description', 'deskripsi', 'petunjuk', 'instruksi']) ?? '').trim(),
    slug: String(pick(obj, ['slug']) ?? '').trim(),
    passingScore,
    durationMinutes,
    identityFields,
    features: [...features],
    stimuli,
    showExplanation: resolveBoolean(pick(obj, ['show_explanation', 'tampilkan_pembahasan'])) !== false,
    // Default MATI: siswa tidak melihat status benar/salah per butir. Kunci
    // jawaban sendiri selalu dibuang terpisah di publicGrading(), sakelar ini
    // hanya soal umpan balik.
    showItemFeedback: resolveBoolean(pick(obj, ['show_item_feedback', 'tampilkan_status_jawab'])) === true,
    questions,
  };
}

/**
 * Kebalikan dari parseQuizSpec: susun kembali format tulis yang guru kenal
 * (`options` + `answer` + `points`) dari spec yang sudah dinormalisasi.
 * Dipakai editor soal — termasuk menarik kembali gambar yang tadi ditempelkan
 * ke ujung teks soal supaya tidak jadi gambar dobel saat disimpan ulang.
 */


/**
 * Kebalikan dari parseQuizSpec: susun kembali format tulis yang guru kenal
 * (`options` + `answer` + `points`) dari spec yang sudah dinormalisasi.
 * Dipakai editor soal — termasuk menarik kembali gambar yang tadi ditempelkan
 * ke ujung teks soal supaya tidak jadi gambar dobel saat disimpan ulang.
 */
export const APPENDED_IMAGE_RE = /\r?\n\r?\n(!\[[^\]]*\]\(media:[^)\s]+\)|media:[A-Za-z0-9_.\-]+)\s*$/i;



export function pullTrailingImage(text: string): { text: string; image: string } {
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
    // Setiap soal memegang bacaannya sendiri: tulis objek stimulus per soal
    // (bukan rujukan id grup) supaya editor bisa mengubah tiap bacaan mandiri.
    if (question.stimulusContent) {
      item.stimulus = {
        ...(question.stimulusTitle ? { title: question.stimulusTitle } : {}),
        content: question.stimulusContent,
      };
    }

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
    } else if (question.type === 'matching') {
      // Ditulis ulang sebagai pasangan supaya guru tidak perlu menebak urutan kolom kanan.
      const keys = question.keys[0].split('|').map(Number);
      item.pairs = question.options.map((left, index) => ({ left, right: question.rights[keys[index]] ?? '' }));
    } else if (question.type === 'ordering') {
      const keys = (question.keys[0] ?? '')
        .split('|')
        .filter((value) => value !== '')
        .map(Number);
      item.items = question.options;
      item.answer = keys.map((index) => question.options[index]);
    } else if (question.type === 'table_fill') {
      if (question.tableHeaders.length) item.headers = question.tableHeaders;
      item.rows = question.tableRows.map((row) =>
        row.map((cell) => {
          const blank = /^@@BLANK(\d+)@@$/.exec(cell);
          if (!blank) return cell;
          return { answer: (question.blanks[Number(blank[1])]?.accepted ?? []).slice() };
        })
      );
    } else if (question.type === 'two_tier') {
      const keys = question.keys[0].split('|').map(Number);
      item.options = question.options;
      item.answer = optionLetter(keys[0]);
      item.reasons = question.reasons;
      item.reason_answer = optionLetter(keys[1]);
    } else if (question.type === 'highlight') {
      item.text = question.segments.map((segment) => (segment.selectable ? `{${segment.text}}` : segment.text)).join('');
      item.answer = question.segments.filter((segment) => segment.selectable && segment.answer).map((segment) => segment.text);
    }
    return item;
  });

  return {
    title: quiz.title,
    description: quiz.description,
    passing_score: quiz.passingScore,
    // Selalu tulis duration_minutes, termasuk 0 untuk kuis tanpa timer.
    // Kalau kuncinya dihapus saat durationMinutes null, editor akan memakai
    // DEFAULT_DURATION_MINUTES dan kuis yang sengaja tanpa timer ikut dapet
    // timer begitu guru menyimpan perubahan berikutnya.
    duration_minutes: quiz.durationMinutes ?? 0,
    ...(quiz.identityFields === 'name_class' ? { identity_fields: 'name_class' } : {}),
    ...(quiz.showExplanation === false ? { show_explanation: false } : {}),
    // Sama seperti show_explanation: hanya tulis saat tidak default, supaya
    // JSON yang disimpan guru tetap ringkas dan key yang hilang = default mati.
    ...(quiz.showItemFeedback ? { show_item_feedback: true } : {}),
    questions,
  };
}

/* -------------------------------------------------------------------------- */
/* Renderer teks kaya (subset markdown aman)                                  */
/* -------------------------------------------------------------------------- */

