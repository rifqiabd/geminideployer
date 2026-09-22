/* ==========================================================================
 * Analisis butir soal untuk halaman rekap data.
 * --------------------------------------------------------------------------
 * Semua angkanya dihitung dari `detail` hasil penilaian yang sudah tersimpan di
 * D1 saat siswa mengirim jawaban — jadi tidak ada data tambahan yang perlu
 * dikirim dari browser siswa, dan tidak bisa dipalsukan dari sisi klien.
 *
 * Yang dihitung per soal:
 *   - tingkat kesukaran  : persentase siswa yang menjawab benar
 *   - daya beda (D)      : benar di kelompok atas dikurangi kelompok bawah
 *                          (27% atas vs 27% bawah, berdasarkan nilai total)
 *   - sebaran pengecoh   : berapa siswa memilih tiap pilihan (PG saja)
 * ========================================================================== */

// Impor memakai ekstensi .ts karena file ini ikut dijalankan langsung oleh Node
// dari tests/quiz.test.mjs, dan Node ESM tidak menebak ekstensi seperti esbuild.
import { escapeHtml } from './quiz.ts';
import type { QuestionType, QuizQuestion, QuizSpec } from './quiz.ts';

export type ItemOption = { letter: string; text: string; count: number; isKey: boolean };

export type ItemStat = {
  no: number;
  id: string;
  type: QuestionType;
  label: string;
  points: number;
  /** Peserta yang jawabannya dinilai otomatis (benar + salah). */
  answered: number;
  correct: number;
  wrong: number;
  /** Esai yang menunggu koreksi guru (tidak masuk hitungan persentase). */
  pending: number;
  /** PG yang dibiarkan kosong. */
  blank: number;
  percentCorrect: number;
  difficulty: 'Sulit' | 'Sedang' | 'Mudah' | '—';
  discrimination: number | null;
  discriminationLabel: string;
  options: ItemOption[] | null;
  /**
   * Bagian yang paling sering keliru pada soal berbaris (kategori, menjodohkan,
   * mengurutkan, tabel, highlight) — mis. pernyataan mana yang paling banyak
   * salah. `null` untuk soal yang tidak punya baris (PG, esai).
   */
  weakestRows: Array<{ text: string; wrong: number; total: number }> | null;
  note: string;
  level: 'ok' | 'warn' | 'bad' | 'muted';
};

export type ItemAnalysis = {
  /** Total pengiriman yang punya detail penilaian. */
  participants: number;
  average: number;
  highest: number;
  lowest: number;
  passed: number;
  failed: number;
  awaiting: number;
  kkm: number;
  /** true kalau jumlah peserta sudah cukup untuk menghitung daya beda. */
  hasDiscrimination: boolean;
  items: ItemStat[];
};

const TYPE_LABEL: Record<QuestionType, string> = {
  choice: 'PG',
  multi: 'PG kompleks',
  category: 'PG kompleks kategori',
  true_false: 'Benar/Salah',
  matching: 'Menjodohkan',
  ordering: 'Mengurutkan',
  table_fill: 'Melengkapi tabel',
  two_tier: 'Pernyataan + alasan',
  highlight: 'Pilih kata di bacaan',
  short: 'Isian',
  essay: 'Esai',
};

/** Peserta minimal supaya daya beda ada artinya (27% atas vs 27% bawah). */
const MIN_FOR_DISCRIMINATION = 8;

type DetailEntry = {
  id?: unknown;
  benar?: boolean | null;
  jawaban?: unknown;
  statements?: Array<{ text?: unknown; benar?: unknown }>;
};
type GradedSubmission = { detail: DetailEntry[]; score: number; lulus: boolean | null };

function asGradedSubmission(value: unknown): GradedSubmission | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.detail)) return null;
  return {
    detail: record.detail as DetailEntry[],
    // Kalau esainya sudah dikoreksi, nilai akhir lebih mewakili hasil siswa.
    score:
      typeof record.final_score === 'number'
        ? record.final_score
        : typeof record.score === 'number'
          ? record.score
          : 0,
    lulus: typeof record.lulus === 'boolean' ? record.lulus : null,
  };
}

function findEntry(submission: GradedSubmission, questionId: string): DetailEntry | null {
  for (const entry of submission.detail) {
    if (entry && String(entry.id) === questionId) return entry;
  }
  return null;
}

/**
 * Ambil pilihan yang diklik siswa dari teks jawaban yang ditampilkan server.
 * Pilihan tunggal ditulis "A. Klorofil", pilihan kompleks "A, C", dan kosong "".
 */
function parsePicked(display: unknown, isMulti: boolean): number[] {
  const text = String(display ?? '').trim();
  if (!text) return [];
  if (!isMulti) {
    const match = text.match(/^([A-Z])\./);
    return match ? [match[1].charCodeAt(0) - 65] : [];
  }
  const indexes: number[] = [];
  for (const part of text.split(',')) {
    const token = part.trim();
    if (/^[A-Z]$/.test(token)) indexes.push(token.charCodeAt(0) - 65);
  }
  return indexes;
}

function difficultyOf(answered: number, correct: number): ItemStat['difficulty'] {
  if (!answered) return '—';
  const proportion = correct / answered;
  if (proportion >= 0.7) return 'Mudah';
  if (proportion >= 0.3) return 'Sedang';
  return 'Sulit';
}

function discriminationLabelOf(value: number | null): string {
  if (value === null) return '—';
  if (value < 0) return 'Negatif';
  if (value >= 0.4) return 'Baik sekali';
  if (value >= 0.3) return 'Baik';
  if (value >= 0.2) return 'Cukup';
  return 'Jelek';
}

/** Teks soal jadi satu baris pendek, aman dipakai di tabel dan CSV. */
function plainQuestion(question: QuizQuestion): string {
  return String(question.question ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [gambar] ')
    .replace(/```[\s\S]*?```/g, ' [kode] ')
    .replace(/[*_`#$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupCorrectRatio(group: GradedSubmission[], questionId: string): number | null {
  let seen = 0;
  let correct = 0;
  for (const submission of group) {
    const entry = findEntry(submission, questionId);
    if (!entry || entry.benar === null || entry.benar === undefined) continue;
    seen += 1;
    if (entry.benar) correct += 1;
  }
  return seen ? correct / seen : null;
}

export function computeItemAnalysis(spec: QuizSpec, payloads: unknown[]): ItemAnalysis {
  const submissions: GradedSubmission[] = [];
  for (const payload of payloads) {
    const graded = asGradedSubmission(payload);
    if (graded) submissions.push(graded);
  }

  const scores = submissions.map((submission) => submission.score);
  const ranked = [...submissions].sort((a, b) => b.score - a.score);
  const groupSize =
    ranked.length >= MIN_FOR_DISCRIMINATION ? Math.max(1, Math.round(ranked.length * 0.27)) : 0;
  const upper = groupSize ? ranked.slice(0, groupSize) : [];
  const lower = groupSize ? ranked.slice(-groupSize) : [];

  const items: ItemStat[] = spec.questions.map((question) => {
    const isChoiceLike = question.type === 'choice' || question.type === 'multi';
    const optionCounts = question.options.map(() => 0);
    // Rincian per baris hanya ada pada tipe berbaris; dipakai untuk mencari
    // bagian mana yang paling sering keliru.
    const rowTally: Array<{ text: string; wrong: number; total: number }> = [];
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    let pending = 0;
    let blank = 0;

    for (const submission of submissions) {
      const entry = findEntry(submission, question.id);
      if (!entry) continue;

      if (Array.isArray(entry.statements)) {
        entry.statements.forEach((row, index) => {
          if (!rowTally[index]) rowTally[index] = { text: String(row?.text ?? ''), wrong: 0, total: 0 };
          rowTally[index].total += 1;
          if (row?.benar === false) rowTally[index].wrong += 1;
        });
      }

      if (entry.benar === null || entry.benar === undefined) {
        pending += 1;
        continue;
      }
      answered += 1;
      if (entry.benar) correct += 1;
      else wrong += 1;

      if (isChoiceLike) {
        const picked = parsePicked(entry.jawaban, question.type === 'multi');
        if (!picked.length) blank += 1;
        for (const index of picked) if (index < optionCounts.length) optionCounts[index] += 1;
      }
    }

    let discrimination: number | null = null;
    if (groupSize) {
      const upperRatio = groupCorrectRatio(upper, question.id);
      const lowerRatio = groupCorrectRatio(lower, question.id);
      if (upperRatio !== null && lowerRatio !== null) discrimination = upperRatio - lowerRatio;
    }

    const percentCorrect = answered ? Math.round((correct / answered) * 100) : 0;
    const keys = question.keys;
    const note = itemNote(question, { answered, percentCorrect, discrimination });

    return {
      no: question.no,
      id: question.id,
      type: question.type,
      label: plainQuestion(question),
      points: question.points,
      answered,
      correct,
      wrong,
      pending,
      blank,
      percentCorrect,
      difficulty: difficultyOf(answered, correct),
      discrimination,
      discriminationLabel: discriminationLabelOf(discrimination),
      options: isChoiceLike
        ? question.options.map((text, index) => ({
            letter: String.fromCharCode(65 + index),
            text,
            count: optionCounts[index],
            isKey:
              question.type === 'multi'
                ? keys[0].split('|').includes(String(index))
                : keys[0] === String(index),
          }))
        : null,
      weakestRows: rowTally.length
        ? rowTally
            .map((row) => ({ text: row.text, wrong: row.wrong, total: row.total }))
            .filter((row) => row.wrong > 0)
            .sort((a, b) => b.wrong - a.wrong || a.text.localeCompare(b.text))
            .slice(0, 3)
        : null,
      note: note.text,
      level: note.level,
    };
  });

  return {
    participants: submissions.length,
    average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    highest: scores.length ? Math.max(...scores) : 0,
    lowest: scores.length ? Math.min(...scores) : 0,
    passed: submissions.filter((submission) => submission.lulus === true).length,
    failed: submissions.filter((submission) => submission.lulus === false).length,
    awaiting: submissions.filter((submission) => submission.lulus === null).length,
    kkm: spec.passingScore,
    hasDiscrimination: groupSize > 0,
    items,
  };
}

function itemNote(
  question: QuizQuestion,
  stat: { answered: number; percentCorrect: number; discrimination: number | null }
): { text: string; level: ItemStat['level'] } {
  if (question.type === 'essay') {
    return { text: 'Tidak dinilai otomatis, dikoreksi guru', level: 'muted' };
  }
  if (!stat.answered) return { text: 'Belum ada jawaban masuk', level: 'muted' };
  if (stat.discrimination !== null && stat.discrimination < 0) {
    return { text: 'Daya beda negatif, kemungkinan besar kunci jawabannya salah', level: 'bad' };
  }
  if (stat.percentCorrect < 30) {
    return { text: 'Terlalu sulit, cek ulang kunci atau pembahasannya', level: 'bad' };
  }
  if (stat.percentCorrect > 90) {
    return { text: 'Terlalu mudah, hampir semua siswa menjawab benar', level: 'warn' };
  }
  if (stat.discrimination !== null && stat.discrimination < 0.2) {
    return { text: 'Daya beda rendah, belum bisa membedakan siswa mampu dan kurang mampu', level: 'warn' };
  }
  return { text: 'Baik', level: 'ok' };
}

/* -------------------------------------------------------------------------- */
/* Tampilan                                                                   */
/* -------------------------------------------------------------------------- */

const LEVEL_CLASS: Record<ItemStat['level'], string> = {
  ok: 'tone-ok',
  warn: 'tone-warn',
  bad: 'tone-bad',
  muted: 'tone-muted',
};

function bar(percent: number, tone: 'ok' | 'warn' | 'bad' | 'key'): string {
  const color =
    tone === 'ok' ? 'fill-ok' : tone === 'warn' ? 'fill-warn' : tone === 'bad' ? 'fill-bad' : 'fill-key';
  return `<div class="bar"><div class="bar-fill ${color}" style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>`;
}

function optionBars(item: ItemStat): string {
  if (!item.options) return '';
  let answeredTotal = 0;
  for (const option of item.options) answeredTotal += option.count;
  const total = answeredTotal + item.blank;
  const rows = item.options
    .map((option) => {
      const percent = total ? Math.round((option.count / total) * 100) : 0;
      return `<div class="opt-row">
        <span class="opt-letter ${option.isKey ? 'key' : ''}">${option.letter}</span>
        <span class="opt-text ${option.isKey ? 'key' : ''}" title="${escapeHtml(option.text)}">${escapeHtml(option.text || '(kosong)')}</span>
        ${bar(percent, option.isKey ? 'ok' : 'key')}
        <span class="opt-count">${option.count} siswa (${percent}%)</span>
      </div>`;
    })
    .join('');
  const blankRow = item.blank
    ? `<div class="opt-row tone-muted"><span class="opt-letter">–</span><span class="opt-text">Tidak dijawab</span><span class="bar"></span><span class="opt-count">${item.blank} siswa</span></div>`
    : '';
  return `<div class="opt-box">
    <p class="opt-cap">Sebaran pilihan (kunci ditandai hijau):</p>
    ${rows}${blankRow}
  </div>`;
}

/** Bagian yang paling sering keliru, mis. pernyataan ke-2 pada soal kategori. */
function weakestRowsBlock(item: ItemStat): string {
  if (!item.weakestRows || !item.weakestRows.length) return '';
  const parts = item.weakestRows
    .map((row) => {
      const text = row.text.length > 70 ? `${row.text.slice(0, 70)}\u2026` : row.text;
      return `<span class="tone-warn">${escapeHtml(text || '(tanpa label)')}</span> <span class="tone-muted">${row.wrong}/${row.total} salah</span>`;
    })
    .join(' \u00b7 ');
  return `<div class="r-note">Bagian tersering keliru: ${parts}</div>`;
}

function tile(label: string, value: string, hint: string, tone = ''): string {
  return `<div class="tile">
    <p class="tile-label">${escapeHtml(label)}</p>
    <p class="tile-value ${tone}">${value}</p>
    <p class="tile-hint">${hint}</p>
  </div>`;
}

export function renderItemAnalysis(analysis: ItemAnalysis): string {
  const { participants, items } = analysis;

  const tiles = `<div class="r-tiles">
    ${tile('Peserta', String(participants), 'pengiriman yang dinilai')}
    ${tile('Rata-rata', String(analysis.average), `KKM ${analysis.kkm}`, 'tone-warn')}
    ${tile('Tertinggi', String(analysis.highest), 'nilai terbaik', 'tone-ok')}
    ${tile('Terendah', String(analysis.lowest), 'nilai terendah', 'tone-bad')}
    ${tile(
      'Lulus',
      `${analysis.passed}/${participants}`,
      analysis.awaiting ? `${analysis.awaiting} menunggu koreksi esai` : `${analysis.failed} belum lulus`
    )}
  </div>`;

  if (!participants) {
    return `<section class="r-section">
      <div class="r-head">
        <h2 class="r-title">Analisis Butir Soal</h2>
      </div>
      <div class="r-empty">Belum ada jawaban siswa yang bisa dianalisis. Statistik muncul otomatis setelah siswa mengirim jawaban.</div>
    </section>`;
  }

  const rows = items
    .map((item) => {
      const tone = item.percentCorrect >= 70 ? 'ok' : item.percentCorrect >= 30 ? 'warn' : 'bad';
      const disc = item.discrimination === null ? '—' : item.discrimination.toFixed(2);
      const detail =
        item.type === 'essay'
          ? `<span class="tone-muted">${item.pending} jawaban esai menunggu koreksi</span>`
          : `${item.answered} menjawab`;
      const optionsBlock = item.options ? optionBars(item) : '';
      return `<tr class="r-row">
        <td class="r-cell r-no">${item.no}</td>
        <td class="r-cell">
          <div class="r-q">${escapeHtml(item.label.slice(0, 140))}${item.label.length > 140 ? '…' : ''}</div>
          <div class="r-sub">${TYPE_LABEL[item.type]}${item.points !== 1 ? ` · bobot ${item.points}` : ''} · ${detail}</div>
          ${
            item.options
              ? `<details class="r-details"><summary class="r-summary">Lihat sebaran pilihan</summary>${optionsBlock}</details>`
              : ''
          }
          ${weakestRowsBlock(item)}
        </td>
        <td class="r-cell r-num tone-ok">${item.correct}</td>
        <td class="r-cell r-num tone-bad">${item.wrong}</td>
        <td class="r-cell">
          <div class="r-pct">
            <span class="r-pct-txt">${item.answered ? item.percentCorrect + '%' : '—'}</span>
            ${bar(item.percentCorrect, tone)}
          </div>
        </td>
        <td class="r-cell r-num">
          <span class="${
            item.difficulty === 'Sulit' ? 'tone-bad' : item.difficulty === 'Mudah' ? 'tone-ok' : 'tone-muted'
          }">${item.difficulty}</span>
        </td>
        <td class="r-cell r-num">
          <span class="r-mono">${disc}</span>
          <div class="r-sub ${item.discrimination !== null && item.discrimination < 0.2 ? 'tone-bad' : 'tone-muted'}">${item.discriminationLabel}</div>
        </td>
        <td class="r-cell r-note ${LEVEL_CLASS[item.level]}">${escapeHtml(item.note)}</td>
      </tr>`;
    })
    .join('');

  const discriminationNote = analysis.hasDiscrimination
    ? ''
    : `<p class="r-footnote tone-warn">Daya beda belum bisa dihitung — butuh minimal ${MIN_FOR_DISCRIMINATION} peserta.</p>`;

  return `<section class="r-section">
    <div class="r-head">
      <div>
        <h2 class="r-title">Analisis Butir Soal</h2>
        <p class="r-sub">Dihitung dari jawaban yang sudah masuk, tanpa perlu mengirim ulang apa pun.</p>
      </div>
      <button id="item-csv" type="button" class="btn">
        <i class="fa-solid fa-file-csv"></i>Unduh CSV
      </button>
    </div>

    ${tiles}

    <div class="table-wrap">
      <div class="table-scroll">
        <table class="r-table">
          <thead class="r-head-row">
            <tr>
              <th>No</th>
              <th>Soal</th>
              <th class="right">Benar</th>
              <th class="right">Salah</th>
              <th class="right">% Benar</th>
              <th class="right">Tingkat</th>
              <th class="right">Daya Beda</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody class="r-body">${rows}</tbody>
        </table>
      </div>
      <div class="r-foot">
        ${discriminationNote}
        <p class="r-footnote tone-muted">
          Nilai memakai <b>nilai akhir</b> (objektif + esai) untuk kiriman yang esainya sudah dikoreksi, dan nilai
          objektif untuk yang belum. Tingkat: &lt;30% sulit, 30–70% sedang, &gt;70% mudah. Daya beda (kelompok 27% atas vs 27% bawah):
          &lt;0,20 jelek · 0,20–0,29 cukup · 0,30–0,39 baik · ≥0,40 baik sekali · negatif berarti kunci perlu dicek.
        </p>
      </div>
    </div>
  </section>

  <script>window.ITEM_ANALYSIS = ${JSON.stringify(analysis).replace(/</g, '\\u003c')};</script>
  <script src="/vendor/quiz-report.js"></script>`;
}
