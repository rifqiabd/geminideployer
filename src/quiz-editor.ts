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
import { csrfFor, getSession, safeSlug, verifyCsrfFromRequest } from './auth';
import { syncMediaStats } from './media';
import { writeAppMeta } from './app-index.ts';
import { FAVICON_TAGS } from './favicon.ts';
import { DEFAULT_DURATION_MINUTES, QuizError, escapeHtml, parseQuizSpec, quizToAuthoringSource, renderQuizApp, stampNow } from './quiz';
import type { QuizSpec } from './quiz';
import type { MediaBindings } from './media';
import { messageCard } from './ui-card.ts';
import { noStorePage } from './admin-shared';

type StoredMeta = { title?: string; slug?: string; type?: string; created_at?: string; size?: string };

export function registerQuizEditorRoutes<E extends { Bindings: MediaBindings }>(app: Hono<E>) {
  /* ------------------------------------------------------------------ */
  /* Halaman editor                                                      */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/edit', async (c) => {
    if (!(await getSession(c))) return c.redirect('/');

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
        'Aplikasi ini dibuat dari kode HTML, bukan dari daftar soal JSON, jadi tidak punya butir soal yang bisa diedit. Publish ulang sebagai "JSON Soal" kalau mau memakai editor ini.';
      return c.html(messagePage('Editor soal tidak tersedia untuk aplikasi ini', explanation), 400);
    }

    // `defaultDurationMinutes` disuntik supaya kotak durasi di editor
    // menampilkan angka yang sama dengan default parser (lihat
    // DEFAULT_DURATION_MINUTES di quiz-parse.ts). Kalau salah satu berubah,
    // keduanya harus diubah bareng.
    const embedded = JSON.stringify({ slug, source, synthesized, defaultDurationMinutes: DEFAULT_DURATION_MINUTES }).replace(/</g, '\\u003c');
    const title = meta.title ?? slug;
    // Token CSRF untuk inline JS editor (T4) — dikirim sebagai header
    // X-CSRF-Token pada fetch simpan, bukan field form.
    const editorSession = (await getSession(c))!;
    const csrfToken = await csrfFor(editorSession.npc, c.env.SESSION_SECRET ?? '');

    noStorePage(c);

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Soal - ${escapeHtml(title)}</title>
  <meta name="csrf-token" content="${csrfToken}">
  <script src="https://cdn.tailwindcss.com"></script>
  ${FAVICON_TAGS}
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
    body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;padding-bottom:88px}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit}
    input,textarea,select,button{font-family:inherit}
    input,textarea,select{color:var(--text)}
    .topbar{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .topbar-inner{max-width:820px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .topbar-left{min-width:0;display:flex;align-items:center;gap:12px}
    .brand{width:34px;height:34px;flex:none;border-radius:10px;overflow:hidden;display:block}
    .brand img{width:100%;height:100%;object-fit:contain;display:block}
    .topbar h1{font-size:14px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar .sub{font-size:11px;font-family:'Geist Mono',ui-monospace,monospace;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-actions{display:flex;align-items:center;gap:8px;flex:none}
    .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}
    .btn:hover{background:var(--surface-2)}
    .btn-accent{background:var(--accent);border-color:transparent;color:#fff;padding:7px 14px;font-weight:500}
    .btn-accent:hover{background:var(--accent-hover)}
    main{max-width:820px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow)}
    .card-label{font-size:12.5px;font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:8px}
    .card-label .dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
    .field{margin-bottom:14px}
    .field:last-child{margin-bottom:0}
    .field label{display:block;font-size:12px;font-weight:500;margin-bottom:6px;color:var(--text-secondary)}
    .field input[type=text],.field input[type=number],.field textarea,.field select{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13.5px;color:var(--text);outline:none;transition:border-color .15s}
    .field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent)}
    .field .note{font-size:11px;color:var(--text-faint);margin-top:5px}
    .field .note.warn{color:var(--warn,#c2760a)}
    .field .toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--text);cursor:pointer;margin-bottom:0}
    .field .toggle input{width:auto;accent-color:var(--accent);flex:none;margin:0}
    .field.number{max-width:160px}
    .list-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .list-head h2{font-size:14px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}
    .list-head .dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
    .warn-banner{display:flex;gap:10px;background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);border-radius:var(--radius-sm);padding:12px 14px;font-size:12px;color:var(--warn)}
    .savebar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);border-top:1px solid var(--border);padding:12px 20px}
    .savebar-inner{max-width:820px;margin:0 auto;display:flex;align-items:center;gap:16px}
    .savebar .hint{font-size:11px;color:var(--text-faint);flex:1}
    #qe-questions{display:flex;flex-direction:column;gap:12px}
    details.editor-preview{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
    details.editor-preview summary{cursor:pointer;font-size:12px;font-weight:500;color:var(--text-secondary)}
    #qe-preview{margin:12px 0 0;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre;line-height:1.6}
    #qe-banner.hidden{display:none}
    :is(#qe-title,#qe-description,#qe-kkm),#qe-questions [class]{font-family:inherit}

    /* ===== <select> (mis. "Identitas siswa") =====
       Select tidak pernah ikut aturan .field di atas, jadi dia jatuh ke
       tampilan bawaan browser: font & tinggi beda dari input lain, sudut
       kotak, dan yang paling hurts — di mode gelap teksnya ikut tema
       (--text) sementara latar masih putih UA, jadi isinya nyaris tak
       terbaca. Dua aturan di bawah cuma menyamakan bentuk dan warnanya;
       <option> juga diwarnai karena daftar native tidak mengikuti warna
       elemennya. */
    select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;outline:none;transition:border-color .15s;cursor:pointer}
    select:focus{border-color:var(--accent)}
    option{background:var(--bg);color:var(--text)}
    /* Panah dropdown sendiri disembunyikan lalu diganti chevron supaya ujungnya
       ikut membulat dan posisinya sama di semua OS. */
    .field select{
      appearance:none;-webkit-appearance:none;
      padding-right:34px;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 11px center;background-size:14px;
    }
    /* Select tipe soal dibuat quiz-editor.js di dalam kartu Tailwind, bukan
       .field: warna & ukurannya sudah dari kelas utilitas, jadi yang kurang
       cuma cincin fokus. Butuh !important karena shim .border-slate-700 di
       atas memaksa border-color dan tidak kalah oleh selector biasa. */
    select[data-field=type]:focus{border-color:var(--accent)!important}

    /* ===== repaint editor cards (Tailwind classes injected by quiz-editor.js) ===== */
    .bg-slate-800{background-color:var(--surface)!important}
    .bg-slate-800\/40{background-color:var(--surface)!important}
    .bg-slate-900{background-color:var(--bg)!important}
    .bg-slate-900\/60{background-color:var(--surface)!important}
    .bg-slate-700\/40{background-color:color-mix(in srgb,var(--surface-2) 65%,transparent)!important}
    .bg-slate-950{background-color:var(--bg)!important}
    .border-slate-700,.border-slate-800{border-color:var(--border)!important}
    .border-slate-700\/60{border-color:var(--border)!important}
    .text-white{color:var(--text)!important}
    .text-slate-300{color:var(--text-secondary)!important}
    .text-slate-400{color:var(--text-secondary)!important}
    .text-slate-500{color:var(--text-faint)!important}
    .text-blue-400{color:var(--accent)!important}
    .accent-orange-500{accent-color:var(--accent)!important}
    input[type=radio]{accent-color:var(--accent)!important;accent-color:var(--accent)}
    .bg-rose-500\/15{background:var(--danger-soft)!important}
    .border-rose-500\/40{border-color:color-mix(in srgb,var(--danger) 35%,transparent)!important}
    .text-rose-200{color:var(--danger)!important}
    .bg-emerald-500\/15{background:var(--ok-soft)!important}
    .border-emerald-500\/40{border-color:color-mix(in srgb,var(--ok) 35%,transparent)!important}
    .text-emerald-200{color:var(--ok)!important}
    .bg-amber-500\/10{background:var(--warn-soft)!important}
    .border-amber-500\/30{border-color:color-mix(in srgb,var(--warn) 35%,transparent)!important}
    .text-amber-200{color:var(--warn)!important}
    :is(.hover\:bg-slate-600,.hover\:bg-rose-600\/40):hover{background:color-mix(in srgb,var(--surface-2) 85%,transparent)!important}
    :is(.hover\:text-rose-200,.hover\:text-rose-300):hover{color:var(--danger)!important}
    .hover\:text-rose-300{color:var(--text-secondary)!important}
    .hover\:text-rose-200{color:var(--text-secondary)!important}
  </style>
</head>
<body>

  <nav class="topbar">
    <div class="topbar-inner">
      <div class="topbar-left">
        <a class="brand" href="/" title="Kembali ke Dashboard" aria-label="Kembali ke Dashboard">
          <img src="/assets/logoapps.jpg" alt="" width="34" height="34" decoding="async">
        </a>
        <div class="min-w-0">
          <h1>Edit Soal: ${escapeHtml(title)}</h1>
          <div class="sub">/p/${escapeHtml(slug)} &bull; <span id="qe-count">0 soal</span></div>
        </div>
      </div>
      <div class="topbar-actions">
        <a href="/p/${escapeHtml(slug)}/media" class="btn"><i class="fa-solid fa-image"></i>Gambar</a>
        <a href="/p/${escapeHtml(slug)}" target="_blank" class="btn btn-accent"><i class="fa-solid fa-eye"></i>Lihat Kuis</a>
      </div>
    </div>
  </nav>

  <main>
    <div id="qe-banner" class="hidden"></div>

    ${
      synthesized
        ? `<div class="warn-banner">
      <i class="fa-solid fa-circle-info" style="margin-top:2px"></i>
      <div>
        <b>Soal ini disusun ulang dari data kuis yang tersimpan</b><br>
        Kuis ini dideploy sebelum editor ada, jadi JSON aslinya belum tersimpan. Susunan ulang ini tetap bisa diedit, tapi
        jawaban isian singkat bisa tampil sudah dinormalisasi (huruf kecil, tanpa harakat). Periksa sebentar sebelum menyimpan;
        setelah disimpan sekali, JSON-nya tersimpan rapi.
      </div>
    </div>`
        : ''
    }

    <div class="card">
      <h2 class="card-label"><span class="dot"></span>Identitas asesmen</h2>
      <div class="field">
        <label for="qe-title">Judul</label>
        <input id="qe-title" type="text" placeholder="Judul asesmen">
        <p class="note">Mengubah judul tidak mengubah alamat /p/${escapeHtml(slug)} supaya link yang sudah dibagikan ke siswa tetap jalan.</p>
      </div>
      <div class="field">
        <label for="qe-description">Petunjuk / deskripsi</label>
        <textarea id="qe-description" rows="2" placeholder="Petunjuk pengerjaan (boleh dikosongkan)"></textarea>
      </div>
      <div class="field number">
        <label for="qe-kkm">Nilai minimal lulus</label>
        <input id="qe-kkm" type="number" min="0" max="100">
      </div>
      <div class="field number">
        <label for="qe-duration">Durasi latihan (menit)</label>
        <input id="qe-duration" type="number" min="0" max="600" placeholder="90">
        <p class="note">Batas ${DEFAULT_DURATION_MINUTES} menit sudah terisi di atas; ubah angkanya untuk menyesuaikan. Kosongkan seluruh isian (0) kalau kuis ini memang tanpa timer. Penghitung waktu di perangkat siswa; jawaban dikirim otomatis saat waktu habis. Hanya pengingat — bukan pengawasan ujian.</p>
      </div>
      <div class="field">
        <label for="qe-identity">Identitas siswa</label>
        <select id="qe-identity">
          <option value="name">Nama saja (perilaku lama)</option>
          <option value="name_class">Nama + kelas (dua kolom, kelas wajib)</option>
        </select>
        <p class="note">Kelas tersimpan terpisah di rekap supaya mudah difilter per kelas.</p>
      </div>
      <div class="field">
        <label class="toggle">
          <input type="checkbox" id="qe-item-feedback">
          <span>Tampilkan status benar/salah per soal <em style="font-style:normal;font-size:11px;color:var(--text-faint);font-weight:400">(default)</em></span>
        </label>
        <p class="note warn">Aktif secara default: siswa melihat status Benar/Salah per soal. Matikan untuk kuis ulangan — kuis publik boleh dikerjakan berulang, jadi saat ini aktif siswa bisa menebak kunci dengan mengganti satu jawaban lalu melihat soal mana yang berubah status. Jawaban benarnya sendiri tidak pernah dikirim ke browser, yang tampil hanya statusnya.</p>
      </div>
    </div>

    <div class="list-head">
      <h2><span class="dot"></span>Daftar soal</h2>
      <button id="qe-add" type="button" class="btn"><i class="fa-solid fa-plus"></i>Tambah Soal</button>
    </div>

    <div id="qe-questions"></div>

    <details class="editor-preview">
      <summary id="qe-preview-toggle">Lihat JSON yang akan disimpan</summary>
      <pre id="qe-preview"></pre>
    </details>
  </main>

  <div class="savebar">
    <div class="savebar-inner">
      <p class="hint">Perubahan langsung terlihat siswa setelah disimpan. Jawaban yang sudah masuk tetap tersimpan apa adanya.</p>
      <button id="qe-save" type="button" class="btn btn-accent"><i class="fa-solid fa-floppy-disk"></i>Simpan Perubahan</button>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script>window.QUIZ_EDITOR = ${embedded};</script>
  <script src="/vendor/quiz-editor.js"></script>
</body>
</html>`);
  });

  /* ------------------------------------------------------------------ */
  /* Simpan perubahan                                                    */
  /* ------------------------------------------------------------------ */
  app.post('/api/quiz/:slug/save', async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);
    if (!(await verifyCsrfFromRequest(c, session, c.env.SESSION_SECRET ?? ''))) {
      return c.json({ status: 'error', message: 'Token keamanan tidak valid. Muat ulang halaman editor.' }, 403);
    }

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
    // Slot media bisa berubah karena guru edit soal, jadi statistik di meta
    // disegarkan ulang di sini juga (bukan cuma saat gambar diunggah/dihapus).
    await syncMediaStats(c.env, slug);
    await writeAppMeta(c.env, {
      ...meta,
      title,
      type: 'json',
      updated_at: stampNow(),
      size: (new TextEncoder().encode(html).length / 1024).toFixed(1) + ' KB',
    });

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
  return messageCard({ title, message, backHref: '/', tone: 'danger' });
}
