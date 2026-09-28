import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { QuizError, escapeHtml, gradeSubmission, mediaBaseFor, parseQuizJson, parseQuizSpec, parseStamp, randomSlugSuffix, relTime, renderPrintSheet, renderQuizApp, stampNow } from './quiz';
import type { QuizSpec } from './quiz';
import { registerMediaRoutes, withMediaStats } from './media-routes';
import { registerQuizEditorRoutes } from './quiz-editor';
import { computeItemAnalysis, renderItemAnalysis } from './quiz-report';
import { registerEssayGradingRoutes } from './quiz-essay';
import { deleteAllMedia, moveAllMedia } from './media';
import { registerGuideRoute, GEM_URL } from './guide';
import { registerTkaStudioRoutes } from './tka-studio';
import { safeSlug } from './auth';

type Bindings = {
  STORAGE: KVNamespace;
  DB: D1Database;
  // Opsional: bucket R2 untuk gambar hasil unggahan guru. Kalau binding ini
  // tidak dipasang, gambarnya otomatis disimpan di KV (STORAGE) — tetap jalan.
  MEDIA?: R2Bucket;
  // Opsional: API generate gambar AI (proxy free-image-generation-api di atas
  // Cloudflare Workers AI). Kalau keduanya diisi, panel Gambar dapat tombol
  // "Generate AI" untuk membuat gambar slot langsung dari prompt.
  IMGGEN_API_URL?: string;
  IMGGEN_API_KEY?: string;
  // Opsional: master password login dashboard. Kalau kosong, fallback
  // FALLBACK_PASSWORD di bawah. Wajib diganti sebelum produksi!
  APP_PASSWORD?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
// Master password login dashboard (fallback kalau env APP_PASSWORD kosong).
const FALLBACK_PASSWORD = 'admin123';

// Aktifkan CORS agar endpoint save aman diakses
app.use('/api/*', cors());

// Unggah/sajikan gambar soal + panel guru di /p/:slug/media
registerMediaRoutes(app);

// Editor soal guru di /p/:slug/edit (khusus aplikasi mode "JSON Soal")
registerQuizEditorRoutes(app);

// Koreksi jawaban esai di /p/:slug/essay
registerEssayGradingRoutes(app);

// Panduan penggunaan di /panduan
registerGuideRoute(app);

// TKA Prompt Engine di /studio (generator prompt asesmen/TKA + kelola mapel)
registerTkaStudioRoutes(app);

// Helper: Format slug URL
function sanitizeSlug(str: string): string {
  const slug = str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `app-${Date.now()}`;
}

/**
 * Cari alamat yang belum dipakai untuk aplikasi baru.
 *
 * Publish memakai slug yang sama persis dengan judul yang diketik guru, jadi
 * mengulang publish dengan judul yang sama tadinya menimpa aplikasi lama —
 * termasuk soal dan jawaban siswa yang sudah masuk. Sekarang slug yang sudah
 * dipakai diberi sufiks acak (`-a1b2`) sehingga tiap publish selalu jadi aplikasi
 * baru dan versi lama tetap bisa dibuka.
 *
 * Keberadaan dicek lewat `meta:` karena itu kunci yang selalu ditulis untuk
 * setiap aplikasi, sama seperti pengecekan bentrok di `/api/app/update`. Enam
 * percobaan dengan 31^4 kombinasi praktis tidak mungkin habis; kalau tetap
 * habis, jatuh ke cap waktu base36 yang juga belum pernah dipakai.
 */
async function uniqueSlug(env: Bindings, base: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base}-${randomSlugSuffix()}`;
    const taken = await env.STORAGE.get(`meta:${candidate}`);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Helper: Halaman error yang bisa dibaca guru (bukan teks polos)
function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen grid place-items-center p-6 font-sans">
  <div class="max-w-lg w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl">
    <h1 class="text-base font-bold text-rose-400 mb-2">${title}</h1>
    <p class="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">${escapeHtml(message)}</p>
    <a href="/" class="inline-block mt-5 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl text-xs font-semibold">Kembali ke Dashboard</a>
  </div>
</body>
</html>`;
}

// Helper: Simpan HTML aplikasi + metadatanya ke KV
async function saveApp(env: Bindings, entry: { title: string; slug: string; type: string; html: string }) {
  // Baca metadata lama dulu supaya `created_at` tidak hilang kalau aplikasi yang
  // sama di-publish ulang. Tanpa ini, tanggal dibuat ikut melompat ke hari ini
  // setiap kali kuis di-replace, dan urutan sidebar jadi tidak jujur.
  let prev: Record<string, unknown> | null = null;
  try {
    const raw = await env.STORAGE.get(`meta:${entry.slug}`);
    if (raw) prev = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    prev = null;
  }

  await env.STORAGE.put(`html:${entry.slug}`, entry.html);
  await env.STORAGE.put(
    `meta:${entry.slug}`,
    JSON.stringify({
      ...prev,
      title: entry.title,
      slug: entry.slug,
      type: entry.type,
      created_at: prev?.created_at ?? stampNow(),
      updated_at: stampNow(),
      size: (new TextEncoder().encode(entry.html).length / 1024).toFixed(1) + ' KB',
    })
  );
}

// ==========================================
// 1. ENDPOINT APLIKASI PUBLIK
// ==========================================

// Buka Aplikasi Berdasarkan Slug
app.get('/p/:slug', async (c) => {
  const slug = c.req.param('slug');

  // Mode cetak (Print to PDF) khusus kuis JSON: `?print=1` (+ `&kunci=1`).
  // Aplikasi lama yang dulu dipublish sebagai HTML/React tidak punya spec
  // terstruktur, jadi permintaan cetakinya dilewati dan halamannya tampil biasa.
  if (c.req.query('print') === '1') {
    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (specRaw) {
      try {
        const spec = JSON.parse(specRaw) as QuizSpec;
        return c.html(
          renderPrintSheet(spec, slug, {
            showKunci: c.req.query('kunci') === '1',
            layout: c.req.query('layout') === '2col' ? '2col' : '1col',
            auto: c.req.query('auto') === '1',
          })
        );
      } catch {
        // Spec tidak valid — jatuh ke penyajian halaman biasa di bawah.
      }
    }
  }

  const html = await c.env.STORAGE.get(`html:${slug}`);

  if (!html) {
    return c.text('Aplikasi tidak ditemukan!', 404);
  }

  return c.html(html);
});

// Endpoint Universal Simpan Data (Kuis, Checklist, Form, dsb.)
// Dipakai untuk path /api/save/:slug DAN /api/submit/:slug (alias kompatibilitas)
const saveRecordHandler = async (c: Context<{ Bindings: Bindings }>) => {
  const slug = c.req.param('slug') ?? '';
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ status: 'error', message: 'Payload JSON tidak valid' }, 400);
  }

  const id = crypto.randomUUID();
  const userId = body.user || body.name || body.student_name || 'anonim';

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
        detail: graded.detail,
      };
    } catch {
      // Spec tidak terbaca: jawaban tetap disimpan apa adanya seperti perilaku lama.
    }
  }

  await c.env.DB.prepare(`
    INSERT INTO app_records (id, app_slug, user_id, payload_json)
    VALUES (?, ?, ?, ?)
  `).bind(id, slug, userId, JSON.stringify(payload)).run();

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
  if (getCookie(c, 'auth_session') !== 'authenticated_user') {
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

  return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rekap Data - /p/${slug}</title>
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
                  return `
                  <tr class="r-row">
                    <td class="r-cell r-nowrap tone-muted">${escapeHtml(r.created_at)}</td>
                    <td class="r-cell r-id">${escapeHtml(r.user_id)}</td>
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

// ==========================================
// 3. AUTHENTICATION & DASHBOARD ADMIN
// ==========================================
app.post('/api/login', async (c) => {
  const body = await c.req.parseBody();
  const expected = c.env.APP_PASSWORD || FALLBACK_PASSWORD;
  if (body.password === expected) {
    setCookie(c, 'auth_session', 'authenticated_user', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return c.redirect('/');
  }
  return c.html(errorPage('Password salah', 'Master password yang dimasukkan tidak cocok. Coba lagi dari halaman depan.'), 401);
});

app.get('/api/logout', (c) => {
  deleteCookie(c, 'auth_session', { path: '/' });
  return c.redirect('/');
});

app.get('/', async (c) => {
  const isAuth = getCookie(c, 'auth_session') === 'authenticated_user';

  let projects: any[] = [];
  if (isAuth) {
    const list = await c.env.STORAGE.list({ prefix: 'meta:' });
    for (const key of list.keys) {
      const val = await c.env.STORAGE.get(key.name);
      if (val) projects.push(await withMediaStats(c.env, JSON.parse(val)));
    }
    // Urutan sidebar mengikuti tanggal dibuat, terbaru dulu. Sebelumnya hanya
    // `reverse()` atas urutan leksikografis KV, jadi urutannya Z->A berdasarkan
    // slug dan sama sekali tidak mencerminkan tanggal. `sort` di JS stabil,
    // sehingga aplikasi yang `created_at`-nya sama tetap urutnya seperti biasa.
    projects.sort((a, b) => parseStamp(b.created_at) - parseStamp(a.created_at));
  }

  const appData: Record<string, any> = {};
  if (isAuth) {
    for (const p of projects) {
      let preview = '';
      if (p.type === 'json') {
        preview = (await c.env.STORAGE.get(`quizsource:${p.slug}`)) || '';
      } else {
        const html = await c.env.STORAGE.get(`html:${p.slug}`);
        preview = html ? html.slice(0, 1500) : '';
      }
      appData[p.slug] = {
        title: p.title,
        type: p.type,
        slug: p.slug,
        date: relTime(p.created_at),
        size: p.size,
        mediaMissing: p.media_missing || 0,
        mediaTotal: p.media_slots || 0,
        preview,
      };
    }
  }
  // Sidebar tidak lagi menampilkan tanggal secara permanen, jadi keterangan
  // kapan aplikasi dibuat dan kapan terakhir diubah harus tetap tersedia lewat
  // tooltip pada barisnya. Kuis lama belum punya `updated_at`, jadi bagian
  // "Diubah ..." hanya ditulis kalau `relTime` benar-benar menghasilkan teks.
  const modTitle = (p: { created_at?: unknown; updated_at?: unknown }): string => {
    const created = relTime(p.created_at);
    const mod = relTime(p.updated_at);
    const parts: string[] = [];
    if (created) parts.push(`Dibuat ${created}`);
    if (mod) parts.push(`Diubah ${mod}`);
    if (!parts.length) return '';
    return ` title="${escapeHtml(parts.join(' · '))}"`;
  };

  const appDataJson = JSON.stringify(appData).replace(/</g, '\\u003c');

return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Edge Deployer - SMK Thibbil Qulub Assimbani</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-text-size-adjust:100%}
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geistmono-variable.woff2') format('woff2')}
    :root{
      --bg:#ffffff;--surface:#f9f9f9;--surface-2:#f0f0f0;--sidebar-bg:#f9f9f9;
      --border:#e5e5e5;--text:#171717;--text-secondary:#737373;--text-faint:#a3a3a3;
      --accent:#7c3aed;--accent-hover:#6d28d9;--accent-soft:rgba(124,58,237,.08);
      --danger:#ef4444;--danger-soft:rgba(239,68,68,.08);--warn:#d97706;
      --radius:14px;--radius-sm:10px;--sidebar-width:260px;
      --shadow:0 2px 8px rgba(0,0,0,.06);--shadow-lg:0 8px 32px rgba(0,0,0,.1);
    }
    @media(prefers-color-scheme:dark){
      :root{
        --bg:#212121;--surface:#303030;--surface-2:#3a3a3a;--sidebar-bg:#171717;
        --border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--text-faint:#6b6b6b;
        --accent:#8b5cf6;--accent-hover:#a78bfa;--accent-soft:rgba(139,92,246,.12);
        --danger:#f87171;--danger-soft:rgba(248,113,113,.12);--warn:#fbbf24;
        --shadow:0 2px 8px rgba(0,0,0,.2);--shadow-lg:0 8px 32px rgba(0,0,0,.4);
      }
    }
    body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow:hidden;height:100vh}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit}
    .app-layout{display:flex;height:100vh;overflow:hidden}

    /* ========== SIDEBAR ========== */
    .sidebar{width:var(--sidebar-width);flex-shrink:0;background:var(--sidebar-bg);border-right:1px solid var(--border);display:flex;flex-direction:column;transition:transform .25s ease;z-index:50}
    .sidebar-header{padding:12px;display:flex;align-items:center;gap:8px}
    .sidebar-brand{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background .15s}
    .sidebar-brand:hover{background:var(--surface-2)}
    .sidebar-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px}
    .sidebar-title{font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sidebar-toggle{width:32px;height:32px;border:none;background:none;color:var(--text-secondary);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex:none}
    .sidebar-toggle:hover{background:var(--surface-2);color:var(--text)}

    .sidebar-new{padding:0 12px 8px}
    .btn-new-deploy{width:100%;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s}
    .btn-new-deploy:hover{background:var(--surface-2);border-color:var(--text-faint)}
    .btn-new-deploy svg{flex:none;color:var(--text-secondary)}

    .sidebar-search{padding:0 12px 10px}
    .search-box{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);transition:border-color .15s,box-shadow .15s}
    .search-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
    .search-box svg{flex:none;color:var(--text-faint);width:14px;height:14px}
    .search-box input{flex:1;border:none;outline:none;background:none;color:var(--text);font-size:13px;font-family:inherit;min-width:0}
    .search-box input::placeholder{color:var(--text-faint)}

    .sidebar-divider{height:1px;background:var(--border);margin:0 12px}
    .sidebar-label{font-size:11px;font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;padding:10px 22px 6px}

    .sidebar-list{flex:1;overflow-y:auto;padding:0 8px}
    .sidebar-list::-webkit-scrollbar{width:4px}
    .sidebar-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

    .sidebar-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:background .15s;position:relative}
    .sidebar-item:hover{background:var(--surface-2)}
    .sidebar-item.active{background:var(--accent-soft);color:var(--accent)}
    .sidebar-item-icon{color:var(--text-secondary);flex:none;display:flex}
    .sidebar-item.active .sidebar-item-icon{color:var(--accent)}
    .sidebar-item-text{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sidebar-item-time{font-size:11px;color:var(--text-faint);flex:none;white-space:nowrap;display:none}
    .sidebar-item-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:none;gap:2px}
    .sidebar-item:hover .sidebar-item-actions{display:flex}
    /* Tanggal dibuat disembunyikan permanen supaya daftar aplikasi tetap rapat,
       lalu muncul lagi saat hover. Nilai 62px menyisakan ruang untuk dua tombol
       aksi (26px + celah 2px) yang juga muncul saat hover, jadi tanggal tidak
       tertutup tombol. */
    .sidebar-item:hover .sidebar-item-time{display:inline;margin-right:62px}
    .sidebar-item-btn{width:26px;height:26px;border:none;background:var(--surface);color:var(--text-secondary);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
    .sidebar-item-btn:hover{background:var(--surface-2);color:var(--text)}
    .sidebar-item-btn.danger:hover{color:var(--danger)}

    .sidebar-footer{padding:12px;border-top:1px solid var(--border)}
    .sidebar-footer-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;background:none;color:var(--text-secondary);border-radius:var(--radius-sm);cursor:pointer;font-size:13px;font-family:inherit;transition:background .15s,color .15s}
    .sidebar-footer-btn:hover{background:var(--surface-2);color:var(--text)}

    .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:45}

    /* ========== MAIN ========== */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .main-topbar{display:flex;padding:10px 16px;align-items:center;gap:12px;border-bottom:1px solid var(--border);flex:none}
    .hamburger{width:36px;height:36px;border:none;background:none;color:var(--text);border-radius:8px;cursor:pointer;display:none;align-items:center;justify-content:center}
    .hamburger:hover{background:var(--surface-2)}
    .topbar-brand{display:flex;align-items:center;gap:10px;min-width:0}
    .topbar-logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center;flex:none;font-size:15px;font-weight:700}
    .topbar-brand-text{display:flex;flex-direction:column;min-width:0}
    .topbar-title{font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-sub{font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
    .btn-ghost{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:500;padding:6px 12px;cursor:pointer;white-space:nowrap;font-family:inherit;background:var(--surface);color:var(--text);transition:background .15s,border-color .15s}
    .btn-ghost:hover{background:var(--surface-2);border-color:var(--text-faint)}
    .btn-primary{display:inline-flex;align-items:center;gap:7px;border:none;border-radius:8px;font-size:13px;font-weight:500;padding:6px 14px;cursor:pointer;white-space:nowrap;font-family:inherit;background:var(--accent);color:#fff;transition:background .15s}
    .btn-primary:hover{background:var(--accent-hover)}

    .main-content{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;overflow-y:auto}

    /* ========== EMPTY STATE ========== */
    .empty-state{text-align:center;max-width:680px;width:100%}
    .empty-greeting{font-size:28px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px;color:var(--text)}
    .empty-sub{font-size:14px;color:var(--text-secondary);margin-bottom:24px}

    /* ========== DEPLOY CHAT BOX (docked) ========== */
    .chat-box{text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px;transition:border-color .15s,box-shadow .15s}
    .chat-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
    .chat-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}
    .chat-head-icon{width:32px;height:32px;border-radius:9px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;flex:none}
    .chat-title{font-size:15px;font-weight:600;letter-spacing:-.01em}
    .chat-sub{font-size:12px;color:var(--text-secondary);margin-top:1px}

    .form-row{margin-bottom:14px}
    .form-row:last-child{margin-bottom:0}
    .form-label{display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px}
    .form-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;transition:border-color .15s}
    .form-input:focus{border-color:var(--accent)}
    .form-input.code{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;min-height:120px;resize:vertical}

    .form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    .btn-cancel{padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:inherit;transition:background .15s}
    .btn-cancel:hover{background:var(--surface-2)}
    .btn-deploy{padding:8px 20px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s}
    .btn-deploy:hover{background:var(--accent-hover)}

    /* ========== APP DETAIL VIEW ========== */
    .detail-view{display:none;width:100%;max-width:640px}
    .detail-view.active{display:block}
    .detail-header{margin-bottom:24px}
    .detail-title{font-size:24px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
    .detail-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-secondary);flex-wrap:wrap}
    .detail-meta-item{display:flex;align-items:center;gap:5px}
    .detail-meta-item svg{flex:none;color:var(--text-faint)}
    .detail-chip{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:2px 8px}
    .detail-warn{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.25);border-radius:var(--radius-sm);font-size:12px;color:var(--warn);margin-bottom:20px}
    .detail-warn svg{flex:none}
    .detail-actions{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:24px}
    .detail-action{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-secondary);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s,color .15s;text-decoration:none}
    .detail-action:hover{background:var(--surface-2);border-color:var(--text-faint);color:var(--text)}
    .detail-action-icon{width:40px;height:40px;border-radius:10px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);transition:background .15s,color .15s}
    .detail-action:hover .detail-action-icon{background:var(--accent-soft);color:var(--accent)}
    .detail-action.danger{color:var(--danger)}
    .detail-action.danger:hover{background:var(--danger-soft);border-color:rgba(239,68,68,.3);color:var(--danger)}
    .detail-action.danger:hover .detail-action-icon{background:var(--danger-soft);color:var(--danger)}
    .detail-actions form{margin:0;display:contents}

    .detail-section-label{font-size:11px;font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
    .detail-preview{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
    .detail-preview-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)}
    .detail-preview-title{font-size:12px;font-weight:600;color:var(--text-secondary)}
    .detail-preview-toggle{font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;font-family:inherit;font-weight:500}
    .detail-preview-toggle:hover{text-decoration:underline}
    .detail-preview-code{padding:14px;overflow-x:auto;max-height:300px;overflow-y:auto;font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.65;color:var(--text-secondary);white-space:pre}
    .detail-preview-code::-webkit-scrollbar{width:4px;height:4px}
    .detail-preview-code::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

    .detail-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer;background:none;border:none;font-family:inherit;margin-bottom:16px;padding:6px 10px;border-radius:8px;transition:background .15s,color .15s}
    .detail-back:hover{background:var(--surface-2);color:var(--text)}

    /* ========== AUTH ========== */
    .auth-wrap{max-width:360px;width:100%;text-align:center}
    .auth-icon{width:42px;height:42px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
    .auth-title{font-size:17px;font-weight:600;letter-spacing:-.01em}
    .auth-sub{font-size:12.5px;color:var(--text-secondary);margin-top:4px;margin-bottom:18px}
    .auth-form{text-align:left}
    .auth-form .field{margin-bottom:14px}
    .auth-form .field>label{display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}
    .auth-form .btn-deploy{width:100%;padding:10px 14px;margin-top:4px}

    /* ========== PRINT MODAL ========== */
    .modal{position:fixed;inset:0;z-index:100;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:16px}
    .modal-card{width:100%;max-width:400px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);padding:22px}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .modal-title{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--text)}
    .modal-close{background:none;border:none;color:var(--text-faint);cursor:pointer;padding:5px;border-radius:7px;display:flex}
    .modal-close:hover{color:var(--text);background:var(--surface-2)}
    .opt-group{margin-bottom:16px}
    .opt-cap{font-size:11.5px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}
    .opt-label{display:flex;align-items:center;gap:9px;font-size:13.5px;margin:9px 0;cursor:pointer;color:var(--text-secondary)}
    .opt-label input{width:15px;height:15px;margin:0;accent-color:var(--accent)}
    .modal-actions{display:flex;gap:10px;margin-top:20px}
    .modal-actions .btn{flex:1;justify-content:center}
    .seg{display:inline-flex;align-items:center;gap:2px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:3px}
    .seg-cols{background:transparent;border:none;border-radius:7px;padding:6px 14px;font-size:12.5px;font-weight:500;color:var(--text-secondary);cursor:pointer;font-family:inherit;transition:background .15s,color .15s}
    .seg-cols:hover{color:var(--text)}
    .seg-on{background:var(--bg);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.09)}
    .hidden{display:none!important}
    .flex{display:flex}

    /* ========== RESPONSIVE ========== */
    @media(max-width:1023px){
      .sidebar{position:fixed;top:0;left:0;height:100%;transform:translateX(-100%)}
      .sidebar.open{transform:translateX(0)}
      .sidebar-overlay.open{display:block}
      .app-layout{flex-direction:column}
      .hamburger{display:flex}
    }
    @media(max-width:480px){
      .empty-greeting{font-size:22px}
      .detail-actions{grid-template-columns:repeat(2,1fr)}
      .topbar-sub{display:none}
    }
    @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  </style>
</head>
<body>
  ${!isAuth ? `
  <div class="app-layout">
    <div class="main" style="align-items:center;justify-content:center;padding:24px">
      <div class="auth-wrap">
        <div class="auth-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 class="auth-title">Login Diperlukan</h2>
        <p class="auth-sub">Masukkan master password untuk mengelola aplikasi.</p>
        <form method="POST" action="/api/login" class="auth-form">
          <div class="field">
            <label for="master-pw">Master Password</label>
            <input id="master-pw" class="form-input" type="password" name="password" required placeholder="••••••••" autocomplete="current-password">
          </div>
          <button type="submit" class="btn-deploy">Masuk</button>
        </form>
      </div>
    </div>
  </div>
  ` : `
  <div class="app-layout">
    <!-- ===== SIDEBAR ===== -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a class="sidebar-brand" href="/">
          <span class="sidebar-logo">SQ</span>
          <span class="sidebar-title">Gemini Edge Deployer</span>
        </a>
        <button class="sidebar-toggle" onclick="toggleSidebar()" title="Toggle sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
        </button>
      </div>

      <div class="sidebar-new">
        <button class="btn-new-deploy" onclick="showEmptyState();">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Deploy Baru
        </button>
      </div>

      <div class="sidebar-search">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Cari aplikasi..." oninput="filterApps(this.value)">
        </div>
      </div>

      <div class="sidebar-divider"></div>
      <div class="sidebar-label">Aplikasi</div>

      <div class="sidebar-list" id="appList">
        ${projects.map((p) => `
        <div class="sidebar-item" data-slug="${p.slug}" onclick="showDetail(this,'${p.slug}')"${modTitle(p)}>
          <span class="sidebar-item-icon">
            ${p.type === 'json'
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'}
          </span>
          <span class="sidebar-item-text">${p.title}</span>
          <span class="sidebar-item-time">${relTime(p.created_at)}</span>
          <div class="sidebar-item-actions">
            <button class="sidebar-item-btn" title="Buka" onclick="event.stopPropagation(); window.open('/p/${p.slug}','_blank')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            <form method="POST" action="/api/delete" onsubmit="event.stopPropagation(); return confirm('Hapus aplikasi ini?')">
              <input type="hidden" name="slug" value="${p.slug}">
              <button class="sidebar-item-btn danger" title="Hapus" onclick="event.stopPropagation()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </form>
          </div>
        </div>`).join('')}
      </div>

      <div class="sidebar-footer">
        <a href="${GEM_URL}" target="_blank" rel="noopener" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>
          Gem Gemini
        </a>
        <a href="/studio" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1z"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>
          Prompt Engine
        </a>
        <a href="/panduan" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>
          Panduan
        </a>
        <a href="/api/logout" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Keluar
        </a>
      </div>
    </aside>

    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>

    <!-- ===== MAIN ===== -->
    <div class="main">
      <div class="main-topbar">
        <button class="hamburger" onclick="toggleSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div class="topbar-brand">
          <span class="topbar-logo">SQ</span>
          <span class="topbar-brand-text">
            <span class="topbar-title">SMK Thibbil Qulub Assimbani</span>
            <span class="topbar-sub">Pengembangan Perangkat Lunak dan Gim</span>
          </span>
        </div>
        <div class="topbar-actions">
          <span class="detail-chip" style="display:${projects.length ? 'inline-block' : 'none'}">${projects.length} Aplikasi</span>
        </div>
      </div>

      <!-- VIEW: Empty State -->
      <div class="main-content" id="viewEmpty">
        <div class="empty-state" style="margin:auto">
          <h1 class="empty-greeting">Dari mana kita harus mulai?</h1>
          <p class="empty-sub">Tempel output Gemini, lalu publikan ke URL langsung.</p>

          <!-- Chat input box (docked, bukan popup) -->
          <div class="chat-box" id="deployBox" style="text-align:left">
            <div class="chat-head">
              <span class="chat-head-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              </span>
              <div>
                <div class="chat-title" id="deployTitle">Deploy JSON Soal</div>
                <div class="chat-sub" id="deploySub">Tempel daftar soal dalam format JSON.</div>
              </div>
            </div>
            <form method="POST" action="/api/deploy">
              <div class="form-row">
                <label class="form-label" for="deployTitleInput">Judul Aplikasi <span style="color:var(--text-faint);font-weight:400">(jadi alamat /p/...)</span></label>
                <input class="form-input" id="deployTitleInput" type="text" name="title" placeholder="Contoh: Kuis Akidah Akhlak Kelas 1">
              </div>
              <div class="form-row">
                <label class="form-label" for="deployCode">JSON Soal</label>
                <textarea class="form-input code" id="deployCode" name="code_content" rows="7" placeholder="Tempel JSON soal dari Gem di sini..." required></textarea>
              </div>
              <div class="form-actions">
                <button type="button" class="btn-cancel" onclick="resetForm()">Batal</button>
                <button type="submit" class="btn-deploy" id="deployBtn">Publikasikan ke URL</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- VIEW: App Detail -->
      <div class="main-content" id="viewDetail" style="justify-content:flex-start;padding-top:32px;display:none">
        <div class="detail-view active">
          <button class="detail-back" onclick="showEmptyState()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Kembali
          </button>

          <div class="detail-header">
            <h2 class="detail-title" id="detailTitle"></h2>
            <div class="detail-meta">
              <span class="detail-chip" id="detailType"></span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span id="detailSlug"></span>
              </span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span id="detailDate"></span>
              </span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span id="detailSize"></span>
              </span>
            </div>
          </div>

          <div class="detail-warn" id="detailWarn" style="display:none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span id="detailWarnText"></span>
          </div>

          <div class="detail-actions" id="detailActions"></div>

          <div class="detail-section-label">Pratinjau</div>
          <div class="detail-preview">
            <div class="detail-preview-header">
              <span class="detail-preview-title" id="previewFileName"></span>
              <button type="button" class="detail-preview-toggle" onclick="togglePreviewCode(this)">Sembunyikan</button>
            </div>
            <div class="detail-preview-code" id="previewCode"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `}

  ${isAuth ? `
  <!-- Popup Ubah Judul & Alamat -->
  <div id="edit-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-head">
        <h3 class="modal-title">
          <span class="form-head-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>
          </span>
          Ubah Judul &amp; Alamat
        </h3>
        <button type="button" data-edit-close class="modal-close" aria-label="Tutup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form method="POST" action="/api/app/update" id="edit-form">
        <input type="hidden" name="slug" id="edit-old-slug">
        <div class="opt-group">
          <label class="opt-cap" for="edit-title">Judul aplikasi</label>
          <input class="form-input" type="text" id="edit-title" name="title" placeholder="Judul aplikasi">
          <p class="opt-cap" style="margin-top:7px">Untuk kuis JSON Soal, judul ini juga mengganti judul di halaman siswa.</p>
        </div>
        <div class="opt-group">
          <label class="opt-cap" for="edit-new-slug">Alamat /p/...</label>
          <input class="form-input" type="text" id="edit-new-slug" name="new_slug" placeholder="slug-baru" style="font-family:'Geist Mono',ui-monospace,monospace">
          <p class="opt-cap" id="edit-note-legacy" style="display:none;margin-top:7px;color:var(--warn)">Aplikasi lama (HTML): judul yang diganti hanya mengubah label di dashboard, bukan judul di halaman siswa.</p>
          <p class="opt-cap" style="display:block;margin-top:7px;color:var(--warn)">Alamat lama langsung mati (tanpa redirect) setelah disimpan; media dan riwayat nilai ikut pindah ke alamat baru.</p>
        </div>
        <div class="modal-actions">
          <button type="button" data-edit-close class="btn btn-ghost">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Popup Cetak / Simpan PDF -->
  <div id="print-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-head">
        <h3 class="modal-title">
          <span class="form-head-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </span>
          Cetak / Simpan PDF
        </h3>
        <button type="button" data-modal-close class="modal-close" aria-label="Tutup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="opt-group">
        <p class="opt-cap">Isi dokumen</p>
        <label class="opt-label"><input type="radio" name="print-mode" value="soal" checked>Naskah soal</label>
        <label class="opt-label"><input type="radio" name="print-mode" value="kunci">Soal + kunci &amp; pembahasan</label>
      </div>
      <div class="opt-group">
        <p class="opt-cap">Tata letak</p>
        <div class="seg">
          <button type="button" data-layout="1col" class="seg-cols seg-on">1 Kolom</button>
          <button type="button" data-layout="2col" class="seg-cols">2 Kolom</button>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" data-modal-close class="btn btn-ghost">Batal</button>
        <button type="button" id="print-modal-go" class="btn btn-primary">Cetak / Simpan PDF</button>
      </div>
    </div>
  </div>
  <script>
  var APPDATA = ${appDataJson};

  function toggleSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (s) s.classList.toggle('open');
    if (o) o.classList.toggle('open');
  }

  function showEmptyState() {
    var e = document.getElementById('viewEmpty');
    var d = document.getElementById('viewDetail');
    if (e) e.style.display = 'flex';
    if (d) d.style.display = 'none';
    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
  }

  function showDetail(el, slug) {
    var e = document.getElementById('viewEmpty');
    var d = document.getElementById('viewDetail');
    if (e) e.style.display = 'none';
    if (d) d.style.display = 'flex';
    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
    if (el) el.classList.add('active');

    var app = APPDATA[slug];
    if (!app) return;

    document.getElementById('detailTitle').textContent = app.title;
    document.getElementById('detailType').textContent = app.type;
    document.getElementById('detailSlug').textContent = '/p/' + app.slug;
    document.getElementById('detailDate').textContent = app.date;
    document.getElementById('detailSize').textContent = app.size;

    var warn = document.getElementById('detailWarn');
    if (app.mediaMissing > 0) {
      warn.style.display = 'flex';
      document.getElementById('detailWarnText').textContent = app.mediaMissing + ' dari ' + app.mediaTotal + ' gambar soal belum diunggah';
    } else {
      warn.style.display = 'none';
    }

    document.getElementById('previewFileName').textContent = app.slug + '.' + app.type;
    document.getElementById('previewCode').textContent = app.preview;
    document.getElementById('previewCode').style.display = 'block';
    var toggler = document.querySelector('.detail-preview-toggle');
    if (toggler) toggler.textContent = 'Sembunyikan';

    var act = document.getElementById('detailActions');
    var icons = {
      open: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      tag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>',
      img: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      log: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      print: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
      del: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
    };
    function cell(inner) {
      return '<div class="detail-action-icon">' + inner + '</div>';
    }
    var html = '';
    html += '<a class="detail-action" href="/p/' + app.slug + '" target="_blank">' + cell(icons.open) + 'Buka App</a>';
    if (app.type === 'json') html += '<a class="detail-action" href="/p/' + app.slug + '/edit">' + cell(icons.edit) + 'Edit Soal</a>';
    html += '<a class="detail-action" href="/p/' + app.slug + '/media">' + cell(icons.img) + 'Atur Gambar</a>';
    html += '<a class="detail-action" href="/p/' + app.slug + '/data">' + cell(icons.log) + 'Log Data</a>';
    html += '<button type="button" class="detail-action" data-edit-btn="' + app.slug + '">' + cell(icons.tag) + 'Judul &amp; Slug</button>';
    if (app.type === 'json') html += '<button type="button" class="detail-action" data-print-btn="' + app.slug + '">' + cell(icons.print) + 'Cetak PDF</button>';
    html += '<form method="POST" action="/api/delete" onsubmit="return confirm(&quot;Hapus aplikasi ini?&quot;)"><input type="hidden" name="slug" value="' + app.slug + '"><button type="submit" class="detail-action danger">' + cell(icons.del) + 'Hapus</button></form>';
    act.innerHTML = html;

    if (window.innerWidth < 1024) toggleSidebar();
  }

  function togglePreviewCode(btn) {
    var code = document.getElementById('previewCode');
    if (code.style.display === 'none') {
      code.style.display = 'block';
      btn.textContent = 'Sembunyikan';
    } else {
      code.style.display = 'none';
      btn.textContent = 'Tampilkan';
    }
  }

  function filterApps(q) {
    var query = q.toLowerCase();
    document.querySelectorAll('.sidebar-item').forEach(function (item) {
      var text = item.querySelector('.sidebar-item-text').textContent.toLowerCase();
      item.style.display = text.indexOf(query) !== -1 ? '' : 'none';
    });
  }

  function resetForm() {
    var form = document.querySelector('#deployBox form');
    if (form) form.reset();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (document.getElementById('sidebar').classList.contains('open')) toggleSidebar();
    }
  });

  // Print modal (delegated, works with dynamically-added buttons)
  var printModal = document.getElementById('print-modal');
  function setPrintOpen(open) {
    printModal.classList.add('hidden');
    printModal.classList.remove('flex');
    if (open) {
      printModal.classList.remove('hidden');
      printModal.classList.add('flex');
    }
  }
  if (printModal) {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-print-btn]');
      if (b) {
        printModal.dataset.slug = b.getAttribute('data-print-btn');
        setPrintOpen(true);
      }
    });
    printModal.querySelectorAll('[data-layout]').forEach(function (b) {
      b.addEventListener('click', function () {
        printModal.querySelectorAll('[data-layout]').forEach(function (x) { x.classList.toggle('seg-on', x === b); });
      });
    });
    printModal.addEventListener('click', function (e) { if (e.target === printModal) setPrintOpen(false); });
    document.querySelectorAll('[data-modal-close]').forEach(function (b) { b.addEventListener('click', function () { setPrintOpen(false); }); });
    document.getElementById('print-modal-go').addEventListener('click', function () {
      if (!printModal.dataset.slug) return;
      var mode = printModal.querySelector('input[name="print-mode"]:checked').value;
      var layout = (printModal.querySelector('[data-layout].seg-on') || {
        getAttribute: function () { return '1col'; }
      }).getAttribute('data-layout');
      var q = '/p/' + printModal.dataset.slug + '?print=1' + (mode === 'kunci' ? '&kunci=1' : '');
      if (layout === '2col') q += '&layout=2col';
      q += '&auto=1';
      window.open(q, '_blank');
    });
  }

  // Modal Ubah Judul & Alamat (delegated, works with dynamically-added buttons)
  var editModal = document.getElementById('edit-modal');
  if (editModal) {
    function setEditOpen(open) {
      editModal.classList.add('hidden');
      editModal.classList.remove('flex');
      if (open) {
        editModal.classList.remove('hidden');
        editModal.classList.add('flex');
      }
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit-btn]');
      if (b) {
        var slug = b.getAttribute('data-edit-btn');
        var app = APPDATA[slug];
        if (!app) return;
        document.getElementById('edit-old-slug').value = slug;
        document.getElementById('edit-title').value = app.title || '';
        document.getElementById('edit-new-slug').value = app.slug || '';
        var legacyNote = document.getElementById('edit-note-legacy');
        if (legacyNote) legacyNote.style.display = app.type === 'json' ? 'none' : 'block';
        setEditOpen(true);
      }
    });
    editModal.querySelectorAll('[data-edit-close]').forEach(function (b) {
      b.addEventListener('click', function () { setEditOpen(false); });
    });
    editModal.addEventListener('click', function (e) { if (e.target === editModal) setEditOpen(false); });
    var editForm = document.getElementById('edit-form');
    if (editForm) {
      editForm.addEventListener('submit', function () {
        var slugged = editForm.querySelector('input[name="new_slug"]');
        if (slugged) slugged.value = slugged.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      });
    }
  }

  // Deep-link: /?app=<slug> langsung membuka panel detail aplikasi itu.
  // Dipakai /api/deploy setelah publish supaya guru langsung melihat alamat
  // publik yang baru dan tidak salah share alamat lamanya ke siswa. Query-nya
  // lalu dibuang supaya refresh tidak memaksa panel yang sama terbuka lagi.
  (function openAppFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var want = params.get('app');
    if (!want || !APPDATA[want]) return;
    var item = null;
    document.querySelectorAll('.sidebar-item').forEach(function (el) {
      if (!item && el.getAttribute('data-slug') === want) item = el;
    });
    showDetail(item, want);
    if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    window.history.replaceState(null, '', window.location.pathname);
  })();
  </script>` : ''}
</body>
</html>`);
});

// ==========================================
// 4. ACTION HANDLERS
// ==========================================
app.post('/api/deploy', async (c) => {
  if (getCookie(c, 'auth_session') !== 'authenticated_user') {
    return c.text('Unauthorized', 401);
  }

  const body = await c.req.parseBody();
  const formTitle = (body.title as string || '').trim();
  const rawCode = (body.code_content as string || '').trim();

  if (!rawCode) {
    return c.html(errorPage('Isi masih kosong', 'Tempel daftar soal JSON dulu sebelum dipublikasikan.'), 400);
  }

  let quiz: QuizSpec | null = null;
  let quizError = '';
  try {
    quiz = parseQuizSpec(rawCode);
  } catch (err) {
    quizError = err instanceof QuizError ? err.message : String(err);
  }
  if (!quiz) return c.html(errorPage('JSON soal belum valid', quizError), 400);

  const title = formTitle || quiz.title || 'Kuis';
  // Slug dasar mengikuti yang diminta guru. Kalau alamat itu sudah dipakai
  // aplikasi lain, dapet sufiks acak supaya publish kedua tidak menimpa versi
  // lama — termasuk jawaban siswa yang sudah terkumpul di aplikasi itu.
  const baseSlug = sanitizeSlug(quiz.slug || formTitle || quiz.title);
  const slug = (await c.env.STORAGE.get(`meta:${baseSlug}`))
    ? await uniqueSlug(c.env, baseSlug)
    : baseSlug;
  // Spec yang disimpan harus menyebut alamat yang benar, bukan slug yang dipesan
  // guru sebelum kena sufiks, supaya editor dan spec tidak berbeda dengan URL.
  quiz.slug = slug;

  await saveApp(c.env, { title, slug, type: 'json', html: renderQuizApp(quiz, slug) });
  // Spec disimpan supaya skor bisa dihitung ulang di server saat siswa mengirim jawaban.
  await c.env.STORAGE.put(`quiz:${slug}`, JSON.stringify(quiz));
  // JSON mentah dari guru/Gem disimpan utuh sebagai sumber kebenaran editor soal,
  // termasuk `slug` yang diketik guru. Sengaja tidak disinkronkan ke slug akhir:
  // editor menyimpan lewat rute (`/api/quiz/:slug/save`) yang memakai slug alamat,
  // jadi slug lama di dalam sumber tidak pernah dipakai lagi untuk menentukan
  // alamat. Kalau slug guru bentrok dan guru mem-publish ulang sumber itu,
  // `POST /api/deploy` mendeteksi bentrok lagi dan memberi sufiks baru.
  await c.env.STORAGE.put(`quizsource:${slug}`, JSON.stringify(parseQuizJson(rawCode), null, 2));

  // `?app=` membuat dashboard langsung membuka panel detail aplikasi ini, jadi
  // guru melihat alamat publik yang benar dan tidak salah share ke siswa.
  return c.redirect(`/?app=${encodeURIComponent(slug)}`);
});

app.post('/api/delete', async (c) => {
  if (getCookie(c, 'auth_session') !== 'authenticated_user') {
    return c.text('Unauthorized', 401);
  }

  const body = await c.req.parseBody();
  const slug = body.slug as string;
  if (slug) {
    await c.env.STORAGE.delete(`html:${slug}`);
    await c.env.STORAGE.delete(`meta:${slug}`);
    await c.env.STORAGE.delete(`quiz:${slug}`);
    await c.env.STORAGE.delete(`quizsource:${slug}`);
    await deleteAllMedia(c.env, slug); // jangan tinggalkan gambar yatim di storage
  }

  return c.redirect('/');
});

// ==========================================
// 5. UBAH JUDUL ATAU SLUG APLIKASI
// ==========================================
app.post('/api/app/update', async (c) => {
  if (getCookie(c, 'auth_session') !== 'authenticated_user') {
    return c.text('Unauthorized', 401);
  }

  const body = await c.req.parseBody();
  const oldSlug = safeSlug((body.slug as string) || '');
  if (!oldSlug) return c.html(errorPage('Aplikasi tidak ditemukan', 'Alamat aplikasi kosong.'), 400);

  const metaRaw = await c.env.STORAGE.get(`meta:${oldSlug}`);
  if (!metaRaw) {
    return c.html(errorPage('Aplikasi tidak ditemukan', `Tidak ada aplikasi di /p/${oldSlug}.`), 404);
  }
  const meta = JSON.parse(metaRaw) as { title?: string; slug?: string; type?: string };

  const nextTitle = (body.title as string || '').trim() || meta.title || oldSlug;
  const newSlug = sanitizeSlug((body.new_slug as string || '').trim() || oldSlug);
  const renamed = newSlug !== oldSlug;
  const titleChanged = nextTitle !== (meta.title ?? oldSlug);
  const type = meta.type || 'json';
  let renderedSize = 0;

  if (renamed) {
    const clash = await c.env.STORAGE.get(`meta:${newSlug}`);
    if (clash) {
      return c.html(errorPage('Alamat sudah dipakai', `Sudah ada aplikasi lain di /p/${newSlug}. Pilih alamat yang lain.`), 400);
    }

    // Riwayat jawaban di D1 dipindahkan lebih dulu, sebelum satu pun kunci KV
    // ditulis ke slug baru. KV dan D1 tidak bisa digabung dalam satu transaksi,
    // tapi urutan ini memastikan kondisi gagal selalu jatuh kembali ke slug
    // lama: kalau D1 gagal, alamat baru belum pernah hidup, jadi guru tidak
    // pernah melihat dua aplikasi dengan isi sama di dua slug sekaligus.
    try {
      if (titleChanged && type === 'json') {
        const { results } = await c.env.DB.prepare('SELECT id, payload_json FROM app_records WHERE app_slug = ?')
          .bind(oldSlug)
          .all();
        for (const row of results as { id?: string; payload_json?: string }[]) {
          if (!row.id || !row.payload_json) continue;
          try {
            const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
            if (typeof payload.quiz_title === 'string') payload.quiz_title = nextTitle;
            await c.env.DB.prepare('UPDATE app_records SET payload_json = ? WHERE id = ?')
              .bind(JSON.stringify(payload), row.id)
              .run();
          } catch {
            // Payload rusak: lewati baris itu, jangan gagalkan migrasi.
          }
        }
      }
      await c.env.DB.prepare('UPDATE app_records SET app_slug = ? WHERE app_slug = ?').bind(newSlug, oldSlug).run();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.html(
        errorPage(
          'Riwayat jawaban belum tersinkron',
          `Alamat aplikasi tidak diubah karena database jawaban tidak bisa diperbarui (${escapeHtml(detail)}). Coba lagi sebentar.`
        ),
        500
      );
    }
  }

  // --- Mode JSON Soal: judul bisa disinkronkan + halaman kuis digambar ulang ---
  if (type === 'json') {
    if (renamed || titleChanged) {
      let source = (await c.env.STORAGE.get(`quizsource:${oldSlug}`)) ?? '';
      let quiz: QuizSpec | null = null;

      if (source) {
        try {
          const obj = JSON.parse(source) as Record<string, unknown>;
          if (titleChanged) {
            obj.title = nextTitle;
            delete obj.judul;
            delete obj.nama;
            source = JSON.stringify(obj, null, 2);
          }
          quiz = parseQuizSpec(source);
        } catch (error) {
          return c.html(errorPage('JSON soal bermasalah', error instanceof QuizError ? error.message : String(error)), 400);
        }
      } else {
        const specRaw = await c.env.STORAGE.get(`quiz:${oldSlug}`);
        if (specRaw) {
          try {
            const spec = JSON.parse(specRaw) as QuizSpec;
            if (titleChanged) spec.title = nextTitle;
            source = JSON.stringify(spec);
            quiz = parseQuizSpec(source);
          } catch (error) {
            return c.html(errorPage('JSON soal bermasalah', error instanceof QuizError ? error.message : String(error)), 400);
          }
        }
      }

      if (!quiz) {
        return c.html(errorPage('Aplikasi tidak ditemukan', 'Tidak ada data soal yang bisa digambar ulang.'), 400);
      }

      const renderedHtml = renderQuizApp(quiz, newSlug);
      await c.env.STORAGE.put(`html:${newSlug}`, renderedHtml);
      await c.env.STORAGE.put(`quiz:${newSlug}`, JSON.stringify(quiz));
      if (source) await c.env.STORAGE.put(`quizsource:${newSlug}`, source);
      renderedSize = renderedHtml.length;
    }
  } else if (renamed) {
    // Aplikasi lama (dulu dipublish sebagai HTML/React) tidak punya spec soal
    // untuk digambar ulang, jadi halamannya disalin apa adanya ke alamat baru.
    const html = await c.env.STORAGE.get(`html:${oldSlug}`);
    if (html) await c.env.STORAGE.put(`html:${newSlug}`, html);
  }

  await c.env.STORAGE.put(
    `meta:${newSlug}`,
    JSON.stringify({
      ...meta,
      title: nextTitle,
      slug: newSlug,
      ...(renderedSize ? { size: Math.round(renderedSize / 1024) } : {}),
      updated_at: stampNow(),
    })
  );

  if (renamed) {
    if (type === 'json') {
      // Konfigurasi generate gambar (BYOK) ikut pindah kalau ada.
      const imgCfg = await c.env.STORAGE.get(`imggencfg:${oldSlug}`);
      if (imgCfg !== null) {
        await c.env.STORAGE.put(`imggencfg:${newSlug}`, imgCfg);
        await c.env.STORAGE.delete(`imggencfg:${oldSlug}`);
      }
    }

    // Riwayat jawaban sudah dipindah ke slug baru di blok try di atas, sebelum
    // kunci KV ditulis, supaya kegagalan D1 tidak meninggalkan dua alamat hidup.
    // Link lama mati total (tanpa redirect), media dipindahkan, key lama dibersihkan.
    await c.env.STORAGE.delete(`html:${oldSlug}`);
    await c.env.STORAGE.delete(`meta:${oldSlug}`);
    await c.env.STORAGE.delete(`quiz:${oldSlug}`);
    await c.env.STORAGE.delete(`quizsource:${oldSlug}`);
    await moveAllMedia(c.env, oldSlug, newSlug);
  }

  return c.redirect('/');
});

export default app;
