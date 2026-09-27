/* ==========================================================================
 * Koreksi jawaban esai dari halaman rekap data.
 * --------------------------------------------------------------------------
 * Soal esai tidak bisa dinilai otomatis, tapi nilai objektifnya juga belum
 * lengkap sebelum esainya diberi nilai. Karena itu:
 *   - nilai objektif tetap ditampilkan apa adanya,
 *   - nilai AKHIR baru dihitung setelah semua esai di satu kiriman dinilai,
 *     supaya nilai siswa tidak turun sepihak saat esainya belum selesai dikoreksi.
 *
 * Poin esai disimpan di payload kiriman (`essay_scores`) lalu penilaian
 * dihitung ulang dengan gradeSubmission() yang sama seperti saat siswa mengirim,
 * jadi tidak ada rumus ganda yang bisa berbeda hasilnya.
 * ========================================================================== */

import type { Hono } from 'hono';
import { isAuthed, safeSlug } from './auth';
import { escapeHtml, gradeSubmission, mediaBaseFor, parseQuizSpec } from './quiz';
import type { GradeResult, GradedDetail, QuizSpec } from './quiz';
import type { MediaBindings } from './media';

type EssayBindings = MediaBindings & { DB: D1Database };

type StoredPayload = {
  score?: number;
  final_score?: number | null;
  lulus?: boolean | null;
  essay_pending?: number;
  essay_earned?: number;
  essay_total?: number;
  essay_scores?: Record<string, number>;
  answers?: unknown;
  detail?: GradedDetail[];
};

export function registerEssayGradingRoutes<E extends { Bindings: EssayBindings }>(app: Hono<E>) {
  /* ------------------------------------------------------------------ */
  /* Halaman koreksi                                                     */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/essay', async (c) => {
    if (!isAuthed(c)) return c.redirect('/');

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    if (!metaRaw) return c.html(messagePage('Aplikasi tidak ditemukan', `Tidak ada aplikasi di /p/${slug}.`), 404);

    const meta = JSON.parse(metaRaw) as { title?: string; type?: string };
    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (meta.type !== 'json' || !specRaw) {
      return c.html(
        messagePage('Hanya untuk aplikasi mode "JSON Soal"', 'Aplikasi lama yang dibuat dari kode HTML tidak punya daftar soal yang bisa dikoreksi di sini.'),
        400
      );
    }

    let spec: QuizSpec;
    try {
      spec = parseQuizSpec(specRaw);
    } catch (error) {
      return c.html(messagePage('Soal kuis tidak terbaca', String(error)), 400);
    }
    if (!spec.questions.some((question) => question.type === 'essay')) {
      return c.html(messagePage('Tidak ada soal esai', 'Kuis ini seluruhnya dinilai otomatis, jadi tidak ada yang perlu dikoreksi manual.'), 400);
    }

    const showAll = c.req.query('show') === 'all';
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM app_records WHERE app_slug = ? ORDER BY created_at ASC'
    )
      .bind(slug)
      .all();

    const entries = (results as Array<Record<string, unknown>>)
      .map((row) => {
        let payload: StoredPayload;
        try {
          payload = JSON.parse(String(row.payload_json)) as StoredPayload;
        } catch {
          return null;
        }
        const essays = (payload.detail ?? []).filter((detail) => detail && detail.type === 'essay');
        if (!essays.length) return null;
        return {
          id: String(row.id),
          name: String(row.user_id ?? 'anonim'),
          createdAt: String(row.created_at ?? ''),
          payload,
          essays,
          pending: typeof payload.essay_pending === 'number' ? payload.essay_pending : essays.length,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const pendingEntries = entries.filter((entry) => entry.pending > 0);
    const visible = showAll ? entries : pendingEntries;

    const cards = visible
      .map((entry) => {
        const scores = entry.payload.essay_scores ?? {};
        const essaysHtml = entry.essays
          .map((essay) => {
            const max = essay.poin_maks || 1;
            const saved = typeof scores[essay.id] === 'number' ? scores[essay.id] : null;
            return `
        <div class="e-box" data-qid="${escapeHtml(essay.id)}" data-max="${max}">
          <div class="e-q">${essay.question_html || ''}</div>
          <p class="e-cap">Jawaban siswa:</p>
          <div class="e-answer">${escapeHtml(essay.jawaban || '(kosong)')}</div>
          <div class="e-score-row">
            <label class="e-lbl">Nilai</label>
            <input type="number" min="0" max="${max}" step="0.5" value="${saved === null ? '' : saved}" class="js-score e-score" data-max="${max}">
            <span class="e-from">dari ${max} poin</span>
            <button type="button" class="btn e-full js-full">Nilai penuh</button>
            <span class="js-qstatus e-qstatus ${saved === null ? 'tone-muted' : 'tone-ok'}">${saved === null ? 'Belum dinilai' : 'Sudah dinilai'}</span>
          </div>
        </div>`;
          })
          .join('');

        return `
      <article class="e-card" data-record="${escapeHtml(entry.id)}" data-slug="${escapeHtml(slug)}">
        <div class="e-card-head">
          <div>
            <h3 class="e-name">${escapeHtml(entry.name)}</h3>
            <p class="e-time">${escapeHtml(entry.createdAt)}</p>
            <p class="js-summary e-summary">${escapeHtml(summaryLine(entry.payload))}</p>
          </div>
          <span class="js-badge e-badge ${
            entry.pending > 0 ? 'warn' : 'ok'
          }">${entry.pending > 0 ? `${entry.pending} esai belum dinilai` : 'Sudah dikoreksi'}</span>
        </div>
        ${essaysHtml}
        <div class="e-save-row">
          <button type="button" class="btn btn-accent js-save"><i class="fa-solid fa-floppy-disk"></i>Simpan Koreksi</button>
          <span class="js-status e-status"></span>
        </div>
      </article>`;
      })
      .join('');

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Koreksi Esai - ${escapeHtml(meta.title ?? slug)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%237c3aed'/%3E%3Ctext x='32' y='43' font-family='Arial' font-size='32' font-weight='bold' text-anchor='middle' fill='white'%3ESQ%3C/text%3E%3C/svg%3E">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geistmono-variable.woff2') format('woff2')}
    :root{
      --bg:#ffffff;--surface:#f9f9f9;--surface-2:#f0f0f0;
      --border:#e5e5e5;--text:#171717;--text-secondary:#737373;--text-faint:#a3a3a3;
      --accent:#7c3aed;--accent-hover:#6d28d9;--accent-soft:rgba(124,58,237,.08);
      --danger:#ef4444;--danger-soft:rgba(239,68,68,.08);--ok:#16a34a;--ok-soft:rgba(22,163,74,.1);--warn:#d97706;--warn-soft:rgba(217,119,6,.1);
      --radius:14px;--radius-sm:10px;--shadow:0 1px 3px rgba(0,0,0,.06);--shadow-lg:0 8px 32px rgba(0,0,0,.1);
    }
    @media(prefers-color-scheme:dark){
      :root{
        --bg:#212121;--surface:#303030;--surface-2:#3a3a3a;
        --border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--text-faint:#6b6b6b;
        --accent:#8b5cf6;--accent-hover:#a78bfa;--accent-soft:rgba(139,92,246,.12);
        --danger:#f87171;--danger-soft:rgba(248,113,113,.12);--ok:#4ade80;--ok-soft:rgba(74,222,128,.12);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.12);
        --shadow:0 1px 3px rgba(0,0,0,.25);--shadow-lg:0 8px 32px rgba(0,0,0,.4);
      }
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;padding-bottom:32px}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit;cursor:pointer}
    input,textarea,select,button{font-family:inherit;color:var(--text)}
    .tone-ok{color:var(--ok)!important}
    .tone-warn{color:var(--warn)!important}
    .tone-bad{color:var(--danger)!important}
    .tone-muted{color:var(--text-secondary)!important}
    .topbar{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .topbar-inner{max-width:820px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .topbar-left{min-width:0;display:flex;align-items:center;gap:12px}
    .brand{width:34px;height:34px;flex:none;border-radius:10px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px}
    .back{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-secondary);padding:5px 10px;border-radius:8px;transition:background .15s,color .15s}
    .back:hover{background:var(--surface-2);color:var(--text)}
    .topbar h1{font-size:14px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar .sub{font-size:11px;font-family:'Geist Mono',ui-monospace,monospace;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-actions{display:flex;align-items:center;gap:8px;flex:none}
    .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}
    .btn:hover{background:var(--surface-2)}
    .btn-accent{background:var(--accent);border-color:transparent;color:#fff}
    .btn-accent:hover{background:var(--accent-hover)}
    main{max-width:820px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}
    .tabs{display:flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:4px;width:fit-content;max-width:100%}
    .tab{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--text-secondary);border-radius:7px;padding:6px 12px;font-size:12.5px;font-weight:500;white-space:nowrap;transition:background .15s,color .15s}
    a.tab{text-decoration:none}
    .tab:hover{color:var(--text)}
    .tab.active{background:var(--bg);color:var(--text);box-shadow:var(--shadow)}
    .help-card{background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:var(--radius-sm);padding:12px 14px;font-size:12px;color:var(--text-secondary);line-height:1.6}
    .help-card b{color:var(--text)}
    .e-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px}
    .e-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .e-name{margin:0;font-size:14px;font-weight:600}
    .e-time{font-size:11px;color:var(--text-faint);margin:2px 0 0}
    .e-summary{margin:6px 0 0;font-size:11px;color:var(--text-secondary)}
    .e-badge{font-size:10.5px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid;white-space:nowrap}
    .e-badge.warn{color:var(--warn);background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 30%,transparent)}
    .e-badge.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
    .e-box{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;display:flex;flex-direction:column;gap:6px}
    .e-q{font-size:13px;line-height:1.6}
    .e-cap{margin:2px 0 0;font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em}
    .e-answer{font-size:13px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;line-height:1.6}
    .e-score-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
    .e-lbl{font-size:11.5px;color:var(--text-secondary)}
    .e-score{width:74px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;outline:none;transition:border-color .15s}
    .e-score:focus{border-color:var(--accent)}
    .e-from{font-size:11px;color:var(--text-faint)}
    .e-full{padding:5px 10px;font-size:11px}
    .e-qstatus{font-size:11px;font-weight:500}
    .e-save-row{display:flex;align-items:center;gap:10px;padding-top:2px}
    .e-status{font-size:11px;color:var(--text-faint)}
    .empty-card{padding:40px 20px;text-align:center;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius);font-size:12.5px;color:var(--text-faint)}
    @media(max-width:640px){.topbar-actions .btn{font-size:0}.topbar-actions .btn i{margin:0;font-size:13px}}
  </style>
</head>
<body>

  <nav class="topbar">
    <div class="topbar-inner">
      <div class="topbar-left">
        <a class="brand" href="/" title="Kembali ke Dashboard">SQ</a>
        <div class="min-w-0">
          <a href="/p/${escapeHtml(slug)}/data" class="back"><i class="fa-solid fa-arrow-left"></i>Rekap Data</a>
          <h1>Koreksi Jawaban Esai</h1>
          <div class="sub">${escapeHtml(meta.title ?? slug)} &bull; /p/${escapeHtml(slug)}</div>
        </div>
      </div>
      <div class="topbar-actions">
        <a href="/p/${escapeHtml(slug)}/edit" class="btn"><i class="fa-solid fa-pen-to-square"></i>Edit Soal</a>
        <a href="/p/${escapeHtml(slug)}" target="_blank" class="btn btn-accent"><i class="fa-solid fa-eye"></i>Lihat Kuis</a>
      </div>
    </div>
  </nav>

  <main>
    <div class="tabs" role="tablist">
      <a href="/p/${escapeHtml(slug)}/essay" class="tab ${showAll ? '' : 'active'}"><i class="fa-solid fa-clock"></i>Belum dikoreksi (${pendingEntries.length})</a>
      <a href="/p/${escapeHtml(slug)}/essay?show=all" class="tab ${showAll ? 'active' : ''}"><i class="fa-solid fa-list"></i>Semua kiriman (${entries.length})</a>
    </div>

    <div class="help-card">
      <b><i class="fa-solid fa-circle-info" style="margin-right:6px;color:var(--accent)"></i>Cara penilaian esai</b><br>
      Isi poin 0 sampai poin maksimal tiap soal, lalu simpan. Nilai objektif selalu ditampilkan; <b>nilai akhir</b>
      (objektif + esai) baru dihitung setelah semua esai di satu kiriman selesai dinilai, supaya nilai siswa tidak
      turun sepihak selama esainya masih menunggu. Mengosongkan kolom nilai berarti soal itu dianggap belum dikoreksi.
    </div>

    ${cards || `<div class="empty-card">
        ${showAll ? 'Belum ada kiriman siswa yang punya jawaban esai.' : 'Semua jawaban esai sudah dikoreksi. Tidak ada antrean.'}
      </div>`}
  </main>

  <script src="/vendor/quiz-essay.js"></script>
</body>
</html>`);
  });

  /* ------------------------------------------------------------------ */
  /* Simpan nilai esai                                                   */
  /* ------------------------------------------------------------------ */
  app.post('/api/quiz/:slug/essay', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; scores?: Record<string, unknown> } | null;
    const recordId = String(body?.id ?? '').trim();
    if (!recordId) return c.json({ status: 'error', message: 'Kiriman siswa tidak dikenal.' }, 400);

    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (!specRaw) return c.json({ status: 'error', message: 'Soal kuis tidak ditemukan.' }, 404);

    let spec: QuizSpec;
    try {
      spec = parseQuizSpec(specRaw);
    } catch (error) {
      return c.json({ status: 'error', message: `Soal kuis tidak terbaca: ${String(error)}` }, 400);
    }

    const row = await c.env.DB.prepare('SELECT * FROM app_records WHERE id = ? AND app_slug = ?')
      .bind(recordId, slug)
      .first();
    if (!row) return c.json({ status: 'error', message: 'Kiriman siswa tidak ditemukan.' }, 404);

    let payload: StoredPayload;
    try {
      payload = JSON.parse(String(row.payload_json)) as StoredPayload;
    } catch {
      return c.json({ status: 'error', message: 'Data jawaban rusak dan tidak bisa dibaca.' }, 400);
    }

    // Tanpa jawaban aslinya, penilaian ulang cuma akan menghasilkan nilai nol
    // dan menimpa data lama — jadi tolak daripada merusak rekap.
    if (payload.answers === undefined) {
      return c.json({ status: 'error', message: 'Kiriman ini tidak menyimpan jawaban siswa, jadi tidak bisa dinilai ulang.' }, 400);
    }

    // Hanya soal esai milik kuis ini yang boleh dinilai dari sini.
    const essayIds = new Set(spec.questions.filter((question) => question.type === 'essay').map((question) => question.id));
    const merged: Record<string, number> = { ...(payload.essay_scores ?? {}) };
    for (const [key, value] of Object.entries(body?.scores ?? {})) {
      if (!essayIds.has(key)) continue;
      const text = String(value).trim();
      if (text === '') {
        delete merged[key]; // dikosongkan = batal dikoreksi
        continue;
      }
      const number = Number(text);
      if (Number.isFinite(number)) merged[key] = number;
    }

    const graded: GradeResult = gradeSubmission(spec, payload.answers, mediaBaseFor(slug), merged);
    const lulus = graded.essay_pending > 0 ? null : (graded.final_score ?? graded.score) >= spec.passingScore;

    const updated: StoredPayload & Record<string, unknown> = {
      ...payload,
      essay_scores: merged,
      score: graded.score,
      points_earned: graded.points_earned,
      points_total: graded.points_total,
      full_points: graded.full_points,
      essay_pending: graded.essay_pending,
      essay_graded: graded.essay_graded,
      essay_earned: graded.essay_earned,
      essay_total: graded.essay_total,
      final_score: graded.final_score,
      lulus,
      detail: graded.detail,
      corrected_at: new Date().toISOString(),
    };

    await c.env.DB.prepare('UPDATE app_records SET payload_json = ? WHERE id = ? AND app_slug = ?')
      .bind(JSON.stringify(updated), recordId, slug)
      .run();

    return c.json({
      status: 'success',
      message: 'Koreksi tersimpan.',
      summary: summaryLine(updated),
      essay_pending: graded.essay_pending,
      score: graded.score,
      final_score: graded.final_score,
      lulus,
    });
  });
}

/** Satu baris ringkas yang dipakai halaman maupun balasan API (biar selalu sama). */
function summaryLine(payload: StoredPayload): string {
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

function messagePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%237c3aed'/%3E%3Ctext x='32' y='43' font-family='Arial' font-size='32' font-weight='bold' text-anchor='middle' fill='white'%3ESQ%3C/text%3E%3C/svg%3E">
<style>
  @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
  :root{--bg:#ffffff;--surface:#f9f9f9;--border:#e5e5e5;--text:#171717;--text-secondary:#737373;--accent:#7c3aed;--danger:#ef4444}
  @media(prefers-color-scheme:dark){:root{--bg:#212121;--surface:#303030;--border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--accent:#8b5cf6;--danger:#f87171}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;min-height:100vh;display:grid;place-items:center;padding:24px;-webkit-font-smoothing:antialiased}
  a{text-decoration:none}
  .card{max-width:440px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.08)}
  h1{font-size:15px;font-weight:600;color:var(--danger);margin:0 0 8px}
  p{font-size:13px;color:var(--text-secondary);margin:0;line-height:1.6}
  .btn{display:inline-block;margin-top:20px;padding:8px 16px;background:var(--accent);color:#fff;border-radius:10px;font-size:12.5px;font-weight:500}
</style></head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/" class="btn">Kembali ke Dashboard</a>
  </div>
</body></html>`;
}
