/* ==========================================================================
 * Rute media + panel guru untuk mengunggah foto soal.
 * --------------------------------------------------------------------------
 * Alur yang dipakai guru:
 *   1. Gem menulis soal bergambar dengan token `media:nama-slot`.
 *   2. Tempel JSON-nya di Dashboard -> Publikasikan.
 *   3. Buka /p/<slug>/media -> unggah/potret foto untuk tiap slot.
 *   4. Gambar otomatis muncul di halaman siswa (URL-nya tetap sama, jadi
 *      mengganti foto tidak perlu publish ulang).
 * ========================================================================== */

import type { Hono } from 'hono';
import { isAuthed, safeSlug } from './auth';
import { collectMediaSlotsFromStored, escapeHtml, mediaContextFromRaw, mediaSlotContext, mediaSlotContextFull, parseQuizSpec, sanitizeMediaName } from './quiz';
import { buildGeminiPrompt, generateImage, mediaGenConfig, saveGeneratedMedia, IMGGEN_MODELS } from './media-gen';
import type { MediaGenConfig, MediaGenSettings } from './media-gen';
import {
  MAX_MEDIA_BYTES,
  deleteMedia,
  getMedia,
  listMedia,
  mediaPlaceholder,
  putMedia,
  sniffImageType,
  suggestMediaName,
} from './media';
import type { MediaBindings } from './media';

// Nama gambar TIDAK boleh disaring dengan safeSlug() (dari src/auth.ts), karena
// titik pada nama seperti `foto-1.jpg` akan ikut terbuang dan gambarnya jadi
// tidak ketemu saat disajikan.
function safeMediaName(raw: string): string {
  return sanitizeMediaName(String(raw ?? '').replace(/^media:\s*/i, ''));
}

/**
 * Konfigurasi API gambar yang berlaku untuk satu aplikasi, dengan prioritas:
 *   1. Pengaturan BYOK milik guru (KV `imggencfg:<slug>`), kalau terpasang.
 *   2. Konfigurasi bawaan admin dari env (IMGGEN_API_URL/IMGGEN_API_KEY).
 * Mengembalikan null bila keduanya tidak ada (fitur generate tampil/disembunyikan).
 */
async function resolveGenConfig(
  env: MediaBindings,
  slug: string
): Promise<{ config: MediaGenConfig; model?: string; source: 'app' | 'admin'; settings?: MediaGenSettings } | null> {
  try {
    const raw = await env.STORAGE.get(`imggencfg:${slug}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MediaGenSettings>;
      const apiUrl = String(parsed.apiUrl ?? '').trim();
      const apiKey = String(parsed.apiKey ?? '').trim();
      if (apiUrl && /^https:\/\//i.test(apiUrl) && apiKey) {
        const settings: MediaGenSettings = { apiUrl, apiKey, model: parsed.model ?? undefined };
        return { config: settings, model: settings.model, source: 'app', settings };
      }
    }
  } catch {
    // KV rusak/format salah: jatuh ke konfigurasi bawaan.
  }
  const config = mediaGenConfig(env);
  if (config) return { config, source: 'admin' };
  return null;
}

export function registerMediaRoutes<E extends { Bindings: MediaBindings }>(app: Hono<E>) {
  /* ------------------------------------------------------------------ */
  /* 1. Sajikan gambar ke halaman siswa                                  */
  /* ------------------------------------------------------------------ */
  app.get('/media/:slug/:name', async (c) => {
    const slug = safeSlug(c.req.param('slug'));
    const name = safeMediaName(c.req.param('name'));
    if (!slug || !name) return c.text('Nama media tidak valid', 400);

    const found = await getMedia(c.env, slug, name);
    if (!found) {
      return c.body(mediaPlaceholder(name), 200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
    }

    return c.body(found.body, 200, {
      'Content-Type': found.contentType,
      // URL-nya sengaja stabil (nama slot, bukan nama file acak) supaya mengganti
      // foto tidak perlu publish ulang. Supaya penggantian itu tetap terlihat
      // cepat, cache-nya cuma 1 jam + boleh disajikan basi sambil divalidasi.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  /* ------------------------------------------------------------------ */
  /* 2. Unggah gambar                                                    */
  /* ------------------------------------------------------------------ */
  app.post('/api/media/:slug', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Slug aplikasi tidak valid.' }, 400);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ status: 'error', message: 'Tidak ada file yang dikirim. Pilih foto dulu.' }, 400);
    }
    if (file.size > MAX_MEDIA_BYTES) {
      return c.json(
        {
          status: 'error',
          message: `Foto terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${MAX_MEDIA_BYTES / 1024 / 1024} MB — kecilkan dulu atau pakai alat kompres foto.`,
        },
        413
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = sniffImageType(bytes);
    if (!contentType) {
      return c.json(
        {
          status: 'error',
          message: 'File ini bukan gambar yang didukung. Pakai JPG, PNG, GIF, WebP, AVIF, atau BMP (SVG tidak diterima).',
        },
        415
      );
    }

    // Guru sering menyalin tempel token `media:nama` langsung dari JSON soal.
    const requested = String(body.name ?? '').trim().replace(/^media:\s*/i, '');
    const name = requested ? suggestMediaName(requested, 'gambar') : suggestMediaName(file.name, 'gambar');
    if (!name) {
      return c.json({ status: 'error', message: 'Nama gambar kosong. Tulis nama, misal: fotosintesis.' }, 400);
    }

    await putMedia(c.env, slug, name, bytes.buffer as ArrayBuffer, contentType);

    return c.json({
      status: 'success',
      message: 'Gambar tersimpan.',
      name,
      url: `/media/${slug}/${name}`,
      size: file.size,
      contentType,
    });
  });

  /* ------------------------------------------------------------------ */
  /* 3. Hapus gambar                                                     */
  /* ------------------------------------------------------------------ */
  app.post('/api/media/:slug/delete', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    const body = await c.req.json().catch(() => null);
    const name = safeMediaName(String((body as { name?: string } | null)?.name ?? ''));
    if (!slug || !name) return c.json({ status: 'error', message: 'Nama gambar tidak valid.' }, 400);

    await deleteMedia(c.env, slug, name);
    return c.json({ status: 'success', message: 'Gambar dihapus.' });
  });

  /* ------------------------------------------------------------------ */
  /* 3b. Generate gambar dengan AI (opsional, butuh IMGGEN_API_*)        */
  /* ------------------------------------------------------------------ */
  // Simple rate limit di KV: maksimal N generate per menit per aplikasi,
  // supaya kuota API gratis (100rb panggilan/hari di sisi proxy) tidak dibakar
  // satu aplikasi saja (atau dipakai spam). Kalau KV gagal, izinkan (fail-open)
  // karena ini hanya proteksi kenyamanan, bukan keamanan.
  const GEN_LIMIT_PER_MINUTE = 6;
  app.post('/api/media/:slug/generate', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);

    const resolved = await resolveGenConfig(c.env, slug);
    if (!resolved) {
      return c.json(
        { status: 'error', message: 'Fitur generate AI belum dikonfigurasi. Isi IMGGEN_API_URL dan IMGGEN_API_KEY, atau atur API sendiri di pengaturan "Buat gambar dengan AI".' },
        501
      );
    }

    const bucket = Math.floor(Date.now() / 60000);
    const counterKey = `imggen:${slug}:${bucket}`;
    let used = 0;
    try {
      used = Number((await c.env.STORAGE.get(counterKey)) ?? '0');
      if (used >= GEN_LIMIT_PER_MINUTE) {
        return c.json({ status: 'error', message: 'Batas 6 gambar/menit tercapai. Coba lagi sebentar lagi.' }, 429);
      }
      await c.env.STORAGE.put(counterKey, String(used + 1), { expirationTtl: 120 });
    } catch {
      // KV bermasalah: biarkan lewat, jangan blokir guru.
    }

    const body = (await c.req.json().catch(() => null)) as { prompt?: unknown; name?: unknown; model?: unknown } | null;
    const name = safeMediaName(String(body?.name ?? ''));
    let prompt = String(body?.prompt ?? '').trim();
    // Model pilihan guru dipakai dulu; kalau kosong baru model bawaan (BYOK/admin).
    const model = String(body?.model ?? '').trim().slice(0, 80) || resolved.model;
    if (!name) return c.json({ status: 'error', message: 'Nama slot gambar tidak valid.' }, 400);
    if (!prompt) {
      // Guru tidak menulis deskripsi: ambil konteksnya langsung dari soal supaya
      // tombol generate tetap jalan tanpa perlu mengetik apa-apa.
      const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
      if (specRaw) {
        try {
          prompt = mediaSlotContext(parseQuizSpec(specRaw), name);
        } catch {
          prompt = '';
        }
        if (!prompt) prompt = mediaContextFromRaw(specRaw, name);
      }
      if (!prompt) {
        return c.json({ status: 'error', message: 'Tidak menemukan konteks soal untuk slot ini. Tulis dulu deskripsi gambarnya (minimal 3 karakter).' }, 400);
      }
    }
    if (prompt.length < 3) {
      return c.json({ status: 'error', message: 'Tulis deskripsi gambarnya dulu (minimal 3 karakter).' }, 400);
    }
    if (prompt.length > 700) {
      return c.json({ status: 'error', message: 'Deskripsi terlalu panjang (maksimal 700 karakter).' }, 400);
    }

    const generated = await generateImage(resolved.config, prompt, model);
    if (!generated.ok) return c.json({ status: 'error', message: generated.error }, 502);
    if (generated.bytes.byteLength > MAX_MEDIA_BYTES) {
      return c.json(
        { status: 'error', message: `Hasil gambar melebihi batas ${MAX_MEDIA_BYTES / 1024 / 1024} MB.` },
        502
      );
    }

    await saveGeneratedMedia(c.env, slug, name, generated.bytes, generated.contentType);
    return c.json({
      status: 'success',
      message: 'Gambar berhasil dibuat dan tersimpan.',
      name,
      url: `/media/${slug}/${encodeURIComponent(name)}`,
      size: generated.bytes.byteLength,
      contentType: generated.contentType,
    });
  });

  /* ------------------------------------------------------------------ */
  /* 3c. Pengaturan API gambar sendiri (BYOK) per aplikasi               */
  /* ------------------------------------------------------------------ */
  // Membaca pengaturan BYOK: dipakai panel untuk mengisi formulir. Kunci API
  // milik admin (env) sengaja TIDAK dibocorkan ke sana.
  app.get('/api/media/:slug/gen-config', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis.' }, 401);
    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);
    const resolved = await resolveGenConfig(c.env, slug);
    if (!resolved) return c.json({ status: 'success', config: null });
    return c.json({
      status: 'success',
      config: {
        source: resolved.source,
        apiUrl: resolved.settings?.apiUrl ?? '',
        apiKey: resolved.settings?.apiKey ?? '',
        model: resolved.model ?? '',
      },
    });
  });

  // Menyimpan pengaturan BYOK untuk aplikasi ini. Kirim { apiUrl:'', apiKey:'' }
  // untuk kembali memakai konfigurasi bawaan admin.
  app.post('/api/media/:slug/gen-config', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis.' }, 401);
    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);

    const body = (await c.req.json().catch(() => null)) as { apiUrl?: unknown; apiKey?: unknown; model?: unknown } | null;
    const apiUrl = String(body?.apiUrl ?? '').trim();
    const apiKey = String(body?.apiKey ?? '').trim();
    if (!apiUrl && !apiKey) {
      await c.env.STORAGE.delete(`imggencfg:${slug}`);
      return c.json({ status: 'success', message: 'Sekarang pakai konfigurasi bawaan (admin).' });
    }
    if (!/^https:\/\//i.test(apiUrl)) {
      return c.json({ status: 'error', message: 'Alamat API harus diawali https:// (kunci tidak dikirim ke koneksi tak terenkripsi).' }, 400);
    }
    if (apiKey.length < 6) {
      return c.json({ status: 'error', message: 'API key terlalu pendek (minimal 6 karakter).' }, 400);
    }
    const model = String(body?.model ?? '').trim().slice(0, 80) || undefined;
    const settings: MediaGenSettings = { apiUrl, apiKey, model };
    await c.env.STORAGE.put(`imggencfg:${slug}`, JSON.stringify(settings));
    return c.json({ status: 'success', message: 'Pengaturan API gambar tersimpan untuk aplikasi ini.' });
  });

  /* ------------------------------------------------------------------ */
  /* 4. Panel guru: atur gambar tiap soal                                */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/media', async (c) => {
    if (!isAuthed(c)) return c.redirect('/');

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    const meta = metaRaw ? (JSON.parse(metaRaw) as { title?: string; type?: string }) : null;
    if (!meta) return c.html(errorCard(`/p/${slug}`, 'Aplikasi tidak ditemukan', 'Pastikan alamatnya benar.'), 404);

    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    // Bisa gagal parse bila spec tersimpan tidak lagi diterima parser versi ini;
    // fallback memindai token media: mentah supaya daftar slot tidak jadi kosong.
    const slots = specRaw ? collectMediaSlotsFromStored(specRaw) : [];

    // Konteks tiap slot diambil langsung dari soal: `slotContexts` dipakai mengisi
    // prompt AI secara otomatis (guru tidak perlu menulis deskripsi), sedangkan
    // `slotGeminiContexts` memuat stimulus + konteks soal untuk prompt Gemini.
    // Kalau parser menolak spec tersimpan, konteks dibiarkan kosong.
    const slotContexts = new Map<string, string>();
    const slotGeminiContexts = new Map<string, string>();
    if (specRaw) {
      let parsedQuiz: ReturnType<typeof parseQuizSpec> | null = null;
      try {
        parsedQuiz = parseQuizSpec(specRaw);
      } catch {
        parsedQuiz = null;
      }
      for (const name of slots) {
        const context = parsedQuiz ? mediaSlotContext(parsedQuiz, name) : '';
        const contextFull = parsedQuiz ? mediaSlotContextFull(parsedQuiz, name) : '';
        const fallback = mediaContextFromRaw(specRaw, name);
        slotContexts.set(name, context || fallback);
        slotGeminiContexts.set(name, contextFull || fallback);
      }
    }

    const isJsonQuiz = meta.type === 'json';
    const items = await listMedia(c.env, slug);
    const uploaded = new Map(items.map((item) => [item.name, item]));
    const missing = slots.filter((name) => !uploaded.has(name));
    const storageLabel = c.env.MEDIA ? 'Cloudflare R2' : 'Cloudflare KV';
    // Fitur generate AI tampil bila konfigurasi bawaan admin ATAU pengaturan
    // API milik aplikasi ini (BYOK) terpasang.
    const genConfigResolved = await resolveGenConfig(c.env, slug);
    const genEnabled = !!genConfigResolved;
    const defaultModel = genConfigResolved?.model ?? '';
    const genLimit = GEN_LIMIT_PER_MINUTE;
    const modelOptions = IMGGEN_MODELS.map(
      (m) => `<option value="${escapeHtml(m.id)}"${m.id === defaultModel ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('');

    const slotCards = slots
      .map((name) => {
        const saved = uploaded.get(name);
        const badge = saved
          ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Sudah ada</span>`
          : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">Belum diunggah</span>`;
        const info = saved ? `${(saved.size / 1024).toFixed(0)} KB` : 'Siswa saat ini melihat kotak "Gambar belum diunggah".';
        // Prompt AI diisi otomatis dari konteks soal (boleh diedit guru); prompt
        // Gemini memakai varian lengkap: stimulus + konteks soal.
        const context = slotContexts.get(name) ?? '';
        const geminiPrompt = buildGeminiPrompt(slotGeminiContexts.get(name) ?? context);
        const geminiUrl = 'https://gemini.google.com/app?q=' + encodeURIComponent(geminiPrompt);
        return `
        <div class="bg-slate-800 border border-slate-700 rounded-xl p-3 flex flex-col gap-3">
          <img data-preview="${escapeHtml(name)}" src="/media/${slug}/${escapeHtml(name)}" alt="" class="w-full h-32 object-cover rounded-lg border border-slate-700 bg-slate-900">
          <div class="flex items-center justify-between gap-2">
            <p class="font-mono text-xs text-amber-300 truncate" title="media:${escapeHtml(name)}">media:${escapeHtml(name)}</p>
            ${badge}
          </div>
          <p class="text-[11px] text-slate-500 -mt-1">${escapeHtml(info)}</p>
          <div class="flex items-center gap-2">
            <label class="flex-1 text-center px-3 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-xs font-semibold cursor-pointer transition">
              <i class="fa-solid fa-camera mr-1"></i> Pilih / Potret Foto
              <input type="file" accept="image/*" class="hidden js-file" data-name="${escapeHtml(name)}">
            </label>
            ${
              genEnabled
                ? `<button type="button" class="js-gen-toggle px-3 py-2 bg-violet-600/20 text-violet-300 hover:bg-violet-600 hover:text-white rounded-lg text-xs font-semibold transition" data-name="${escapeHtml(name)}" title="Buat gambar dengan AI"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i> AI</button>`
                : ''
            }
            ${saved ? `<button class="js-delete px-3 py-2 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg text-xs transition" data-name="${escapeHtml(name)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
          ${
            genEnabled
              ? `<div class="js-gen-form hidden flex-col gap-2" data-name="${escapeHtml(name)}">
            <textarea class="js-gen-prompt w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 outline-none focus:border-violet-500" rows="2" placeholder="Prompt terisi otomatis dari konteks soal; boleh diedit dulu...">${escapeHtml(context)}</textarea>
            <div class="flex items-center gap-2">
              <button type="button" class="js-gen-go flex-1 px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Buat Gambar (10\u201330 detik)</button>
              <button type="button" class="js-copy-prompt px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-200 transition" title="Salin prompt untuk membuat gambar ini di gemini.google.com (pakai akun Gemini kamu), lalu unggah hasilnya lewat Pilih / Potret." data-prompt="${escapeHtml(geminiPrompt)}"><i class="fa-brands fa-google mr-1"></i> Salin prompt Gemini</button>
              <button type="button" class="js-gemini-open px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition" title="Buka gemini.google.com di tab baru dan kirim prompt ini langsung tanpa salin-tempel." data-gemini-url="${escapeHtml(geminiUrl)}" data-prompt="${escapeHtml(geminiPrompt)}"><i class="fa-brands fa-google mr-1"></i> Buka di Gemini</button>
            </div>
          </div>`
              : ''
          }
          <p class="text-[11px] text-slate-400 hidden" data-status="${escapeHtml(name)}"></p>
        </div>`;
      })
      .join('');

    const gallery = items.length
      ? items
          .map(
            (item) => `
        <div class="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <img src="/media/${slug}/${escapeHtml(item.name)}" alt="" class="w-full h-28 object-cover bg-slate-900">
          <div class="p-2.5 space-y-1.5">
            <p class="font-mono text-[11px] text-slate-300 truncate" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</p>
            <div class="flex items-center gap-1.5">
              <button class="js-copy flex-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-[11px]" data-url="/media/${slug}/${escapeHtml(item.name)}"><i class="fa-solid fa-link mr-1"></i>Salin URL</button>
              <button class="js-delete px-2 py-1.5 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg text-[11px]" data-name="${escapeHtml(item.name)}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>`
          )
          .join('')
      : `<div class="col-span-full p-8 text-center text-slate-500 text-xs bg-slate-800/40 border border-slate-800 rounded-xl">Belum ada gambar tersimpan untuk aplikasi ini.</div>`;

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gambar Soal - /p/${slug}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6 font-sans">
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
      <div>
        <a href="/" class="text-xs text-blue-400 hover:underline flex items-center gap-1 mb-1">
          <i class="fa-solid fa-arrow-left"></i> Kembali ke Dashboard
        </a>
        <h1 class="text-xl font-bold text-white">Gambar Soal: ${escapeHtml(meta.title ?? slug)}</h1>
        <p class="text-xs text-slate-400 font-mono mt-0.5">/p/${slug} &bull; penyimpanan ${storageLabel} &bull; maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB per gambar</p>
      </div>
      <div class="flex items-center gap-2">
        ${isJsonQuiz ? `<a href="/p/${slug}/edit" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold whitespace-nowrap"><i class="fa-solid fa-pen-to-square mr-1"></i> Edit Soal</a>` : ''}
        <a href="/p/${slug}" target="_blank" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold whitespace-nowrap">
          <i class="fa-solid fa-eye mr-1"></i> Lihat Kuis
        </a>
      </div>
    </div>

    <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-xs text-slate-300 leading-relaxed">
      <p class="font-semibold text-slate-100 mb-1"><i class="fa-solid fa-circle-info text-orange-400 mr-1"></i> Cara kerja</p>
      Soal bergambar ditulis dengan token <code class="font-mono text-amber-300">media:nama-slot</code>. Selama fotonya belum diunggah, siswa melihat kotak
      &ldquo;Gambar belum diunggah&rdquo;. Setelah diunggah di sini, gambarnya langsung muncul tanpa perlu publish ulang
      (kalau belum kelihatan, muat ulang halaman dengan Ctrl+Shift+R supaya salinan lama di browser dibuang).
      Kalau soalmu tidak memakai token, kamu tetap bisa mengunggah gambar di bagian bawah lalu menyalin URL-nya
      (berguna untuk mode HTML/React yang gambarnya di-hardcode).
    </div>
    <div class="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-xs text-emerald-100 leading-relaxed">
      <p class="font-semibold mb-1"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Foto otomatis jadi WebP</p>
      Sebelum dikirim, foto diperkecil (sisi terpanjang maks 1600 px) dan dikonversi ke WebP langsung di perangkatmu,
      jadi kuota tersimpan lebih hemat dan halaman kuis lebih cepat dibuka. Gambar GIF dibiarkan apa adanya supaya
      animasinya tidak hilang, dan kalau browser tidak mendukung konversi, file aslinya tetap terkirim.
    </div>

    ${
      specRaw
        ? `<div>
      <h2 class="text-sm font-bold text-white mb-1 flex items-center gap-2">
        <i class="fa-solid fa-image text-orange-400"></i> Slot gambar dari soal
        <span class="text-xs font-normal ${missing.length ? 'text-rose-400' : 'text-emerald-400'}">${slots.length - missing.length}/${slots.length} terisi</span>
      </h2>
      ${
        slots.length
          ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">${slotCards}</div>`
          : `<p class="text-xs text-slate-500 mt-2">Soal ini belum memakai token <code class="font-mono text-amber-300">media:...</code>. Suruh Gem menambahkan gambar dengan format <code class="font-mono">"image": "media:nama-slot"</code> atau <code class="font-mono">![keterangan](media:nama-slot)</code>.</p>`
      }
    </div>`
        : ''
    }

    <div class="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 text-xs text-violet-100 leading-relaxed">
      <p class="font-semibold mb-1"><i class="fa-solid fa-wand-magic-sparkles text-violet-400 mr-1"></i> Buat gambar dengan AI</p>
      ${
        genEnabled
          ? `Klik <b>AI</b> pada kartu slot: kotak prompnya sudah <b>terisi otomatis dari konteks soal</b> (boleh diedit),
      lalu tunggu 10\u201330 detik. Hasilnya langsung tersimpan ke slot \u2014 tidak perlu unggah manual. Batas ${genLimit} gambar/menit.
      Mau hasil yang lebih apik? Klik <b>Salin prompt Gemini</b>, tempel di <b>gemini.google.com</b> dengan akun Gemini
      kamu sendiri, unduh gambarnya, lalu unggah lewat <b>Pilih / Potret Foto</b>.`
          : `Belum ada API gambar terpasang, jadi tombol <b>AI</b> belum tampil di kartu slot. Kamu bisa <b>Pakai API gambar sendiri (BYOK)</b> di bawah ini (kunci disimpan khusus untuk aplikasi ini), atau minta admin mengatur <code class="font-mono">IMGGEN_API_URL</code> &amp; <code class="font-mono">IMGGEN_API_KEY</code>.`
      }
      <div class="flex flex-col sm:flex-row gap-3 mt-3 pt-3 border-t border-violet-500/20">
        <label class="flex items-center gap-2">
          <span>Model:</span>
          <select id="gen-model" class="bg-slate-900 border border-violet-500/40 rounded-lg text-xs px-2 py-1.5 text-slate-100 outline-none">
            <option value="">Model bawaan</option>
            ${modelOptions}
          </select>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" id="gen-byok-toggle" class="accent-violet-500">
          <span>Pakai API gambar sendiri (BYOK)</span>
        </label>
      </div>
      <div id="gen-byok" class="hidden flex-col gap-2 mt-2">
        <input id="gen-url" type="text" placeholder="Alamat API (https://...), misal proxy free-image-generation-api" class="px-2.5 py-2 bg-slate-900 border border-violet-500/40 rounded-lg text-xs text-slate-100 outline-none">
        <input id="gen-key" type="password" placeholder="API key untuk API tersebut..." class="px-2.5 py-2 bg-slate-900 border border-violet-500/40 rounded-lg text-xs text-slate-100 outline-none">
        <p class="text-[11px] text-violet-300/80">Format API sama seperti bawaan: kirim <code class="font-mono">prompt</code> (dan opsional <code class="font-mono">model</code>) ke alamat di atas dengan header <code class="font-mono">Authorization: Bearer &lt;key&gt;</code>, dan terima gambar mentahnya. Kunci disimpan di KV aplikasi dan hanya bisa dilihat by admin.</p>
        <div class="flex items-center gap-2">
          <button type="button" id="gen-save" class="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white">Simpan pengaturan</button>
          <button type="button" id="gen-reset" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-200">Pakai bawaan (hapus BYOK)</button>
          <span id="gen-byok-status" class="text-[11px]"></span>
        </div>
      </div>
    </div>

    <div>
      <h2 class="text-sm font-bold text-white mb-3 flex items-center gap-2"><i class="fa-solid fa-cloud-arrow-up text-orange-400"></i> Unggah gambar tambahan</h2>
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
        <div class="flex-1">
          <label class="block text-xs mb-1.5 text-slate-300 font-medium">Nama gambar (tanpa spasi)</label>
          <input id="extra-name" type="text" placeholder="misal: peta-indonesia" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white outline-none focus:border-orange-500">
        </div>
        <div class="flex-1">
          <label class="block text-xs mb-1.5 text-slate-300 font-medium">File foto (JPG/PNG/WebP)</label>
          <input id="extra-file" type="file" accept="image/*" class="w-full text-xs text-slate-400 file:mr-2 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-100 file:text-xs">
        </div>
        <button id="extra-upload" class="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-semibold whitespace-nowrap">Unggah</button>
      </div>
      <p id="extra-status" class="text-[11px] text-slate-400 mt-2"></p>
    </div>

    <div>
      <h2 class="text-sm font-bold text-white mb-3 flex items-center gap-2"><i class="fa-solid fa-photo-film text-orange-400"></i> Gambar tersimpan (${items.length})</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${gallery}</div>
    </div>
  </div>

  <script>
(function () {
  var SLUG = ${JSON.stringify(slug)};

  var MAX_SIDE = 1600;

  // Worker tidak bisa mengubah format gambar sendiri, jadi konversi WebP +
  // pengecilan ukuran dikerjakan di perangkat guru sebelum file dikirim.
  function toWebp(file) {
    return new Promise(function (resolve) {
      if (!window.createImageBitmap || file.type === 'image/gif') return resolve(null);
      createImageBitmap(file).then(function (bitmap) {
        var scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (bitmap.close) bitmap.close();
          resolve(blob && blob.type === 'image/webp' ? blob : null);
        }, 'image/webp', 0.82);
      }).catch(function () { resolve(null); });
    });
  }

  function kb(size) { return Math.max(1, Math.round(size / 1024)); }

  function doUpload(name, file, statusNode) {
    if (!file) return;
    var status = function (text) {
      if (!statusNode) return;
      statusNode.classList.remove('hidden');
      statusNode.textContent = text;
    };
    status('Menyiapkan foto (' + kb(file.size) + ' KB)...');

    toWebp(file).then(function (webp) {
      var payload = file;
      var note = '';
      if (webp && webp.size < file.size) {
        payload = webp;
        note = ' - WebP ' + kb(file.size) + ' KB jadi ' + kb(webp.size) + ' KB';
      }
      status('Mengunggah ' + kb(payload.size) + ' KB' + note + '...');

      var form = new FormData();
      form.append('file', payload, 'unggahan.webp');
      form.append('name', name);
      fetch('/api/media/' + encodeURIComponent(SLUG), { method: 'POST', body: form })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok || !result.data || result.data.status !== 'success') {
            throw new Error((result.data && result.data.message) || 'Gagal mengunggah.');
          }
          status('Tersimpan' + note + '. Memuat ulang...');
          window.location.reload();
        })
        .catch(function (error) {
          status('Gagal: ' + error.message);
        });
    });
  }

  function doDelete(name) {
    if (!window.confirm('Hapus gambar "' + name + '"? Soal yang memakainya akan menampilkan kotak placeholder.')) return;
    fetch('/api/media/' + encodeURIComponent(SLUG) + '/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    })
      .then(function (res) { return res.json(); })
      .then(function () { window.location.reload(); })
      .catch(function (error) { alert('Gagal menghapus: ' + error.message); });
  }

  document.querySelectorAll('.js-file').forEach(function (input) {
    input.addEventListener('change', function () {
      var name = input.getAttribute('data-name');
      // Tampilkan pratinjau lokal dulu supaya guru langsung lihat hasil potretannya.
      var preview = document.querySelector('[data-preview="' + name + '"]');
      if (preview && input.files && input.files[0]) preview.src = URL.createObjectURL(input.files[0]);
      doUpload(name, input.files && input.files[0], document.querySelector('[data-status="' + name + '"]'));
    });
  });

  document.querySelectorAll('.js-delete').forEach(function (button) {
    button.addEventListener('click', function () { doDelete(button.getAttribute('data-name')); });
  });

  // ---- Generate gambar dengan AI (tombol AI pada kartu slot) ----
  function currentModel() {
    var select = document.getElementById('gen-model');
    if (select) return select.value || '';
    return '';
  }

  function doGenerate(name, prompt, statusEl) {
    if (!statusEl) return;
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Membuat gambar dengan AI (10\u201330 detik), jangan tutup halaman...';
    fetch('/api/media/' + encodeURIComponent(SLUG) + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, prompt: prompt || '', model: currentModel() })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Gagal membuat gambar.');
        }
        var preview = document.querySelector('[data-preview="' + name + '"]');
        if (preview) preview.src = result.data.url + '?t=' + Date.now();
        statusEl.textContent = 'Gambar AI tersimpan (' + kb(result.data.size) + ' KB).';
      })
      .catch(function (error) {
        statusEl.textContent = 'Gagal: ' + error.message;
      });
  }

  document.querySelectorAll('.js-gen-toggle').forEach(function (button) {
    button.addEventListener('click', function () {
      var name = button.getAttribute('data-name');
      var form = document.querySelector('.js-gen-form[data-name="' + name + '"]');
      if (form) form.classList.toggle('hidden');
    });
  });

  document.querySelectorAll('.js-gen-go').forEach(function (button) {
    button.addEventListener('click', function () {
      var form = button.closest('.js-gen-form');
      if (!form) return;
      var name = form.getAttribute('data-name');
      var prompt = form.querySelector('.js-gen-prompt');
      doGenerate(name, prompt ? prompt.value : '', document.querySelector('[data-status="' + name + '"]'));
    });
  });

  // ---- Pengaturan API gambar sendiri (BYOK) ----
  var byokToggle = document.getElementById('gen-byok-toggle');
  var byokPanel = document.getElementById('gen-byok');
  var byokStatus = document.getElementById('gen-byok-status');
  var modelSelect = document.getElementById('gen-model');

  function setByokVisible(show) {
    if (!byokToggle || !byokPanel) return;
    byokToggle.checked = show;
    byokPanel.classList.toggle('hidden', !show);
    byokPanel.classList.toggle('flex', show);
  }

  if (byokToggle && byokPanel) {
    byokToggle.addEventListener('change', function () {
      setByokVisible(byokToggle.checked);
    });
  }

  function byokMsg(text, ok) {
    if (!byokStatus) return;
    byokStatus.textContent = text;
    byokStatus.style.color = ok ? '#34d399' : '#fb7185';
    setTimeout(function () {
      if (byokStatus && byokStatus.textContent === text) byokStatus.textContent = '';
    }, 4000);
  }

  fetch('/api/media/' + encodeURIComponent(SLUG) + '/gen-config', { method: 'GET' })
    .then(function (res) { return res.json().catch(function () { return null; }); })
    .then(function (data) {
      var cfg = data && data.config;
      if (!cfg) return;
      if (cfg.source === 'app') {
        setByokVisible(true);
        var url = document.getElementById('gen-url');
        var key = document.getElementById('gen-key');
        if (url) url.value = cfg.apiUrl || '';
        if (key) key.value = cfg.apiKey || '';
      }
      if (cfg.model && modelSelect) {
        // Simpan sebagai model bawaan yang tampil di dropdown.
        var matched = Array.prototype.some.call(modelSelect.options, function (opt) { return opt.value === cfg.model; });
        if (!matched) {
          var opt = document.createElement('option');
          opt.value = cfg.model;
          opt.textContent = cfg.model + ' (custom)';
          opt.selected = true;
          modelSelect.appendChild(opt);
        } else {
          modelSelect.value = cfg.model;
        }
      }
    })
    .catch(function () {});

  var saveBtn = document.getElementById('gen-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var url = document.getElementById('gen-url');
      var key = document.getElementById('gen-key');
      var model = modelSelect ? modelSelect.value || '' : '';
      byokMsg('Menyimpan...', true);
      fetch('/api/media/' + encodeURIComponent(SLUG) + '/gen-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: url ? url.value.trim() : '', apiKey: key ? key.value.trim() : '', model: model })
      })
        .then(function (res) { return res.json(); })
.then(function (data) {
          if (data && data.status === 'success') {
            byokMsg(data.message, true);
            setByokVisible(false);
            setTimeout(function () { window.location.reload(); }, 600);
          } else {
            byokMsg((data && data.message) || 'Gagal menyimpan pengaturan.', false);
          }
        })
        .catch(function () { byokMsg('Gagal menyimpan pengaturan.', false); });
    });
  }

  var resetBtn = document.getElementById('gen-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      byokMsg('Menghapus...', true);
      fetch('/api/media/' + encodeURIComponent(SLUG) + '/gen-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: '', apiKey: '' })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.status === 'success') {
            byokMsg(data.message, true);
            setByokVisible(false);
            setTimeout(function () { window.location.reload(); }, 600);
          } else {
            byokMsg((data && data.message) || 'Gagal menghapus pengaturan.', false);
          }
        })
        .catch(function () { byokMsg('Gagal menghapus pengaturan.', false); });
    });
  }

  document.querySelectorAll('.js-copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var url = window.location.origin + button.getAttribute('data-url');
      navigator.clipboard.writeText(url).then(function () {
        var old = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Tersalin';
        setTimeout(function () { button.innerHTML = old; }, 1500);
      });
    });
  });

  // Salin prompt Gemini (data-prompt dibuat server dari konteks soal) supaya guru
  // bisa membuat gambarnya di gemini.google.com dengan akun Gemini sendiri.
  document.querySelectorAll('.js-copy-prompt').forEach(function (button) {
    button.addEventListener('click', function () {
      var prompt = button.getAttribute('data-prompt') || '';
      navigator.clipboard.writeText(prompt).then(function () {
        var old = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Tersalin';
        setTimeout(function () { button.innerHTML = old; }, 1500);
      }).catch(function () {
        alert('Tidak bisa menyalin otomatis. Salin manual prompt dari kotak AI di atas kartu ini.');
      });
    });
  });

  // Buka gemini.google.com di tab baru sambil prompt dikirim otomatis (param ?q=
  // dibaca Gemini: prompt terisi lalu langsung dikirim). Prompt tetap disalin ke
  // clipboard sebagai cadangan kalau prefill tidak terjadi.
  document.querySelectorAll('.js-gemini-open').forEach(function (button) {
    button.addEventListener('click', function () {
      var prompt = button.getAttribute('data-prompt') || '';
      var url = button.getAttribute('data-gemini-url');
      if (url) window.open(url, '_blank', 'noopener');
      navigator.clipboard.writeText(prompt).then(function () {
        var old = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Terkirim ke Gemini';
        setTimeout(function () { button.innerHTML = old; }, 1800);
      }).catch(function () {});
    });
  });

  var extraButton = document.getElementById('extra-upload');
  extraButton.addEventListener('click', function () {
    var nameInput = document.getElementById('extra-name');
    var fileInput = document.getElementById('extra-file');
    var status = document.getElementById('extra-status');
    if (!fileInput.files || !fileInput.files[0]) {
      status.textContent = 'Pilih file dulu.';
      return;
    }
    var name = nameInput.value.trim() || fileInput.files[0].name.replace(/\\.[^.]+$/, '');
    doUpload(name, fileInput.files[0], status);
  });
})();
  </script>
</body>
</html>`);
  });
}

function errorCard(backHref: string, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-900 text-slate-100 min-h-screen grid place-items-center p-6 font-sans">
  <div class="max-w-lg w-full bg-slate-800 border border-slate-700 rounded-2xl p-6">
    <h1 class="text-base font-bold text-rose-400 mb-2">${escapeHtml(title)}</h1>
    <p class="text-sm text-slate-300">${escapeHtml(message)}</p>
    <a href="${escapeHtml(backHref)}" class="inline-block mt-5 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl text-xs font-semibold">Kembali ke Dashboard</a>
  </div>
</body></html>`;
}

/**
 * Dipakai dashboard untuk menandai aplikasi yang gambarnya belum lengkap,
 * supaya guru sadar sebelum siswa membuka kuisnya.
 */
export async function withMediaStats<T extends { slug?: string; type?: string }>(env: MediaBindings, project: T): Promise<T & { media_slots?: number; media_missing?: number }> {
  if (project?.type !== 'json' || !project.slug) return project;
  try {
    const specRaw = await env.STORAGE.get(`quiz:${project.slug}`);
    if (!specRaw) return project;
    const slots = collectMediaSlotsFromStored(specRaw);
    if (!slots.length) return { ...project, media_slots: 0, media_missing: 0 };
    const items = await listMedia(env, project.slug);
    const uploaded = new Set(items.map((item) => item.name));
    return {
      ...project,
      media_slots: slots.length,
      media_missing: slots.filter((name) => !uploaded.has(name)).length,
    };
  } catch {
    return project;
  }
}

