/* ==========================================================================
 * Data aplikasi (hasil pemecahan index.ts):
 *   POST /api/save/:slug & /api/submit/:slug — simpan kiriman siswa (kuis JSON
 *        dinilai ulang di server supaya skor tidak bisa dipalsukan browser).
 *   GET  /p/:slug/data — rekap admin: riwayat kiriman, antrean esai, analisis.
 * ========================================================================== */
import type { Context, Hono } from 'hono';
import { escapeHtml, gradeSubmission, mediaBaseFor, parseQuizSpec, publicGrading } from './quiz';
import type { QuizSpec } from './quiz';
import { computeItemAnalysis, renderItemAnalysis } from './quiz-report';
import { isAuthed } from './auth';
import { noStorePage } from './admin-shared';
import { FAVICON_TAGS } from './favicon.ts';

// Bindings minimal: KV + D1 (kiriman) + SESSION_SECRET (rekap admin).
type RecordBindings = { STORAGE: KVNamespace; DB: D1Database; SESSION_SECRET?: string };
type RecordEnv = { Bindings: RecordBindings };

export function registerRecordRoutes<E extends RecordEnv>(app: Hono<E>) {
// Endpoint Universal Simpan Data (Kuis, Checklist, Form, dsb.)
// Dipakai untuk path /api/save/:slug DAN /api/submit/:slug (alias kompatibilitas)
const saveRecordHandler = async (c: Context<E>) => {
  const slug = c.req.param('slug') ?? '';
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ status: 'error', message: 'Payload JSON tidak valid' }, 400);
  }

  const id = crypto.randomUUID();
  const userId = body.user || body.name || body.student_name || 'anonim';
  // Kelas siswa (opsional): dipisah dari nama supaya rekap per kelas tidak perlu
  // menebak dari teks nama. Dibersihkan dari tipe aneh; payload lama tanpa kelas
  // tetap terbaca apa adanya.
  const studentClass = typeof body.student_class === 'string' ? body.student_class.trim().slice(0, 60) : '';

  // Kalau slug ini dibuat dari JSON soal, nilainya dihitung ulang DI SERVER
  // supaya skor tidak bisa dipalsukan dari sisi browser.
  let payload: Record<string, unknown> = body;
  let grading: Record<string, unknown> | null = null;

  const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
  if (specRaw) {
    try {
      const spec = JSON.parse(specRaw) as QuizSpec;
      const graded = gradeSubmission(spec, body.answers ?? body.responses ?? body.jawaban, mediaBaseFor(slug));
      const lulus = graded.essay_pending > 0 ? null : (graded.final_score ?? graded.score) >= spec.passingScore;

      payload = {
        ...body,
        type: 'quiz-json',
        quiz_title: spec.title,
        // Normalisasi kelas ke field payload yang pasti (body bisa saja tidak
        // mengirim student_class; kelas tetap tampil di rekap).
        student_class: studentClass,
        score: graded.score,
        points_earned: graded.points_earned,
        points_total: graded.points_total,
        full_points: graded.full_points,
        essay_pending: graded.essay_pending,
        essay_graded: graded.essay_graded,
        essay_earned: graded.essay_earned,
        essay_total: graded.essay_total,
        final_score: graded.final_score,
        passing_score: spec.passingScore,
        lulus,
        detail: graded.detail,
      };

      // Yang dikirim ke siswa HARUS lewat publicGrading(): kunci jawaban selalu
      // dibuang, dan status benar/salah + poin per butir ikut dibuang kecuali
      // guru menyalakan `show_item_feedback` di pengaturan aplikasi. Tanpa itu
      // satu kiriman cukup untuk menyalin seluruh kunci kuis lewat DevTools, dan
      // karena kuis publik boleh diulang, `benar` per soal saja sudah cukup
      // untuk menebak kunci dengan mencoba jawaban berulang. `payload` di atas
      // tetap memakai `graded.detail` apa adanya supaya rekap guru, koreksi
      // esai, dan analisis butir soal di /p/:slug/data tidak kehilangan data
      // (dan format app_records lama tidak berubah).
      grading = {
        score: graded.score,
        points_earned: graded.points_earned,
        points_total: graded.points_total,
        full_points: graded.full_points,
        essay_pending: graded.essay_pending,
        essay_graded: graded.essay_graded,
        essay_earned: graded.essay_earned,
        essay_total: graded.essay_total,
        final_score: graded.final_score,
        passing_score: spec.passingScore,
        lulus,
        detail: publicGrading(graded, { itemFeedback: spec.showItemFeedback }).detail,
      };
    } catch {
      // Spec tidak terbaca: jawaban tetap disimpan apa adanya seperti perilaku lama.
    }
  }

  await c.env.DB.prepare(`
    INSERT INTO app_records (id, app_slug, user_id, payload_json, student_class)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, slug, userId, JSON.stringify(payload), studentClass || null).run();

  return c.json({
    status: 'success',
    message: 'Data berhasil disimpan ke sistem',
    id,
    timestamp: new Date().toISOString(),
    grading,
  });
};

app.post('/api/save/:slug', saveRecordHandler);
app.post('/api/submit/:slug', saveRecordHandler);

// ==========================================
// 2. HALAMAN REKAP DATA PER APLIKASI (ADMIN)
// ==========================================
app.get('/p/:slug/data', async (c) => {
  if (!(await isAuthed(c))) {
    return c.redirect('/');
  }

  const slug = c.req.param('slug');
  const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
  const meta = metaRaw ? (JSON.parse(metaRaw) as { title?: string }) : { title: slug };
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM app_records WHERE app_slug = ? ORDER BY created_at DESC
  `).bind(slug).all();

  // Antrean esai yang belum dikoreksi (dipakai untuk pengingat di halaman ini).
  let essayQueue = 0;
  for (const row of results as any[]) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (typeof parsed?.essay_pending === 'number' && parsed.essay_pending > 0) essayQueue += 1;
    } catch {
      // Baris rusak: lewati saja, tidak boleh bikin halaman rekap ikut gagal.
    }
  }

  // Analisis butir soal dihitung dari `detail` penilaian yang tersimpan bersama
  // jawaban siswa — jadi tidak perlu ada data tambahan dari browser siswa.
  let analysisHtml = '';
  const quizSpecRaw = await c.env.STORAGE.get(`quiz:${slug}`);
  let quizSpec: QuizSpec | null = null;
  try {
    quizSpec = quizSpecRaw ? parseQuizSpec(quizSpecRaw) : null;
  } catch {
    quizSpec = null;
  }
  const quizHasEssay = quizSpec ? quizSpec.questions.some((question) => question.type === 'essay') : false;
  const essayCallout = quizSpec
    ? essayQueue > 0
      ? `<a href="/p/${slug}/essay" class="callout warn">
      <i class="fa-solid fa-pen-to-square ico"></i>
      <div class="body">
        <p class="main">${essayQueue} kiriman punya jawaban esai yang belum dikoreksi</p>
        <p class="sub">Nilai akhir baru dihitung setelah semua esai di satu kiriman selesai dinilai.</p>
      </div>
      <span class="go">Koreksi Sekarang</span>
    </a>`
      : quizHasEssay
        ? `<a href="/p/${slug}/essay" class="inline-link">Koreksi jawaban esai &rarr;</a>`
        : ''
    : '';

  if (quizSpecRaw && results.length) {
    try {
      const payloads = results.map((row: any) => {
        try {
          return JSON.parse(row.payload_json);
        } catch {
          return null;
        }
      });
      analysisHtml = renderItemAnalysis(computeItemAnalysis(quizSpec as QuizSpec, payloads));
    } catch {
      analysisHtml = '';
    }
  }

  // Rekap memuat seluruh jawaban kelas — jangan sampai tertahan di cache
  // browser setelah guru logout (mis. laptop dipakai bersama di kelas).
  noStorePage(c);

  return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rekap Data - /p/${slug}</title>
  ${FAVICON_TAGS}
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
    .hidden{display:none!important}
    .topbar{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .topbar-inner{max-width:960px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
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
    main{max-width:960px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}
    .callout{display:flex;align-items:center;gap:12px;border-radius:var(--radius-sm);padding:12px 14px;font-size:12px}
    .callout .ico{font-size:16px;flex:none}
    .callout .body{flex:1;min-width:0}
    .callout .main{font-weight:600;margin:0}
    .callout .sub{margin:2px 0 0;opacity:.75}
    .callout .go{flex:none;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap;transition:opacity .15s}
    .callout.warn{background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--warn)}
    .callout.warn .go{background:var(--warn)}
    .callout.warn:hover .go{opacity:.85}
    .inline-link{display:inline-block;font-size:12.5px;color:var(--accent)}
    .inline-link:hover{text-decoration:underline}

    /* ===== Analisis butir soal (dihasilkan quiz-report.ts) ===== */
    .r-section{display:flex;flex-direction:column;gap:14px}
    .r-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .r-title{font-size:14px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}
    .r-sub{font-size:12px;color:var(--text-secondary);margin:2px 0 0}
    .r-empty{padding:28px;text-align:center;font-size:12px;color:var(--text-faint);background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius)}
    .r-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
    .tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow)}
    .tile-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;color:var(--text-faint);margin:0}
    .tile-value{font-size:20px;font-weight:700;margin:4px 0 0}
    .tile-hint{font-size:11px;color:var(--text-faint);margin:4px 0 0}
    .tone-ok{color:var(--ok)!important}
    .tone-warn{color:var(--warn)!important}
    .tone-bad{color:var(--danger)!important}
    .tone-muted{color:var(--text-secondary)!important}
    .table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
    .table-scroll{overflow-x:auto}
    .r-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
    .r-head-row{background:var(--surface-2);text-align:left}
    .r-head-row th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;color:var(--text-secondary);padding:10px 14px;border-bottom:1px solid var(--border);white-space:nowrap}
    .r-head-row .right,.r-num{text-align:right}
    .r-body tr{border-bottom:1px solid var(--border)}
    .r-body tr:last-child{border-bottom:none}
    .r-body tr:hover{background:var(--surface-2)}
    .r-cell{padding:11px 14px;vertical-align:top;font-size:12.5px}
    .r-no{font-family:'Geist Mono',ui-monospace,monospace;color:var(--text-faint);white-space:nowrap}
    .r-nowrap{white-space:nowrap}
    .r-id{font-weight:600}
    .r-q{font-weight:500;line-height:1.5}
    .r-mono{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px}
    .r-pct{display:flex;align-items:center;justify-content:flex-end;gap:8px}
    .bar{flex:none;width:88px;height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden}
    .bar-fill{height:100%;border-radius:999px}
    .fill-ok{background:var(--ok)}
    .fill-warn{background:var(--warn)}
    .fill-bad{background:var(--danger)}
    .fill-key{background:var(--accent)}
    .r-details{margin-top:6px}
    .r-summary{cursor:pointer;font-size:12px;color:var(--accent)}
    .r-summary:hover{text-decoration:underline}
    .opt-box{margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
    .opt-cap{font-size:10.5px;color:var(--text-faint);margin:0 0 6px}
    .opt-row{display:flex;align-items:center;gap:8px;font-size:11px;padding:2px 0}
    .opt-letter{width:20px;height:20px;flex:none;display:grid;place-items:center;border-radius:6px;background:var(--bg);border:1px solid var(--border);color:var(--text-secondary);font-weight:600;font-size:10.5px}
    .opt-letter.key{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
    .opt-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)}
    .opt-text.key{color:var(--ok)}
    .opt-count{flex:none;text-align:right;color:var(--text-secondary)}
    .r-foot{padding:12px 14px;background:var(--surface-2);border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
    .r-footnote{font-size:11px;color:var(--text-faint);margin:0}
    .r-note{font-size:11px;min-width:160px}
    .r-json{margin:8px 0 0;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-word;line-height:1.6;max-width:480px}
    .empty-state{padding:40px 20px;text-align:center;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius);display:flex;flex-direction:column;align-items:center;gap:6px}
    .empty-ico{width:44px;height:44px;border-radius:12px;background:var(--surface-2);color:var(--accent);display:grid;place-items:center;font-size:16px}
    .empty-main{font-weight:600;margin:6px 0 0;font-size:13px}
    .empty-sub{margin:0;font-size:12px;color:var(--text-faint)}

    @media(max-width:640px){.topbar-actions .btn{font-size:0}.topbar-actions .btn i{margin:0;font-size:13px}}
  </style>
</head>
<body>

  <nav class="topbar">
    <div class="topbar-inner">
      <div class="topbar-left">
        <a class="brand" href="/" title="Kembali ke Dashboard">SQ</a>
        <div class="min-w-0">
          <a href="/" class="back"><i class="fa-solid fa-arrow-left"></i>Dashboard</a>
          <h1>Log Data: ${escapeHtml(meta.title ?? slug)}</h1>
          <div class="sub">/p/${slug} &bull; ${results.length} rekaman</div>
        </div>
      </div>
      <div class="topbar-actions">
        <a href="/p/${slug}" target="_blank" class="btn btn-accent"><i class="fa-solid fa-eye"></i>Buka Aplikasi</a>
      </div>
    </div>
  </nav>

  <main>
    ${essayCallout}
    ${analysisHtml}

    ${results.length === 0 ? `
      <div class="empty-state">
        <div class="empty-ico"><i class="fa-solid fa-inbox"></i></div>
        <p class="empty-main">Belum ada data yang masuk</p>
        <p class="empty-sub">Jawaban dan respons siswa akan tampil di sini setelah mereka mengirim formulir.</p>
      </div>
    ` : `
      <section class="r-section">
        <div class="r-head">
          <div>
            <h2 class="r-title">Riwayat Kiriman</h2>
            <p class="r-sub">${results.length} rekaman terakhir, terbaru di bawah.</p>
          </div>
        </div>
        <div class="table-wrap">
          <div class="table-scroll">
            <table class="r-table">
              <thead class="r-head-row">
                <tr>
                  <th>Waktu</th>
                  <th>Identitas Pengguna</th>
                  <th>Ringkasan / Skor</th>
                  <th>Detail Payload</th>
                </tr>
              </thead>
              <tbody class="r-body">
                ${results.map((r: any) => {
                  const payload = JSON.parse(r.payload_json);
                  const summary = payload.summary ? JSON.stringify(payload.summary) : (payload.score !== undefined ? `Skor: ${payload.score}` : '-');
                  // Kelas tampil di belakang identitas (payload baru); kiriman
                  // lama tanpa student_class tetap tampil tanpa label kelas.
                  const identitas = payload.student_class
                    ? `${escapeHtml(r.user_id)}<span class="tone-muted"> · ${escapeHtml(payload.student_class)}</span>`
                    : escapeHtml(r.user_id);
                  return `
                  <tr class="r-row">
                    <td class="r-cell r-nowrap tone-muted">${escapeHtml(r.created_at)}</td>
                    <td class="r-cell r-id">${identitas}</td>
                    <td class="r-cell r-num tone-ok">${escapeHtml(summary)}</td>
                    <td class="r-cell">
                      <details class="r-details">
                        <summary class="r-summary">Lihat JSON</summary>
                        <pre class="r-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
                      </details>
                    </td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `}
  </main>
</body>
</html>`);
});
}
