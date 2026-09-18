/* ==========================================================================
 * Editor soal untuk aplikasi mode "JSON Soal".
 * --------------------------------------------------------------------------
 * Aplikasi kuis di sini disimpan sebagai JSON (bukan HTML jadi), jadi soal bisa
 * diperbaiki guru tanpa perlu bolak-balik minta Gemini: ubah teks, kunci,
 * bobot, atau gambar, lalu simpan. Halaman siswa langsung ikut berubah.
 *
 * Sumber kebenaran ada di `quizsource:<slug>` (JSON mentah dari Gemini/dashboard).
 * Saat menyimpan, JSON itu divalidasi ulang lewat parseQuizSpec, lalu hasil
 * normalisasinya dipakai menggambar ulang halaman kuis di `html:<slug>`.
 * ========================================================================== */

import type { Hono } from 'hono';
import { isAuthed, safeSlug } from './auth';
import { QuizError, escapeHtml, parseQuizSpec, quizToAuthoringSource, renderQuizApp } from './quiz';
import type { QuizSpec } from './quiz';
import type { MediaBindings } from './media';

type StoredMeta = { title?: string; slug?: string; type?: string; created_at?: string; size?: string };

export function registerQuizEditorRoutes<E extends { Bindings: MediaBindings }>(app: Hono<E>) {
  /* ------------------------------------------------------------------ */
  /* Halaman editor                                                      */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/edit', async (c) => {
    if (!isAuthed(c)) return c.redirect('/');

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    if (!metaRaw) return c.html(messagePage('Aplikasi tidak ditemukan', `Tidak ada aplikasi di /p/${slug}.`), 404);

    const meta = JSON.parse(metaRaw) as StoredMeta;
    const sourceRaw = await c.env.STORAGE.get(`quizsource:${slug}`);
    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);

    let source: Record<string, unknown> | null = null;
    let synthesized = false;
    let problem = '';

    if (sourceRaw) {
      try {
        source = JSON.parse(sourceRaw) as Record<string, unknown>;
      } catch {
        source = null;
      }
    }

    // Kuis lama (dideploy sebelum editor ada) belum menyimpan JSON aslinya.
    // Susun ulang dari spec yang tersimpan supaya tetap bisa diedit.
    if (!source && specRaw) {
      try {
        source = quizToAuthoringSource(parseQuizSpec(specRaw));
        synthesized = true;
      } catch (error) {
        problem = error instanceof QuizError ? error.message : String(error);
      }
    }

    if (!source) {
      const explanation =
        problem ||
        'Aplikasi ini dideploy dari kode HTML/React, bukan dari daftar soal JSON, jadi tidak punya butir soal yang bisa diedit. Deploy ulang memakai mode "JSON Soal" kalau mau memakai editor ini.';
      return c.html(messagePage('Editor soal tidak tersedia untuk aplikasi ini', explanation), 400);
    }

    const embedded = JSON.stringify({ slug, source, synthesized }).replace(/</g, '\\u003c');
    const title = meta.title ?? slug;

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Soal - ${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans pb-24">
  <nav class="bg-slate-800/80 border-b border-slate-700/60 p-4 sticky top-0 z-40 backdrop-blur">
    <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
      <div class="min-w-0">
        <a href="/" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-arrow-left mr-1"></i>Dashboard</a>
        <h1 class="text-base font-bold text-white truncate">Edit Soal: ${escapeHtml(title)}</h1>
        <p class="text-[11px] text-slate-400 font-mono">/p/${escapeHtml(slug)} &bull; <span id="qe-count">0 soal</span></p>
      </div>
      <div class="flex items-center gap-2 flex-none">
        <a href="/p/${escapeHtml(slug)}/media" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold whitespace-nowrap"><i class="fa-solid fa-image mr-1"></i>Gambar</a>
        <a href="/p/${escapeHtml(slug)}" target="_blank" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold whitespace-nowrap"><i class="fa-solid fa-eye mr-1"></i>Lihat Kuis</a>
      </div>
    </div>
  </nav>

  <main class="max-w-4xl mx-auto p-4 space-y-4">
    <div id="qe-banner" class="hidden"></div>

    ${
      synthesized
        ? `<div class="rounded-xl p-4 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 leading-relaxed">
      <p class="font-semibold mb-1"><i class="fa-solid fa-circle-info mr-1"></i>Soal ini disusun ulang dari data kuis yang tersimpan</p>
      Kuis ini dideploy sebelum editor ada, jadi JSON aslinya belum tersimpan. Susunan ulang ini tetap bisa diedit, tapi
      jawaban isian singkat bisa tampil sudah dinormalisasi (huruf kecil, tanpa harakat). Periksa sebentar sebelum menyimpan;
      setelah disimpan sekali, JSON-nya tersimpan rapi.
    </div>`
        : ''
    }

    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3">
      <h2 class="text-sm font-bold text-white"><i class="fa-solid fa-circle-info text-orange-400 mr-1"></i>Identitas asesmen</h2>
      <div>
        <label class="block text-xs mb-1.5 text-slate-300 font-medium">Judul</label>
        <input id="qe-title" type="text" placeholder="Judul asesmen" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-orange-500">
        <p class="text-[11px] text-slate-500 mt-1">Mengubah judul tidak mengubah alamat /p/${escapeHtml(slug)} supaya link yang sudah dibagikan ke siswa tetap jalan.</p>
      </div>
      <div>
        <label class="block text-xs mb-1.5 text-slate-300 font-medium">Petunjuk / deskripsi</label>
        <textarea id="qe-description" rows="2" placeholder="Petunjuk pengerjaan (boleh dikosongkan)" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-orange-500"></textarea>
      </div>
      <div class="w-40">
        <label class="block text-xs mb-1.5 text-slate-300 font-medium">Nilai minimal lulus</label>
        <input id="qe-kkm" type="number" min="0" max="100" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-orange-500">
      </div>
    </div>

    <div class="flex items-center justify-between">
      <h2 class="text-sm font-bold text-white"><i class="fa-solid fa-list-ol text-orange-400 mr-1"></i>Daftar soal</h2>
      <button id="qe-add" type="button" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold"><i class="fa-solid fa-plus mr-1"></i>Tambah Soal</button>
    </div>

    <div id="qe-questions" class="space-y-3"></div>

    <details class="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
      <summary id="qe-preview-toggle" class="cursor-pointer text-xs font-semibold text-slate-300">Lihat JSON yang akan disimpan</summary>
      <pre id="qe-preview" class="mt-3 p-3 bg-slate-950 rounded-lg text-[11px] text-slate-300 overflow-x-auto whitespace-pre"></pre>
    </details>
  </main>

  <div class="fixed left-0 right-0 bottom-0 z-30 bg-slate-900/95 border-t border-slate-700 p-3 backdrop-blur">
    <div class="max-w-4xl mx-auto flex items-center gap-3">
      <p class="text-[11px] text-slate-400 flex-1 hidden sm:block">Perubahan langsung terlihat siswa setelah disimpan. Jawaban yang sudah masuk tetap tersimpan apa adanya.</p>
      <button id="qe-save" type="button" class="w-full sm:w-auto px-5 py-2.5 bg-orange-600 hover:bg-orange-500 rounded-xl text-sm font-semibold"><i class="fa-solid fa-floppy-disk mr-1"></i>Simpan Perubahan</button>
    </div>
  </div>

  <script>window.QUIZ_EDITOR = ${embedded};</script>
  <script src="/vendor/quiz-editor.js"></script>
</body>
</html>`);
  });

  /* ------------------------------------------------------------------ */
  /* Simpan perubahan                                                    */
  /* ------------------------------------------------------------------ */
  app.post('/api/quiz/:slug/save', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    if (!metaRaw) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);

    const meta = JSON.parse(metaRaw) as StoredMeta;
    if (meta.type !== 'json') {
      return c.json({ status: 'error', message: 'Hanya aplikasi mode "JSON Soal" yang bisa diedit di sini.' }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as { source?: unknown } | null;
    const source = typeof body?.source === 'string' ? body.source : body?.source ? JSON.stringify(body.source) : '';
    if (!source.trim()) return c.json({ status: 'error', message: 'Tidak ada data soal yang dikirim.' }, 400);

    let spec: QuizSpec;
    try {
      spec = parseQuizSpec(source);
    } catch (error) {
      return c.json(
        { status: 'error', message: error instanceof QuizError ? error.message : `Soal belum bisa dibaca: ${String(error)}` },
        400
      );
    }

    const title = spec.title || meta.title || slug;
    const html = renderQuizApp(spec, slug);
    const pretty = JSON.stringify(JSON.parse(source), null, 2);

    await c.env.STORAGE.put(`quizsource:${slug}`, pretty);
    await c.env.STORAGE.put(`quiz:${slug}`, JSON.stringify(spec));
    await c.env.STORAGE.put(`html:${slug}`, html);
    await c.env.STORAGE.put(
      `meta:${slug}`,
      JSON.stringify({
        ...meta,
        title,
        type: 'json',
        updated_at: new Date().toISOString().substring(0, 10),
        size: (new TextEncoder().encode(html).length / 1024).toFixed(1) + ' KB',
      })
    );

    return c.json({
      status: 'success',
      message: 'Soal tersimpan.',
      title,
      questions: spec.questions.length,
      essay: spec.questions.filter((question) => question.type === 'essay').length,
    });
  });
}

function messagePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-900 text-slate-100 min-h-screen grid place-items-center p-6 font-sans">
  <div class="max-w-lg w-full bg-slate-800 border border-slate-700 rounded-2xl p-6">
    <h1 class="text-base font-bold text-rose-400 mb-2">${escapeHtml(title)}</h1>
    <p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(message)}</p>
    <a href="/" class="inline-block mt-5 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl text-xs font-semibold">Kembali ke Dashboard</a>
  </div>
</body></html>`;
}
