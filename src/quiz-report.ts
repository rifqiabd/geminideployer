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
  true_false: 'Benar/Salah',
  short: 'Isian',
  essay: 'Esai',
};

/** Peserta minimal supaya daya beda ada artinya (27% atas vs 27% bawah). */
const MIN_FOR_DISCRIMINATION = 8;

type DetailEntry = { id?: unknown; benar?: boolean | null; jawaban?: unknown };
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
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    let pending = 0;
    let blank = 0;

    for (const submission of submissions) {
      const entry = findEntry(submission, question.id);
      if (!entry) continue;
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
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  muted: 'text-slate-500',
};

function bar(percent: number, tone: 'ok' | 'warn' | 'bad' | 'key'): string {
  const color =
    tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-rose-500' : 'bg-blue-500';
  return `<div class="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden inline-block align-middle"><div class="${color} h-full" style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>`;
}

function optionBars(item: ItemStat): string {
  if (!item.options) return '';
  let answeredTotal = 0;
  for (const option of item.options) answeredTotal += option.count;
  const total = answeredTotal + item.blank;
  const rows = item.options
    .map((option) => {
      const percent = total ? Math.round((option.count / total) * 100) : 0;
      return `<div class="flex items-center gap-2 text-[11px]">
        <span class="w-5 flex-none grid place-items-center rounded bg-slate-900 border ${
          option.isKey ? 'border-emerald-500/60 text-emerald-400 font-bold' : 'border-slate-700 text-slate-400'
        }">${option.letter}</span>
        <span class="flex-1 truncate ${option.isKey ? 'text-emerald-300' : 'text-slate-400'}" title="${escapeHtml(option.text)}">${escapeHtml(option.text || '(kosong)')}</span>
        ${bar(percent, option.isKey ? 'ok' : 'key')}
        <span class="w-16 text-right flex-none text-slate-400">${option.count} siswa (${percent}%)</span>
      </div>`;
    })
    .join('');
  const blankRow = item.blank
    ? `<div class="flex items-center gap-2 text-[11px] text-slate-500"><span class="w-5 flex-none text-center">–</span><span class="flex-1">Tidak dijawab</span><span class="w-24"></span><span class="w-16 text-right flex-none">${item.blank} siswa</span></div>`
    : '';
  return `<div class="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
    <p class="text-[11px] text-slate-500">Sebaran pilihan (kunci ditandai hijau):</p>
    ${rows}${blankRow}
  </div>`;
}

function tile(label: string, value: string, hint: string, tone = 'text-white'): string {
  return `<div class="bg-slate-800 rounded-xl border border-slate-700 p-3.5">
    <p class="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">${escapeHtml(label)}</p>
    <p class="text-xl font-bold ${tone} mt-1">${value}</p>
    <p class="text-[11px] text-slate-500 mt-0.5">${hint}</p>
  </div>`;
}

export function renderItemAnalysis(analysis: ItemAnalysis): string {
  const { participants, items } = analysis;

  const tiles = `<div class="grid grid-cols-2 md:grid-cols-5 gap-3">
    ${tile('Peserta', String(participants), 'pengiriman yang dinilai')}
    ${tile('Rata-rata', String(analysis.average), `KKM ${analysis.kkm}`, 'text-amber-400')}
    ${tile('Tertinggi', String(analysis.highest), 'nilai terbaik', 'text-emerald-400')}
    ${tile('Terendah', String(analysis.lowest), 'nilai terendah', 'text-rose-400')}
    ${tile(
      'Lulus',
      `${analysis.passed}/${participants}`,
      analysis.awaiting ? `${analysis.awaiting} menunggu koreksi esai` : `${analysis.failed} belum lulus`
    )}
  </div>`;

  if (!participants) {
    return `<section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-bold text-white"><i class="fa-solid fa-chart-simple text-orange-400 mr-2"></i>Analisis Butir Soal</h2>
      </div>
      <div class="bg-slate-800/50 p-8 rounded-2xl border border-slate-800 text-center text-slate-400 text-sm">
        Belum ada jawaban siswa yang bisa dianalisis. Statistik muncul otomatis setelah siswa mengirim jawaban.
      </div>
    </section>`;
  }

  const rows = items
    .map((item) => {
      const tone = item.percentCorrect >= 70 ? 'ok' : item.percentCorrect >= 30 ? 'warn' : 'bad';
      const disc = item.discrimination === null ? '—' : item.discrimination.toFixed(2);
      const detail =
        item.type === 'essay'
          ? `<span class="text-slate-500">${item.pending} jawaban esai menunggu koreksi</span>`
          : `${item.answered} menjawab`;
      const optionsBlock = item.options ? optionBars(item) : '';
      return `<tr class="align-top hover:bg-slate-800/40 transition">
        <td class="p-3 font-mono text-slate-400">${item.no}</td>
        <td class="p-3">
          <div class="text-slate-100">${escapeHtml(item.label.slice(0, 140))}${item.label.length > 140 ? '…' : ''}</div>
          <div class="text-[11px] text-slate-500 mt-1">${TYPE_LABEL[item.type]}${item.points !== 1 ? ` · bobot ${item.points}` : ''} · ${detail}</div>
          ${
            item.options
              ? `<details class="mt-1"><summary class="text-[11px] text-blue-400 cursor-pointer">Lihat sebaran pilihan</summary>${optionsBlock}</details>`
              : ''
          }
        </td>
        <td class="p-3 text-right font-mono text-emerald-400">${item.correct}</td>
        <td class="p-3 text-right font-mono text-rose-400">${item.wrong}</td>
        <td class="p-3">
          <div class="flex items-center gap-2 justify-end">
            <span class="font-mono text-slate-200">${item.answered ? item.percentCorrect + '%' : '—'}</span>
            ${bar(item.percentCorrect, tone)}
          </div>
        </td>
        <td class="p-3 text-right">
          <span class="text-xs ${
            item.difficulty === 'Sulit' ? 'text-rose-400' : item.difficulty === 'Mudah' ? 'text-emerald-400' : 'text-slate-300'
          }">${item.difficulty}</span>
        </td>
        <td class="p-3 text-right">
          <span class="font-mono text-slate-200">${disc}</span>
          <div class="text-[11px] ${
            item.discrimination !== null && item.discrimination < 0.2 ? 'text-rose-400' : 'text-slate-500'
          }">${item.discriminationLabel}</div>
        </td>
        <td class="p-3 text-xs ${LEVEL_CLASS[item.level]}">${escapeHtml(item.note)}</td>
      </tr>`;
    })
    .join('');

  const discriminationNote = analysis.hasDiscrimination
    ? ''
    : `<p class="text-[11px] text-amber-400"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Daya beda belum bisa dihitung — butuh minimal ${MIN_FOR_DISCRIMINATION} peserta.</p>`;

  return `<section class="space-y-4">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="text-base font-bold text-white"><i class="fa-solid fa-chart-simple text-orange-400 mr-2"></i>Analisis Butir Soal</h2>
        <p class="text-xs text-slate-400 mt-0.5">Dihitung dari jawaban yang sudah masuk, tanpa perlu mengirim ulang apa pun.</p>
      </div>
      <button id="item-csv" type="button" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold">
        <i class="fa-solid fa-file-csv mr-1"></i>Unduh CSV
      </button>
    </div>

    ${tiles}

    <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs min-w-[54rem]">
          <thead class="bg-slate-900/80 text-slate-300 border-b border-slate-700 uppercase font-semibold text-[11px]">
            <tr>
              <th class="p-3 w-10">No</th>
              <th class="p-3">Soal</th>
              <th class="p-3 text-right w-16">Benar</th>
              <th class="p-3 text-right w-16">Salah</th>
              <th class="p-3 text-right w-32">% Benar</th>
              <th class="p-3 text-right w-24">Tingkat</th>
              <th class="p-3 text-right w-24">Daya Beda</th>
              <th class="p-3 w-64">Catatan</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-700">${rows}</tbody>
        </table>
      </div>
      <div class="p-3 bg-slate-900/60 border-t border-slate-700 space-y-1">
        ${discriminationNote}
        <p class="text-[11px] text-slate-500">
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
