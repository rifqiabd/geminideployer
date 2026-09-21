import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { QuizError, escapeHtml, gradeSubmission, mediaBaseFor, parseQuizJson, parseQuizSpec, renderPrintSheet, renderQuizApp } from './quiz';
import type { QuizSpec } from './quiz';
import { registerMediaRoutes, withMediaStats } from './media-routes';
import { registerQuizEditorRoutes } from './quiz-editor';
import { computeItemAnalysis, renderItemAnalysis } from './quiz-report';
import { registerEssayGradingRoutes } from './quiz-essay';
import { deleteAllMedia } from './media';
import { registerGuideRoute, GEM_URL } from './guide';

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
};

const app = new Hono<{ Bindings: Bindings }>();
const APP_PASSWORD = 'admin123'; // Ganti password sebelum deploy!

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

// Helper: Bersihkan tag markdown dari output Gemini
function cleanGeminiMarkdown(code: string): string {
  return code
    .trim()
    .replace(/^```(?:html|react|jsx|javascript|js)?\r?\n/i, '')
    .replace(/\r?\n```(?:eof)?$/i, '')
    .trim();
}

// Helper: Format slug URL
function sanitizeSlug(str: string): string {
  const slug = str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `app-${Date.now()}`;
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
  await env.STORAGE.put(`html:${entry.slug}`, entry.html);
  await env.STORAGE.put(
    `meta:${entry.slug}`,
    JSON.stringify({
      title: entry.title,
      slug: entry.slug,
      type: entry.type,
      created_at: new Date().toISOString().substring(0, 10),
      size: (new TextEncoder().encode(entry.html).length / 1024).toFixed(1) + ' KB',
    })
  );
}

// Helper: Pembungkus React JSX Standalone
function wrapReactComponent(reactCode: string, title: string): string {
  const processedCode = reactCode
    .replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/, 'function $1')
    .replace(/export\s+default\s+([A-Za-z0-9_]+);?/, '')
    .replace(/import\s+.*?from\s+['"].*?['"];?/g, '// $& (CDN Handled)');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body class="bg-gray-50 text-gray-900">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useMemo, useCallback } = React;
    ${processedCode}
    (function autoMount() {
      const candidates = ["App", "Main", "Index", "Application"];
      let Target = null;
      for (const name of candidates) {
        try {
          if (typeof window[name] === "function" || typeof eval(name) === "function") {
            Target = eval(name);
            break;
          }
        } catch (e) {}
      }
      const rootNode = document.getElementById("root");
      if (Target && rootNode) {
        ReactDOM.createRoot(rootNode).render(<Target />);
      }
    })();
  </script>
</body>
</html>`;
}

// ==========================================
// 1. ENDPOINT APLIKASI PUBLIK
// ==========================================

// Buka Aplikasi Berdasarkan Slug
app.get('/p/:slug', async (c) => {
  const slug = c.req.param('slug');

  // Mode cetak (Print to PDF) khusus kuis JSON: `?print=1` (+ `&kunci=1`).
  // Aplikasi mode HTML/React tidak punya spec terstruktur — biarkan apa adanya.
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
      ? `<a href="/p/${slug}/essay" class="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400 rounded-2xl p-4 transition">
      <i class="fa-solid fa-pen-to-square text-amber-400 text-lg"></i>
      <div class="flex-1">
        <p class="text-sm font-semibold text-amber-200">${essayQueue} kiriman punya jawaban esai yang belum dikoreksi</p>
        <p class="text-[11px] text-amber-200/70">Nilai akhir baru dihitung setelah semua esai di satu kiriman selesai dinilai.</p>
      </div>
      <span class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg text-xs font-bold whitespace-nowrap">Koreksi Sekarang</span>
    </a>`
      : quizHasEssay
        ? `<a href="/p/${slug}/essay" class="inline-block text-xs text-slate-400 hover:text-slate-200">Koreksi jawaban esai &rarr;</a>`
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
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6 font-sans">
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex items-center justify-between border-b border-slate-800 pb-4">
      <div>
        <a href="/" class="text-xs text-blue-400 hover:underline flex items-center gap-1 mb-1">
          <i class="fa-solid fa-arrow-left"></i> Kembali ke Dashboard
        </a>
        <h1 class="text-xl font-bold text-white">Rekap Log Data: <span class="text-amber-400 font-mono">/p/${slug}</span></h1>
        <p class="text-xs text-slate-400">Total entri masuk: ${results.length} rekaman</p>
      </div>
      <a href="/p/${slug}" target="_blank" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold">
        Buka Aplikasi
      </a>
    </div>

    ${essayCallout}

    ${analysisHtml}

    ${results.length === 0 ? `
      <div class="bg-slate-800/50 p-12 rounded-2xl border border-slate-800 text-center text-slate-400 text-sm">
        Belum ada data atau respons yang masuk untuk aplikasi ini.
      </div>
    ` : `
      <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-900/80 text-slate-300 border-b border-slate-700 uppercase font-semibold">
              <tr>
                <th class="p-3.5">Waktu</th>
                <th class="p-3.5">Identitas Pengguna</th>
                <th class="p-3.5">Ringkasan / Skor</th>
                <th class="p-3.5">Detail Payload</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-700">
              ${results.map((r: any) => {
                const payload = JSON.parse(r.payload_json);
                const summary = payload.summary ? JSON.stringify(payload.summary) : (payload.score !== undefined ? `Skor: ${payload.score}` : '-');
                return `
                  <tr class="hover:bg-slate-750/50 transition">
                    <td class="p-3.5 text-slate-400 whitespace-nowrap">${r.created_at}</td>
                    <td class="p-3.5 font-medium text-white">${r.user_id}</td>
                    <td class="p-3.5 font-mono text-emerald-400">${summary}</td>
                    <td class="p-3.5">
                      <details class="cursor-pointer">
                        <summary class="text-blue-400 hover:text-blue-300">Lihat JSON</summary>
                        <pre class="mt-2 p-2.5 bg-slate-950 rounded-lg text-[11px] text-slate-300 overflow-x-auto max-w-md font-mono">${JSON.stringify(payload, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  </div>
</body>
</html>`);
});

// ==========================================
// 3. AUTHENTICATION & DASHBOARD ADMIN
// ==========================================
app.post('/api/login', async (c) => {
  const body = await c.req.parseBody();
  if (body.password === APP_PASSWORD) {
    setCookie(c, 'auth_session', 'authenticated_user', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return c.redirect('/');
  }
  return c.text('Password salah!', 401);
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
    projects.reverse();
  }

  return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini App Hub & Deployer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    .seg-cols { padding: 5px 9px; font-size: 11px; background: transparent; color: #94a3b8; border: none; cursor: pointer; transition: background .15s, color .15s; }
    .seg-cols:hover { background: rgba(255,255,255,.08); color: #fff; }
    .seg-on { background: #7c3aed; color: #fff !important; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col font-sans">
  <nav class="bg-slate-800/80 border-b border-slate-700/60 p-4 sticky top-0 z-40 backdrop-blur">
    <div class="max-w-6xl mx-auto flex justify-between items-center">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white">
          <i class="fa-solid fa-cloud-bolt"></i>
        </div>
        <h1 class="text-base font-bold text-white">Gemini Edge Deployer</h1>
      </div>
      ${isAuth ? `<div class="flex items-center gap-2"><a href="${GEM_URL}" target="_blank" rel="noopener" class="text-xs bg-orange-600 hover:bg-orange-500 px-3 py-1.5 rounded-lg text-white font-semibold transition" title="Buka Gem Gemini pembuat soal"><i class="fa-brands fa-google mr-1"></i> Gem Gemini</a><a href="/panduan" class="text-xs bg-slate-700 hover:bg-orange-600 px-3 py-1.5 rounded-lg text-slate-200 transition" title="Panduan Penggunaan"><i class="fa-solid fa-book mr-1"></i> Panduan</a><a href="/api/logout" class="text-xs bg-slate-700 hover:bg-rose-600 px-3 py-1.5 rounded-lg text-slate-200 transition"><i class="fa-solid fa-right-from-bracket mr-1"></i> Keluar</a></div>` : ''}
    </div>
  </nav>

  <main class="max-w-6xl mx-auto p-6 w-full flex-grow">
    ${!isAuth ? `
      <div class="max-w-sm mx-auto my-16 bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl">
        <h2 class="text-lg font-bold mb-4 text-center text-white">Login Diperlukan</h2>
        <form method="POST" action="/api/login" class="space-y-4">
          <input type="password" name="password" required placeholder="Master Password" class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-orange-500">
          <button type="submit" class="w-full py-2.5 bg-orange-600 hover:bg-orange-500 rounded-xl text-sm font-semibold text-white shadow-lg transition">Masuk</button>
        </form>
      </div>
    ` : `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <!-- Panel Form Deploy -->
        <div class="lg:col-span-5 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg h-fit">
          <h3 class="text-sm font-bold mb-4 text-orange-400 flex items-center gap-2">
            <i class="fa-solid fa-code"></i> Deploy Output Gemini Baru
          </h3>
          <form method="POST" action="/api/deploy" class="space-y-4">
            <div>
              <label class="block text-xs mb-1.5 text-slate-300 font-medium">Judul Aplikasi <span class="text-slate-500">(jadi alamat /p/...)</span></label>
              <input type="text" name="title" placeholder="Contoh: Kuis Akidah Akhlak Kelas 1" class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-orange-500">
            </div>
            <div class="grid grid-cols-3 gap-2.5">
              <label class="border border-slate-700 p-2.5 rounded-xl flex flex-col items-center gap-1.5 bg-slate-900/40 cursor-pointer text-center">
                <input type="radio" name="code_type" value="html" checked>
                <span class="text-xs font-medium">HTML</span>
              </label>
              <label class="border border-slate-700 p-2.5 rounded-xl flex flex-col items-center gap-1.5 bg-slate-900/40 cursor-pointer text-center">
                <input type="radio" name="code_type" value="react">
                <span class="text-xs font-medium">React JSX</span>
              </label>
              <label class="border border-slate-700 p-2.5 rounded-xl flex flex-col items-center gap-1.5 bg-slate-900/40 cursor-pointer text-center">
                <input type="radio" name="code_type" value="json">
                <span class="text-xs font-medium">JSON Soal</span>
              </label>
            </div>
            <p class="text-[11px] text-slate-500 leading-snug">Pilih <b class="text-slate-300">JSON Soal</b> kalau mau aplikasi kuisnya dibuatkan otomatis dari daftar soal. Jenis soal yang didukung: <b class="text-slate-300">choice</b> (PG), <b class="text-slate-300">multi</b> (pilih semua yang benar), <b class="text-slate-300">category</b> (tabel Benar/Salah), <b class="text-slate-300">matching</b> (menjodohkan), <b class="text-slate-300">ordering</b> (mengurutkan), <b class="text-slate-300">table_fill</b> (melengkapi tabel), <b class="text-slate-300">two_tier</b> (pernyataan + alasan), <b class="text-slate-300">highlight</b> (pilih kata di bacaan), <b class="text-slate-300">true_false</b>, <b class="text-slate-300">short</b>, dan <b class="text-slate-300">essay</b>. Soal bergambar cukup ditulis <code class="text-amber-400 font-mono">"image": "media:nama-slot"</code> — fotonya diunggah di tombol <b class="text-slate-300">Gambar</b> setelah dipublikasikan.</p>
            <div>
              <label class="block text-xs mb-1.5 text-slate-300 font-medium">Isi (kode atau JSON soal)</label>
              <textarea name="code_content" required rows="9" placeholder="Mode HTML/React: tempel kode Gemini. Mode JSON Soal: tempel daftar soal dalam format JSON." class="w-full p-3 bg-slate-900 border border-slate-700 rounded-xl font-mono text-xs text-slate-200 outline-none focus:border-orange-500 leading-relaxed"></textarea>
            </div>
            <details class="text-[11px] bg-slate-900/40 border border-slate-700/60 rounded-xl p-3">
              <summary class="cursor-pointer text-slate-300 font-medium">Contoh JSON soal lengkap (klik untuk lihat)</summary>
              <pre class="mt-2 overflow-x-auto text-[10.5px] leading-relaxed text-slate-300 font-mono whitespace-pre">{
  "title": "TKA Bahasa Inggris SMK - Dunia Kerja",
  "description": "Pilih jawaban yang paling tepat.",
  "passing_score": 70,
  "questions": [
    { "type": "choice", "level": "L1",
      "stimulus": {
        "title": "Company Operational Memo",
        "content": "All technicians entering Zone B must wear high-visibility vests (supplied at entrance Gate 2) and keep a 2 meter clearance from any moving AGV path."
      },
      "question": "Where should technical staff obtain the high-visibility vests?",
      "options": ["HSE office", "Dispatch desk", "Gate 2", "Docking station", "Exit counter"],
      "answer": "C",
      "explanation": "Teks menyebut vests yang disediakan **di pintu masuk Gate 2**." },
    { "type": "category", "level": "L3", "question": "Tentukan status tiap pernyataan berikut.",
      "labels": ["Benar", "Salah"],
      "statements": [
        { "text": "Password bawaan pabrik boleh dipakai terus.", "answer": false },
        { "text": "Pemeriksaan firmware setiap Senin pertama.", "answer": true } ] },
    { "type": "multi", "level": "L2", "question": "Manakah yang termasuk kalimat thayyibah? (pilih semua yang benar)",
      "options": ["Tahlil", "Takbir", "Dusta", "Tahmid"], "answer": ["A", "B", "D"], "scoring": "partial" },
    { "type": "matching", "level": "L2", "scoring": "partial", "question": "Jodohkan istilah dengan pengertiannya.",
      "pairs": [
        { "left": "AGV", "right": "Kendaraan pemandu otomatis di gudang" },
        { "left": "HSE", "right": "Departemen keselamatan dan kesehatan kerja" },
        { "left": "SOP", "right": "Prosedur baku yang wajib diikuti" } ] },
    { "type": "ordering", "level": "L2", "scoring": "partial", "question": "Urutkan langkah mengisi daya kendaraan listrik.",
      "items": ["Pastikan port kering", "Sambungkan konektor sampai berbunyi klik", "Tekan Finish Session", "Cabut konektor"] },
    { "type": "table_fill", "level": "L2", "scoring": "partial", "question": "Lengkapi tabel titik lebur bahan berikut.",
      "headers": ["Bahan", "Titik lebur"],
      "rows": [["Timah", { "answer": ["327"] }], ["Tembaga", { "answer": ["1085"] }]] },
    { "type": "two_tier", "level": "L3", "scoring": "partial", "question": "Setujukah kamu dengan tindakan teknisi itu?",
      "options": ["Setuju", "Tidak setuju"], "answer": "Tidak setuju",
      "reasons": ["Karena ia mengabaikan prosedur keselamatan", "Karena mesinnya sudah tua"],
      "reason_answer": "Karena ia mengabaikan prosedur keselamatan" },
    { "type": "highlight", "level": "L2", "scoring": "partial", "question": "Klik kata yang menunjukkan sikap jujur.",
      "text": "Budi {mengembalikan} uang yang ia temukan kepada {guru} di sekolah.", "answer": ["mengembalikan"] },
    { "type": "short", "question": "Sebutkan lafal takbir!", "answer": ["allahu akbar", "takbir"] },
    { "type": "choice", "level": "L2", "question": "Perhatikan gambar di bawah ini!",
      "image": "media:tumbuhan", "options": ["Fotosintesis", "Respirasi"], "answer": "Fotosintesis" },
    { "type": "essay", "level": "L3", "question": "Ceritakan contoh perilaku jujur di sekolah!", "points": 5,
      "explanation": "Dikoreksi manual oleh guru." }
  ]
}</pre>
            </details>
            <button type="submit" class="w-full py-2.5 bg-orange-600 hover:bg-orange-500 font-semibold rounded-xl text-sm transition text-white shadow-lg">Publikasikan ke URL</button>
          </form>
        </div>

        <!-- Panel Daftar Aplikasi -->
        <div class="lg:col-span-7 space-y-4">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-layer-group text-orange-400"></i> Daftar Aplikasi Aktif (${projects.length})
          </h2>
          ${projects.length === 0 ? `<div class="p-12 text-center bg-slate-800/40 border border-slate-800 rounded-2xl text-slate-500 text-xs">Belum ada aplikasi yang dideploy.</div>` : ''}
          <div class="space-y-3">
            ${projects.map((p) => `
              <div class="bg-slate-800 p-4 rounded-xl border border-slate-700/80 flex items-center justify-between hover:border-slate-600 transition">
                <div>
                  <h4 class="text-sm font-semibold text-white">${p.title}</h4>
                  <p class="text-xs text-slate-400 font-mono mt-0.5">/p/${p.slug} &bull; ${p.size} &bull; ${p.created_at}</p>
                  ${p.media_missing ? `<p class="text-[11px] text-rose-400 mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${p.media_missing} dari ${p.media_slots} gambar soal belum diunggah</p>` : ''}
                </div>
                <div class="flex items-center gap-2">
                  ${p.type === 'json' ? `<button type="button" data-print-btn="${p.slug}" class="px-2.5 py-1.5 bg-violet-600/20 text-violet-400 hover:bg-violet-500 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5" title="Cetak / Simpan PDF">
                    <i class="fa-solid fa-print"></i> Cetak
                  </button>` : ''}
                  ${p.type === 'json' ? `<a href="/p/${p.slug}/edit" class="px-2.5 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5" title="Edit Soal"><i class="fa-solid fa-pen-to-square"></i> Edit</a>` : ''}
                  <a href="/p/${p.slug}/media" class="px-2.5 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5" title="Atur Gambar Soal">
                    <i class="fa-solid fa-image"></i> Gambar
                  </a>
                  <a href="/p/${p.slug}/data" class="px-2.5 py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5" title="Lihat Rekap Data">
                    <i class="fa-solid fa-table-list"></i> Log Data
                  </a>
                  <a href="/p/${p.slug}" target="_blank" class="p-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg text-xs transition" title="Buka Aplikasi">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  </a>
                  <form method="POST" action="/api/delete" onsubmit="return confirm('Hapus aplikasi ini?')">
                    <input type="hidden" name="slug" value="${p.slug}">
                    <button type="submit" class="p-2 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg text-xs transition" title="Hapus">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </form>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `}
  </main>
  ${isAuth ? `
  <!-- Popup Cetak / Simpan PDF -->
  <div id="print-modal" class="hidden fixed inset-0 z-50 items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
    <div class="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-white flex items-center gap-2"><i class="fa-solid fa-print text-violet-400"></i>Cetak / Simpan PDF</h3>
        <button type="button" data-modal-close class="text-slate-400 hover:text-white" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="space-y-4">
        <div>
          <p class="text-xs font-medium text-slate-400 mb-2">Isi dokumen</p>
          <label class="flex items-center gap-2 mb-2 cursor-pointer text-sm text-slate-200"><input type="radio" name="print-mode" value="soal" checked class="accent-violet-500">Naskah soal</label>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-200"><input type="radio" name="print-mode" value="kunci" class="accent-violet-500">Soal + kunci &amp; pembahasan</label>
        </div>
        <div>
          <p class="text-xs font-medium text-slate-400 mb-2">Tata letak</p>
          <div class="inline-flex rounded-lg overflow-hidden border border-slate-600/70">
            <button type="button" data-layout="1col" class="seg-cols seg-on">1 Kolom</button>
            <button type="button" data-layout="2col" class="seg-cols">2 Kolom</button>
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-6">
        <button type="button" data-modal-close class="flex-1 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/60 hover:bg-slate-700 transition">Batal</button>
        <button type="button" id="print-modal-go" class="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 transition">Cetak / Simpan PDF</button>
      </div>
    </div>
  </div>
  <script>
  (function () {
    var modal = document.getElementById('print-modal');
    function setOpen(open) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      if (open) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }
    function openPrint() {
      if (!modal || !modal.dataset.slug) return;
      var mode = modal.querySelector('input[name="print-mode"]:checked').value;
      var layout = (modal.querySelector('[data-layout].seg-on') || {
        getAttribute: function () { return '1col'; }
      }).getAttribute('data-layout');
      var q = '/p/' + modal.dataset.slug + '?print=1' + (mode === 'kunci' ? '&kunci=1' : '');
      if (layout === '2col') q += '&layout=2col';
      q += '&auto=1';
      window.open(q, '_blank');
    }
    document.querySelectorAll('[data-print-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        modal.dataset.slug = b.getAttribute('data-print-btn');
        setOpen(true);
      });
    });
    modal.querySelectorAll('[data-layout]').forEach(function (b) {
      b.addEventListener('click', function () {
        modal.querySelectorAll('[data-layout]').forEach(function (x) { x.classList.toggle('seg-on', x === b); });
      });
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) setOpen(false); });
    document.querySelectorAll('[data-modal-close]').forEach(function (b) { b.addEventListener('click', function () { setOpen(false); }); });
    document.getElementById('print-modal-go').addEventListener('click', openPrint);
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
  const codeType = (body.code_type as string) || 'html';
  const rawCode = (body.code_content as string || '').trim();

  if (!rawCode) {
    return c.html(errorPage('Isi masih kosong', 'Tempel kode HTML/React atau daftar soal JSON dulu sebelum dipublikasikan.'), 400);
  }

  // ---- Mode JSON Soal: aplikasi kuisnya dibuat otomatis dari spec JSON ----
  if (codeType === 'json') {
    let quiz: QuizSpec | null = null;
    let quizError = '';
    try {
      quiz = parseQuizSpec(rawCode);
    } catch (err) {
      quizError = err instanceof QuizError ? err.message : String(err);
    }
    if (!quiz) return c.html(errorPage('JSON soal belum valid', quizError), 400);

    const title = formTitle || quiz.title || 'Kuis';
    const slug = sanitizeSlug(quiz.slug || formTitle || quiz.title);

    await saveApp(c.env, { title, slug, type: 'json', html: renderQuizApp(quiz, slug) });
    // Spec disimpan supaya skor bisa dihitung ulang di server saat siswa mengirim jawaban.
    await c.env.STORAGE.put(`quiz:${slug}`, JSON.stringify(quiz));
    // JSON mentah dari guru/Gem disimpan utuh sebagai sumber kebenaran editor soal.
    await c.env.STORAGE.put(`quizsource:${slug}`, JSON.stringify(parseQuizJson(rawCode), null, 2));

    return c.redirect('/');
  }

  if (!formTitle) {
    return c.html(errorPage('Judul belum diisi', 'Mode HTML/React butuh judul aplikasi karena dipakai sebagai alamat /p/...'), 400);
  }

  const slug = sanitizeSlug(formTitle);
  const cleanCode = cleanGeminiMarkdown(rawCode);
  const finalHtml = codeType === 'react' ? wrapReactComponent(cleanCode, formTitle) : cleanCode;

  await saveApp(c.env, { title: formTitle, slug, type: codeType, html: finalHtml });

  return c.redirect('/');
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

export default app;