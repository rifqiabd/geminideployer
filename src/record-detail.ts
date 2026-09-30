/* ==========================================================================
 * Popup detail kiriman siswa (dipakai halaman rekap /p/:slug/data).
 * --------------------------------------------------------------------------
 * Dipisah dari registrar supaya bisa diuji tanpa Worker, dan supaya
 * renderer ini tidak terikat ke satu halaman: bentuk payload-nya sama dengan
 * yang dipakai halaman koreksi esai.
 *
 * Aturan escaping yang tidak boleh dilanggar di file ini:
 *   - `question_html` dan `pembahasan` konten GURU yang sudah di-render server
 *     (src/quiz-grade.ts), jadi aman dimasak lewat innerHTML.
 *   - Semua teks yang berasal dari SISWA wajib escapeHtml: jawaban, isi
 *     pernyataan, nama, kelas, dan apa pun dari payload app non-kuis.
 *     Menyimpang dari aturan ini berarti XSS dari kiriman siswa.
 * ========================================================================== */
import { escapeHtml, formatRecordStamp, HLJS_BASE, KATEX_BASE } from './quiz.ts';
import type { GradedDetail, GradedStatement } from './quiz.ts';

/* Bentuk payload yang dibaca popup ini. Sama dengan payload yang ditulis
 * saveRecordHandler (src/records.ts), jadi satu tipe untuk halaman rekap dan
 * halaman koreksi esai — tidak ada dua definisi yang bisa melenceng. */
export type RecordPayload = {
  student_name?: string;
  student_class?: string;
  quiz_title?: string;
  type?: string;
  score?: number;
  points_earned?: number;
  points_total?: number;
  full_points?: number;
  essay_pending?: number;
  essay_graded?: number;
  essay_earned?: number;
  essay_total?: number;
  essay_scores?: Record<string, number>;
  final_score?: number | null;
  passing_score?: number;
  lulus?: boolean | null;
  detail?: GradedDetail[];
  summary?: unknown;
  answers?: unknown;
};

/* Field yang bukan data siswa dan tidak perlu ditampilkan di fallback
 * non-kuis: `detail` sudah dirender rapi di atas, `type` cuma penanda internal,
 * dan `answers` mentah ditampilkan terpisah sebagai JSON. */
const INTERNAL_FIELDS = new Set(['detail', 'type', 'answers']);

/* --------------------------------------------------------------------------
 * Ringkasan
 * ----------------------------------------------------------------------- */

/** Satu baris ringkasan nilai. Dipakai halaman koreksi esai dan sel tabel
 * rekap supaya tidak ada dua format ringkasan yang berbeda. */
export function summaryLine(payload: RecordPayload): string {
  const parts = [`Nilai objektif: ${payload.score ?? '-'}`];
  parts.push(
    payload.final_score === null || payload.final_score === undefined
      ? 'Nilai akhir: menunggu semua esai dikoreksi'
      : `Nilai akhir: ${payload.final_score}`
  );
  if (payload.essay_total) parts.push(`Poin esai: ${payload.essay_earned ?? 0}/${payload.essay_total}`);
  if (payload.lulus === true) parts.push('LULUS');
  else if (payload.lulus === false) parts.push('BELUM LULUS');
  return parts.join(' · ');
}

/** Bentuk nilai dari payload `summary` milik app non-kuis. `summary` dibuat
 * oleh app itu sendiri, jadi bentuknya bebas: string, angka, atau objek. */
function summarizeRawSummary(summary: unknown): string {
  if (typeof summary === 'string') return summary.trim();
  if (typeof summary === 'number' || typeof summary === 'boolean') return String(summary);
  if (summary && typeof summary === 'object') {
    return Object.entries(summary as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join(' · ');
  }
  return '';
}

/** Sel "Ringkasan / Skor" di tabel rekap. Ringkas supaya baris tetap rapi;
 * rinciannya ada di popup, bukan di tabel. */
export function renderSummaryCell(payload: RecordPayload): string {
  const raw = summarizeRawSummary(payload.summary);
  const isQuiz = payload.type === 'quiz-json' || payload.detail !== undefined || payload.score !== undefined;

  if (isQuiz) {
    const nilai = payload.final_score ?? payload.score;
    const parts: string[] = [];
    if (nilai !== undefined && nilai !== null) parts.push(`<strong class="r-score">${escapeHtml(String(nilai))}</strong>`);
    if (payload.lulus === true) parts.push('<span class="rd-chip ok">Lulus</span>');
    else if (payload.lulus === false) parts.push('<span class="rd-chip bad">Belum</span>');
    else if (payload.essay_pending) parts.push('<span class="rd-chip wait">Tunggu esai</span>');
    if (parts.length) return `<span class="r-sum">${parts.join('')}</span>`;
  }
  if (raw) return `<span class="r-sum">${escapeHtml(raw)}</span>`;
  return '<span class="tone-faint">-</span>';
}

/* --------------------------------------------------------------------------
 * Isi popup
 * ----------------------------------------------------------------------- */

function fmtPoin(nilai: unknown, maks: unknown): string {
  const n = Number(nilai);
  const m = Number(maks);
  const show = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '-');
  return Number.isFinite(m) ? `${show(n)} / ${show(m)}` : show(n);
}

function renderStatus(item: GradedDetail): string {
  // `benar === null` berarti esai yang belum dinilai — bukan jawaban salah.
  if (item.benar === null) return '<span class="rd-chip wait">Menunggu koreksi</span>';
  if (item.benar) return '<span class="rd-chip ok">Benar</span>';
  const parsial = item.poin > 0;
  return parsial
    ? `<span class="rd-chip partial">Sebagian · +${escapeHtml(String(Math.round(item.poin * 100) / 100))}</span>`
    : '<span class="rd-chip bad">Salah</span>';
}

function renderStatementRow(statement: GradedStatement): string {
  // Teks pernyataan dan jawaban siswa: wajib escape.
  return `<tr>
        <td class="rd-st-text">${escapeHtml(statement.text)}</td>
        <td class="rd-st-a">${escapeHtml(statement.jawaban || '(kosong)')}</td>
        <td class="rd-key"><span class="rd-key-tag">Kunci</span>${escapeHtml(statement.kunci || '-')}</td>
        <td class="rd-st-s">${statement.benar ? '<span class="rd-dot ok"></span>' : '<span class="rd-dot bad"></span>'}</td>
      </tr>`;
}

function renderStatements(item: GradedDetail): string {
  if (!item.statements || !item.statements.length) return '';
  const label = item.row_label || 'Pernyataan';
  return `<table class="rd-table">
          <thead><tr>
            <th>${escapeHtml(label)}</th>
            <th>Jawabanmu</th>
            <th class="rd-key">Kunci</th>
            <th class="rd-st-s"></th>
          </tr></thead>
          <tbody>${item.statements.map((row) => renderStatementRow(row)).join('')}</tbody>
        </table>`;
}

function renderItem(item: GradedDetail): string {
  const tipe = typeof item.type === 'string' ? item.type : '';
  return `<article class="rd-item">
        <header class="rd-item-head">
          <span class="rd-no">${escapeHtml(String(item.no ?? '-'))}</span>
          <span class="rd-item-meta">
            ${tipe ? `<span class="rd-chip soft">${escapeHtml(tipe)}</span>` : ''}
            <span class="rd-points">Poin <strong>${escapeHtml(fmtPoin(item.poin, item.poin_maks))}</strong></span>
          </span>
          ${renderStatus(item)}
        </header>
        <div class="rd-q">${item.question_html || ''}</div>
        <div class="rd-answer">
          <span class="rd-label">Jawabanmu</span>
          <span class="rd-answer-text">${escapeHtml(item.jawaban || '(kosong)')}</span>
        </div>
        ${
          item.kunci
            ? `<div class="rd-key"><span class="rd-label">Kunci</span><span class="rd-answer-text">${escapeHtml(item.kunci)}</span></div>`
            : ''
        }
        ${renderStatements(item)}
        ${item.pembahasan ? `<details class="rd-expl"><summary>Pembahasan</summary><div class="rd-expl-body">${item.pembahasan}</div></details>` : ''}
      </article>`;
}

/* Fallback untuk app non-kuis (checklist, form, dan kiriman lama yang tidak
 * punya `detail`). Isinya bisa apa saja, jadi semua dibaca sebagai key-value
 * dan nilainya selalu di-escape. */
function renderFieldList(payload: RecordPayload): string {
  const rows = Object.entries(payload as Record<string, unknown>)
    .filter(([key]) => !INTERNAL_FIELDS.has(key))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const tampil = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `<div class="rd-field">
            <span class="rd-field-key">${escapeHtml(key)}</span>
            <span class="rd-field-val">${escapeHtml(tampil)}</span>
          </div>`;
    });
  if (!rows.length) return '<p class="rd-note">Kiriman ini tidak menyimpan field apa pun.</p>';
  return `<div class="rd-fields">${rows.join('')}</div>`;
}

function renderScoreStrip(payload: RecordPayload): string {
  const tiles: { label: string; value: string; hint?: string }[] = [];
  if (payload.score !== undefined) tiles.push({ label: 'Nilai objektif', value: String(payload.score) });
  if (payload.points_total) {
    tiles.push({
      label: 'Poin objektif',
      value: `${payload.points_earned ?? 0} / ${payload.points_total}`,
    });
  }
  if (payload.full_points && payload.full_points !== payload.points_total) {
    tiles.push({ label: 'Total dengan esai', value: String(payload.full_points) });
  }
  if (payload.essay_total) {
    tiles.push({ label: 'Poin esai', value: `${payload.essay_earned ?? 0} / ${payload.essay_total}` });
  }
  if (payload.passing_score !== undefined) tiles.push({ label: 'KKM', value: String(payload.passing_score) });

  const badge =
    payload.lulus === true
      ? '<span class="rd-chip ok big">Lulus</span>'
      : payload.lulus === false
        ? '<span class="rd-chip bad big">Belum lulus</span>'
        : payload.essay_pending
          ? '<span class="rd-chip wait big">Menunggu koreksi esai</span>'
          : '';

  if (!tiles.length && !badge) return '';
  return `<div class="rd-strip">
        ${tiles
          .map(
            (tile) =>
              `<div class="rd-tile"><span class="rd-tile-label">${escapeHtml(tile.label)}</span><span class="rd-tile-value">${escapeHtml(tile.value)}</span></div>`
          )
          .join('')}
        ${badge}
      </div>`;
}

export type RecordDetailInput = {
  id: string;
  userId: string;
  createdAt: string;
  payload: RecordPayload | null;
};

/**
 * Isi dialog untuk satu kiriman. `payload: null` berarti `payload_json` tidak
 * bisa dibaca — itu kondisi data rusak, harus tetap tampil sebagai pesan, bukan
 * membuat halaman rekap ikut gagal.
 */
export function renderRecordDetail(input: RecordDetailInput): string {
  const { id, userId, createdAt, payload } = input;

  if (!payload) {
    return `<div class="rd-broken">
        <p class="rd-broken-main"><i class="fa-solid fa-triangle-exclamation"></i> Data kiriman ini tidak bisa dibaca</p>
        <p class="rd-note">Baris di D1 ada, tapi isinya bukan JSON yang valid. Kiriman sudah tersimpan tapi tidak bisa diurai untuk ditampilkan.</p>
        <div class="rd-field"><span class="rd-field-key">id rekaman</span><span class="rd-field-val">${escapeHtml(id)}</span></div>
      </div>`;
  }

  const nama = payload.student_name || userId;
  const kelas = payload.student_class ? `<span class="rd-chip soft">${escapeHtml(payload.student_class)}</span>` : '';
  const detail = Array.isArray(payload.detail) ? payload.detail : null;

  const isi = detail
    ? `<div class="rd-items">${detail.map((item) => renderItem(item)).join('')}</div>`
    : `<p class="rd-note">Kiriman ini bukan hasil kuis JSON, jadi rincian per soal tidak ada. Isi payload ditampilkan apa adanya di bawah.</p>
       ${renderFieldList(payload)}`;

  return `<div class="rd-idcard">
        <div class="rd-idcard-main">
          <p class="rd-name">${escapeHtml(nama)}</p>
          <p class="rd-meta">${kelas}<span class="rd-meta-sep">·</span>${escapeHtml(formatRecordStamp(createdAt))}<span class="rd-meta-sep">·</span><span class="rd-mono">${escapeHtml(id)}</span></p>
        </div>
      </div>
      ${renderScoreStrip(payload)}
      ${isi}
      <details class="rd-raw">
        <summary>JSON mentah (untuk menelusuri)</summary>
        <pre class="rd-pre">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      </details>`;
}

/* --------------------------------------------------------------------------
 * Cangkang dialog
 * ----------------------------------------------------------------------- */

/** Markup dialog. Isinya diisi dari client setelah fetch satu rekaman, supaya
 * halaman rekap tidak lagi membawa JSON tiap kiriman. */
export function renderRecordDialog(): string {
  return `<dialog class="rd-dialog" id="rd-dialog" aria-label="Detail jawaban siswa">
        <header class="rd-dialog-head">
          <h2 class="rd-dialog-title">Detail Jawaban</h2>
          <label class="rd-toggle">
            <input type="checkbox" id="rd-keys">
            <span>Tampilkan kunci</span>
          </label>
          <button type="button" class="rd-close" id="rd-close" aria-label="Tutup detail"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="rd-body" id="rd-body"></div>
      </dialog>`;
}

/* Aset math/code dimuat malas saat dialog pertama dibuka, bukan di head: halaman
 * rekap tidak perlu KaTeX kalau guru tidak pernah membuka satu kiriman pun. */
export const RECORD_DIALOG_ASSETS = {
  mathCss: `${KATEX_BASE}/katex.min.css`,
  mathJs: `${KATEX_BASE}/katex.min.js`,
  mathRender: `${KATEX_BASE}/contrib/auto-render.min.js`,
  codeCss: `${HLJS_BASE}/styles/github-dark.min.css`,
  codeJs: `${HLJS_BASE}/highlight.min.js`,
};

/** Blob JSON untuk skrip klien. `public/vendor/record-detail.js` tidak bisa
 * mengimpor modul TS, jadi URL-nya dikirim lewat blok ini. `<` di-escape
 * supaya string tidak mungkin menutup tag script lebih awal, walau URL saat
 * ini memang tidak mengandung karakter itu. */
export function renderRecordAssetsScript(): string {
  const json = JSON.stringify(RECORD_DIALOG_ASSETS).replace(/</g, '\\u003c');
  return `<script type="application/json" id="rd-assets">${json}</script>`;
}

/** CSS dialog, disuntik ke blok <style> halaman rekap. Dipisah dari markup
 * supaya aturan "kunci tersembunyi secara default" bisa diuji sebagai teks.
 */
export const RECORD_DIALOG_CSS = `
    .rd-dialog{width:min(880px,calc(100vw - 32px));max-width:none;max-height:90vh;padding:0;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);box-shadow:var(--shadow-lg);overflow:hidden}
    .rd-dialog::backdrop{background:rgba(0,0,0,.45);backdrop-filter:blur(2px)}
    .rd-dialog[open]{display:flex;flex-direction:column}
    .rd-dialog-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--surface);flex:none}
    .rd-dialog-title{font-size:14px;font-weight:600;margin:0;flex:1;min-width:0}
    .rd-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;user-select:none;white-space:nowrap}
    .rd-close{border:1px solid var(--border);background:var(--bg);color:var(--text-secondary);border-radius:8px;width:30px;height:30px;display:grid;place-items:center;flex:none;transition:background .15s,color .15s}
    .rd-close:hover{background:var(--surface-2);color:var(--text)}
    .rd-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}

    .rd-loading{padding:32px;text-align:center;font-size:12.5px;color:var(--text-faint)}
    .rd-error{padding:14px;border-radius:var(--radius-sm);background:var(--danger-soft);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);color:var(--danger);font-size:12.5px}
    .rd-note{font-size:12px;color:var(--text-secondary);margin:0}

    .rd-idcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
    .rd-name{font-size:15px;font-weight:700;margin:0}
    .rd-meta{font-size:11.5px;color:var(--text-secondary);margin:3px 0 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .rd-meta-sep{color:var(--text-faint)}
    .rd-mono{font-family:'Geist Mono',ui-monospace,monospace}

    .rd-strip{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
    .rd-tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;min-width:104px}
    .rd-tile-label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;color:var(--text-faint)}
    .rd-tile-value{display:block;font-size:16px;font-weight:700;margin-top:2px}

    .rd-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
    .rd-chip.big{font-size:12px;padding:6px 12px;align-self:center}
    .rd-chip.ok{background:var(--ok-soft);color:var(--ok)}
    .rd-chip.bad{background:var(--danger-soft);color:var(--danger)}
    .rd-chip.wait{background:var(--warn-soft);color:var(--warn)}
    .rd-chip.partial{background:var(--accent-soft);color:var(--accent)}
    .rd-chip.soft{background:var(--surface-2);color:var(--text-secondary);font-weight:500}

    .rd-items{display:flex;flex-direction:column;gap:12px}
    .rd-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:13px 15px;display:flex;flex-direction:column;gap:9px}
    .rd-item-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .rd-no{width:24px;height:24px;flex:none;display:grid;place-items:center;border-radius:7px;background:var(--accent);color:#fff;font-size:11.5px;font-weight:700}
    .rd-item-meta{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-secondary)}
    .rd-points{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--text-faint)}
    .rd-q{font-size:13px;line-height:1.6;color:var(--text)}
    .rd-q img{max-width:100%;height:auto}
    .rd-answer,.rd-key{display:flex;gap:8px;align-items:baseline;font-size:12.5px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 11px}
    .rd-label{flex:none;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--text-faint)}
    .rd-answer-text{color:var(--text);word-break:break-word;white-space:pre-wrap;min-width:0}
    .rd-key .rd-answer-text{color:var(--ok);font-weight:600}

    /* Kunci disembunyikan sampai guru menyalakan toggle. Ini bukan batas
       keamanan: payload yang dikirim ke guru memang sudah memuat kunci
       (kunci hanya dibuang di respons siswa lewat publicGrading). Toggle ini
       soal kerapatan tampilan, bukan soal melindungi data. */
    .rd-key{display:none}
    .rd-dialog.show-keys .rd-key{display:flex}
    .rd-dialog.show-keys .rd-key.st-key{display:table-cell}
    .rd-table .rd-key{display:none}
    .rd-dialog.show-keys .rd-table .rd-key{display:table-cell}
    .rd-key-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--text-faint);margin-right:5px}

    .rd-table{width:100%;border-collapse:collapse;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg)}
    .rd-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;color:var(--text-secondary);padding:7px 10px;background:var(--surface-2);border-bottom:1px solid var(--border)}
    .rd-table td{padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top}
    .rd-table tr:last-child td{border-bottom:none}
    .rd-st-a{color:var(--text);font-weight:600}
    .rd-st-s{width:26px;text-align:center}
    .rd-dot{display:inline-block;width:8px;height:8px;border-radius:999px}
    .rd-dot.ok{background:var(--ok)}
    .rd-dot.bad{background:var(--danger)}

    .rd-expl{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
    .rd-expl summary{cursor:pointer;padding:8px 11px;font-size:12px;font-weight:600;color:var(--text-secondary)}
    .rd-expl summary:hover{color:var(--text)}
    .rd-expl-body{padding:0 11px 10px;font-size:12.5px;line-height:1.6;border-top:1px solid var(--border);padding-top:9px}

    .rd-fields{display:flex;flex-direction:column;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
    .rd-field{display:flex;gap:10px;padding:8px 11px;background:var(--surface);font-size:12.5px}
    .rd-field-key{flex:none;width:160px;color:var(--text-faint);font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;word-break:break-word}
    .rd-field-val{flex:1;min-width:0;color:var(--text);word-break:break-word;white-space:pre-wrap}
    .rd-broken{background:var(--danger-soft);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);border-radius:var(--radius);padding:14px;color:var(--danger)}
    .rd-broken-main{font-weight:600;margin:0 0 6px;font-size:13px}
    .rd-raw{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
    .rd-raw summary{cursor:pointer;padding:8px 11px;font-size:12px;font-weight:600;color:var(--text-secondary)}
    .rd-raw summary:hover{color:var(--text)}
    .rd-pre{margin:0;padding:11px;border-top:1px solid var(--border);background:var(--bg);border-radius:0 0 var(--radius-sm) var(--radius-sm);font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;line-height:1.6;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow-y:auto}

    .r-score{font-family:'Geist Mono',ui-monospace,monospace;font-size:15px;font-weight:700}
    .r-sum{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:320px}
`;
