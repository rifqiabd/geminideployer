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

import type { Hono, Context } from 'hono';
import { csrfFor, getSession, safeSlug, verifyCsrfFromRequest } from './auth.ts';
import { collectMediaSlotsFromStored, escapeHtml, mediaContextFromRaw, mediaSlotContext, mediaSlotContextFull, parseQuizSpec, sanitizeMediaName } from './quiz.ts';
import { buildGeminiPrompt, generateImage, mediaGenConfig, saveGeneratedMedia, IMGGEN_MODELS } from './media-gen.ts';
import type { MediaGenConfig, MediaGenSettings } from './media-gen.ts';
import {
  MAX_MEDIA_BYTES,
  deleteMedia,
  getMedia,
  listMedia,
  listMediaNames,
  mediaWriteCapError,
  mediaPlaceholder,
  putMedia,
  sniffImageType,
  suggestMediaName,
  touchMeta,
} from './media.ts';
import type { MediaBindings } from './media.ts';

// Nama gambar TIDAK boleh disaring dengan safeSlug() (dari src/auth.ts), karena
// titik pada nama seperti `foto-1.jpg` akan ikut terbuang dan gambarnya jadi
// tidak ketemu saat disajikan.
function safeMediaName(raw: string): string {
  return sanitizeMediaName(String(raw ?? '').replace(/^media:\s*/i, ''));
}

/**
 * Guard admin untuk endpoint media (T4): sesi valid + token CSRF cocok
 * (header X-CSRF-Token dari inline JS, atau field _csrf dari form).
 * Mengembalikan Response bila ditolak, atau null bila boleh lanjut.
 * parseBody() di Hono di-cache per request, jadi membacanya dua kali (di sini
 * untuk CSRF, lalu di handler untuk payload) tidak mengonsumsi body dua kali.
 */
async function denyMediaRequest<E extends { Bindings: MediaBindings }>(c: Context<E>): Promise<Response | null> {
  const session = await getSession(c);
  if (!session) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);
  if (!(await verifyCsrfFromRequest(c, session, c.env.SESSION_SECRET ?? ''))) {
    return c.json({ status: 'error', message: 'Token keamanan tidak valid. Muat ulang halaman panel gambar.' }, 403);
  }
  return null;
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
    const denied = await denyMediaRequest(c);
    if (denied) return denied;

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

    // Write cap 200 slot per aplikasi (bug lama: upload ke-201 berhasil tapi
    // tak terlihat oleh list). Menimpa slot yang sudah ada tetap diizinkan —
    // revisi foto tidak boleh terblokir oleh cap.
    const capError = mediaWriteCapError(await listMediaNames(c.env, slug), name);
    if (capError) return c.json({ status: 'error', message: capError }, 409);

    await putMedia(c.env, slug, name, bytes.buffer as ArrayBuffer, contentType);
    await touchMeta(c.env, slug);

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
    const denied = await denyMediaRequest(c);
    if (denied) return denied;

    const slug = safeSlug(c.req.param('slug'));
    const body = await c.req.json().catch(() => null);
    const name = safeMediaName(String((body as { name?: string } | null)?.name ?? ''));
    if (!slug || !name) return c.json({ status: 'error', message: 'Nama gambar tidak valid.' }, 400);

    await deleteMedia(c.env, slug, name);
    await touchMeta(c.env, slug);
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
    const denied = await denyMediaRequest(c);
    if (denied) return denied;

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
    // Write cap juga di jalur generate AI: tolak SEBELUM kuota proxy dibakar,
    // supaya aplikasi penuh tidak menghasilkan gambar yang tidak akan terlihat.
    const capError = mediaWriteCapError(await listMediaNames(c.env, slug), name);
    if (capError) return c.json({ status: 'error', message: capError }, 409);
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
    await touchMeta(c.env, slug);
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
  // Membaca pengaturan BYOK untuk panel. Kunci TIDAK pernah dikirim balik
  // (T7): panel hanya menerima flag `hasKey`, jadi kunci guru tidak tersimpan
  // di DOM dan tidak bisa diambil lewat devtools. Respons memakai no-store
  // karena isinya konfigurasi internal per aplikasi.
  app.get('/api/media/:slug/gen-config', async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ status: 'error', message: 'Sesi login habis.' }, 401);
    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);
    const resolved = await resolveGenConfig(c.env, slug);
    c.header('Cache-Control', 'no-store');
    if (!resolved) return c.json({ status: 'success', config: null });
    return c.json({
      status: 'success',
      config: {
        source: resolved.source,
        apiUrl: resolved.settings?.apiUrl ?? '',
        hasKey: Boolean(resolved.settings?.apiKey),
        model: resolved.model ?? '',
      },
    });
  });

  // Menyimpan pengaturan BYOK untuk aplikasi ini (T7):
  //   { apiUrl:'', apiKey:'' }            -> hapus, kembali ke konfigurasi admin
  //   { apiUrl terisi, apiKey kosong }    -> perbarui URL/model, JAGA kunci lama
  //   { apiKey terisi }                   -> ganti kunci (validasi https + panjang)
  // Tanpa semantik "jaga kunci", kunci guru hilang diam-diam begitu panel
  // dibuka lalu disimpan, karena kunci tidak lagi dikirim balik ke form.
  app.post('/api/media/:slug/gen-config', async (c) => {
    const denied = await denyMediaRequest(c);
    if (denied) return denied;
    const slug = safeSlug(c.req.param('slug'));
    if (!slug) return c.json({ status: 'error', message: 'Aplikasi tidak ditemukan.' }, 404);

    const body = (await c.req.json().catch(() => null)) as { apiUrl?: unknown; apiKey?: unknown; model?: unknown } | null;
    const apiUrl = String(body?.apiUrl ?? '').trim();
    const apiKey = String(body?.apiKey ?? '').trim();
    const model = String(body?.model ?? '').trim().slice(0, 80) || undefined;
    if (!apiUrl && !apiKey) {
      // Keduanya kosong: kembali ke konfigurasi bawaan admin.
      await c.env.STORAGE.delete(`imggencfg:${slug}`);
      return c.json({ status: 'success', message: 'Sekarang pakai konfigurasi bawaan (admin).' });
    }
    if (!apiUrl) {
      return c.json({ status: 'error', message: 'Alamat API harus diisi.' }, 400);
    }
    if (!/^https:\/\//i.test(apiUrl)) {
      return c.json({ status: 'error', message: 'Alamat API harus diawali https:// (kunci tidak dikirim ke koneksi tak terenkripsi).' }, 400);
    }
    if (!apiKey) {
      // Kunci tidak diketik ulang: pertahankan kunci yang tersimpan agar
      // membuka panel lalu menyimpan tidak menghapus kunci BYOK diam-diam.
      let oldKey = '';
      try {
        const raw = await c.env.STORAGE.get(`imggencfg:${slug}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { apiKey?: unknown };
          oldKey = String(parsed.apiKey ?? '').trim();
        }
      } catch {
        // KV rusak: diperlakukan seperti tidak ada kunci lama.
      }
      if (!oldKey) {
        return c.json({ status: 'error', message: 'API key masih kosong. Isi kunci minimal 6 karakter, atau hapus pengaturan ini untuk kembali ke konfigurasi admin.' }, 400);
      }
      const settings: MediaGenSettings = { apiUrl, apiKey: oldKey, model };
      await c.env.STORAGE.put(`imggencfg:${slug}`, JSON.stringify(settings));
      return c.json({ status: 'success', message: 'Pengaturan API gambar tersimpan (kunci lama dipertahankan).' });
    }
    if (apiKey.length < 6) {
      return c.json({ status: 'error', message: 'API key terlalu pendek (minimal 6 karakter).' }, 400);
    }
    const settings: MediaGenSettings = { apiUrl, apiKey, model };
    await c.env.STORAGE.put(`imggencfg:${slug}`, JSON.stringify(settings));
    return c.json({ status: 'success', message: 'Pengaturan API gambar tersimpan untuk aplikasi ini.' });
  });

  /* ------------------------------------------------------------------ */
  /* 4. Panel guru: atur gambar tiap soal                                */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/media', async (c) => {
    if (!(await getSession(c))) return c.redirect('/');

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
    // Token CSRF untuk seluruh inline JS panel gambar (T4). Session dijamin
    // ada — guard redirect di atas baris pertama handler sudah lolos.
    const panelSession = (await getSession(c))!;
    const csrfToken = await csrfFor(panelSession.npc, c.env.SESSION_SECRET ?? '');
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
          ? `<span class="m-badge ok">Sudah ada</span>`
          : `<span class="m-badge missing">Belum diunggah</span>`;
        const info = saved ? `${(saved.size / 1024).toFixed(0)} KB` : 'Siswa saat ini melihat kotak "Gambar belum diunggah".';
        // Prompt AI diisi otomatis dari konteks soal (boleh diedit guru); prompt
        // Gemini memakai varian lengkap: stimulus + konteks soal.
        const context = slotContexts.get(name) ?? '';
        const geminiPrompt = buildGeminiPrompt(slotGeminiContexts.get(name) ?? context);
        const geminiUrl = 'https://gemini.google.com/app?q=' + encodeURIComponent(geminiPrompt);
        return `
        <div class="m-slot">
          <img data-preview="${escapeHtml(name)}" src="/media/${slug}/${escapeHtml(name)}" alt="" class="m-slot-img">
          <div class="m-slot-body">
            <div class="m-slot-head">
              <p class="m-slot-token" title="media:${escapeHtml(name)}">media:${escapeHtml(name)}</p>
              ${badge}
            </div>
            <p class="m-slot-info">${escapeHtml(info)}</p>
            <div class="m-slot-actions">
              <label class="m-btn m-btn-primary m-file">
                <i class="fa-solid fa-camera"></i> Pilih / Potret Foto
                <input type="file" accept="image/*" class="hidden js-file" data-name="${escapeHtml(name)}">
              </label>
              ${
                genEnabled
                  ? `<button type="button" class="m-btn m-btn-ai js-gen-toggle" data-name="${escapeHtml(name)}" title="Buat gambar dengan AI"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</button>`
                  : ''
              }
              ${saved ? `<button class="m-btn m-btn-del js-delete" data-name="${escapeHtml(name)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
            ${
              genEnabled
                ? `<div class="js-gen-form hidden" data-name="${escapeHtml(name)}">
            <textarea class="js-gen-prompt m-gen-prompt" rows="2" placeholder="Prompt terisi otomatis dari konteks soal; boleh diedit dulu...">${escapeHtml(context)}</textarea>
            <div class="m-gen-actions">
              <button type="button" class="m-btn m-btn-ai m-gen-go js-gen-go"><i class="fa-solid fa-wand-magic-sparkles"></i> Buat Gambar (10\u201330 detik)</button>
              <button type="button" class="m-btn js-copy-prompt" title="Salin prompt untuk membuat gambar ini di gemini.google.com (pakai akun Gemini kamu), lalu unggah hasilnya lewat Pilih / Potret." data-prompt="${escapeHtml(geminiPrompt)}"><i class="fa-brands fa-google"></i> Salin prompt Gemini</button>
              <button type="button" class="m-btn m-btn-google js-gemini-open" title="Buka gemini.google.com di tab baru dan kirim prompt ini langsung tanpa salin-tempel." data-gemini-url="${escapeHtml(geminiUrl)}" data-prompt="${escapeHtml(geminiPrompt)}"><i class="fa-brands fa-google"></i> Buka di Gemini</button>
            </div>
          </div>`
                : ''
            }
            <p class="m-status hidden" data-status="${escapeHtml(name)}"></p>
          </div>
        </div>`;
      })
      .join('');

    const gallery = items.length
      ? items
          .map(
            (item) => `
        <div class="m-gallery-item">
          <img src="/media/${slug}/${escapeHtml(item.name)}" alt="" class="m-gallery-img">
          <div class="m-gallery-body">
            <p class="m-gallery-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</p>
            <div class="m-gallery-actions">
              <button class="m-btn m-btn-small js-copy flex-1" data-url="/media/${slug}/${escapeHtml(item.name)}"><i class="fa-solid fa-link"></i>Salin URL</button>
              <button class="m-btn m-btn-small m-btn-del js-delete" data-name="${escapeHtml(item.name)}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>`
          )
          .join('')
      : `<div class="m-empty">Belum ada gambar tersimpan untuk aplikasi ini.</div>`;

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gambar Soal - /p/${slug}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%237c3aed'/%3E%3Ctext x='32' y='43' font-family='Arial' font-size='32' font-weight='bold' text-anchor='middle' fill='white'%3ESQ%3C/text%3E%3C/svg%3E">
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
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;box-shadow:var(--shadow)}
    .card-title{font-size:14px;font-weight:600;margin:0 0 6px;display:flex;align-items:center;gap:8px}
    .card-title .ico{color:var(--accent)}
    .card-text{font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin:0}
    .card-text code{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;color:var(--accent);background:var(--accent-soft);padding:1px 5px;border-radius:5px}
    .card h2{margin:0 0 8px}
    .info-card .card-title{color:var(--text)}
    .info-card.webp{border-color:color-mix(in srgb,var(--ok) 30%,transparent);background:var(--ok-soft)}
    .info-card.webp .card-title{color:var(--ok)}
    .info-card.webp .card-text{color:var(--text-secondary)}
    .ai-panel{border-color:color-mix(in srgb,var(--accent) 32%,transparent);background:var(--accent-soft)}
    .ai-panel .card-text{color:var(--text-secondary)}
    .ai-panel .card-text b{color:var(--text)}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .section-head h2{font-size:14px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}
    .section-head h2 .ico{color:var(--accent)}
    .count{font-size:12px;font-weight:400}
    .count.ok{color:var(--ok)}
    .count.missing{color:var(--danger)}
    .grid-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:12px}
    .m-slot{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow)}
    .m-slot-img{width:100%;height:130px;object-fit:cover;background:var(--surface-2);border-bottom:1px solid var(--border)}
    .m-slot-body{display:flex;flex-direction:column;gap:8px;padding:12px}
    .m-slot-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .m-slot-token{margin:0;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;font-weight:600;color:var(--accent);background:var(--accent-soft);padding:2px 8px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-badge{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
    .m-badge.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
    .m-badge.missing{color:var(--danger);background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
    .m-slot-info{margin:0;font-size:11px;color:var(--text-faint)}
    .m-slot-actions{display:flex;align-items:center;gap:8px}
    .m-btn{display:inline-flex;align-items:center;gap:6px;justify-content:center;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;white-space:nowrap}
    .m-btn:hover{background:var(--surface-2)}
    .m-btn-primary{flex:1;background:var(--accent);border-color:transparent;color:#fff}
    .m-btn-primary:hover{background:var(--accent-hover)}
    .m-btn-ai{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 35%,transparent);color:var(--accent)}
    .m-btn-ai:hover{background:var(--accent);color:#fff}
    .m-btn-google{background:#1d4ed8;border-color:transparent;color:#fff}
    .m-btn-google:hover{background:#1e40af}
    .m-btn-del{background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent);color:var(--danger)}
    .m-btn-del:hover{background:var(--danger);color:#fff}
    .m-btn-small{padding:5px 9px;font-size:11px}
    .m-file{cursor:pointer}
    .m-file input[type=file]{display:none}
    .js-gen-form{display:flex;flex-direction:column;gap:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px}
    .m-gen-prompt{width:100%;resize:vertical;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;outline:none;transition:border-color .15s}
    .m-gen-prompt:focus{border-color:var(--accent)}
    .m-gen-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .m-gen-actions .m-gen-go{flex:1}
    .m-status{font-size:11px;color:var(--text-secondary);margin:0}
    .grid-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:8px}
    .m-gallery-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;box-shadow:var(--shadow)}
    .m-gallery-img{width:100%;height:110px;object-fit:cover;background:var(--surface-2);border-bottom:1px solid var(--border)}
    .m-gallery-body{padding:8px 10px;display:flex;flex-direction:column;gap:8px}
    .m-gallery-name{margin:0;font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-gallery-actions{display:flex;align-items:center;gap:6px}
    .m-empty{grid-column:1/-1;padding:28px;text-align:center;font-size:12px;color:var(--text-faint);background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius)}
    .extra-card{display:flex;flex-direction:column;gap:14px}
    @media(min-width:640px){.extra-card{flex-direction:row;align-items:flex-end}}
    .field{flex:1}
    .field label{display:block;font-size:12px;font-weight:500;margin-bottom:6px;color:var(--text-secondary)}
    .field input[type=text],.field input[type=password],.field input[type=file]{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);outline:none;transition:border-color .15s}
    .field input:focus{border-color:var(--accent)}
    .byok-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:10px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--accent) 20%,transparent)}
    .byok-row select{background:var(--bg);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:8px;padding:6px 10px;font-size:12px;outline:none}
    .byok-toggle{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}
    .byok-toggle input{accent-color:var(--accent)}
    #gen-byok{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    #gen-byok .m-status{color:var(--text-secondary)}
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
          <h1>Gambar Soal: ${escapeHtml(meta.title ?? slug)}</h1>
          <div class="sub">/p/${slug} &bull; penyimpanan ${storageLabel} &bull; maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB per gambar</div>
        </div>
      </div>
      <div class="topbar-actions">
        ${isJsonQuiz ? `<a href="/p/${slug}/edit" class="btn"><i class="fa-solid fa-pen-to-square"></i>Edit Soal</a>` : ''}
        <a href="/p/${slug}" target="_blank" class="btn btn-accent"><i class="fa-solid fa-eye"></i>Lihat Kuis</a>
      </div>
    </div>
  </nav>

  <main>
    <div class="card info-card">
      <h2 class="card-title"><i class="fa-solid fa-circle-info ico"></i> Cara kerja</h2>
      <p class="card-text">
        Soal bergambar ditulis dengan token <code>media:nama-slot</code>. Selama fotonya belum diunggah, siswa melihat kotak
        &ldquo;Gambar belum diunggah&rdquo;. Setelah diunggah di sini, gambarnya langsung muncul tanpa perlu publish ulang
        (kalau belum kelihatan, muat ulang halaman dengan Ctrl+Shift+R supaya salinan lama di browser dibuang).
        Kalau soalmu tidak memakai token, kamu tetap bisa mengunggah gambar di bagian bawah lalu menyalin URL-nya
        (berguna untuk gambar yang direferensikan di luar teks soal).
      </p>
    </div>
    <div class="card info-card webp">
      <h2 class="card-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Foto otomatis jadi WebP</h2>
      <p class="card-text">
        Sebelum dikirim, foto diperkecil (sisi terpanjang maks 1600 px) dan dikonversi ke WebP langsung di perangkatmu,
        jadi kuota tersimpan lebih hemat dan halaman kuis lebih cepat dibuka. Gambar GIF dibiarkan apa adanya supaya
        animasinya tidak hilang, dan kalau browser tidak mendukung konversi, file aslinya tetap terkirim.
      </p>
    </div>

    ${
      specRaw
        ? `<div>
      <div class="section-head">
        <h2><i class="fa-solid fa-image ico"></i> Slot gambar dari soal
          <span class="count ${missing.length ? 'missing' : 'ok'}">${slots.length - missing.length}/${slots.length} terisi</span>
        </h2>
      </div>
      ${
        slots.length
          ? `<div class="grid-slots">${slotCards}</div>`
          : `<p class="card-text">Soal ini belum memakai token <code>media:...</code>. Suruh Gem menambahkan gambar dengan format <code>"image": "media:nama-slot"</code> atau <code>![keterangan](media:nama-slot)</code>.</p>`
      }
    </div>`
        : ''
    }

    <div class="card ai-panel">
      <h2 class="card-title"><i class="fa-solid fa-wand-magic-sparkles ico"></i> Buat gambar dengan AI</h2>
      <p class="card-text">
        ${
          genEnabled
            ? `Klik <b>AI</b> pada kartu slot: kotak prompnya sudah <b>terisi otomatis dari konteks soal</b> (boleh diedit),
        lalu tunggu 10\u201330 detik. Hasilnya langsung tersimpan ke slot \u2014 tidak perlu unggah manual. Batas ${genLimit} gambar/menit.
        Mau hasil yang lebih apik? Klik <b>Salin prompt Gemini</b>, tempel di <b>gemini.google.com</b> dengan akun Gemini
        kamu sendiri, unduh gambarnya, lalu unggah lewat <b>Pilih / Potret Foto</b>.`
            : `Belum ada API gambar terpasang, jadi tombol <b>AI</b> belum tampil di kartu slot. Kamu bisa <b>Pakai API gambar sendiri (BYOK)</b> di bawah ini (kunci disimpan khusus untuk aplikasi ini), atau minta admin mengatur <code>IMGGEN_API_URL</code> &amp; <code>IMGGEN_API_KEY</code>.`
        }
      </p>
      <div class="byok-row">
        <label class="byok-toggle">
          <span>Model:</span>
          <select id="gen-model">
            <option value="">Model bawaan</option>
            ${modelOptions}
          </select>
        </label>
        <label class="byok-toggle">
          <input type="checkbox" id="gen-byok-toggle">
          <span>Pakai API gambar sendiri (BYOK)</span>
        </label>
      </div>
      <div id="gen-byok" class="hidden">
        <input id="gen-url" type="text" placeholder="Alamat API (https://...), misal proxy free-image-generation-api">
        <input id="gen-key" type="password" placeholder="API key untuk API tersebut...">
        <p class="card-text">Format API sama seperti bawaan: kirim <code>prompt</code> (dan opsional <code>model</code>) ke alamat di atas dengan header <code>Authorization: Bearer &lt;key&gt;</code>, dan terima gambar mentahnya. Kunci disimpan di KV aplikasi dan hanya bisa dilihat by admin.</p>
        <div class="m-gen-actions">
          <button type="button" id="gen-save" class="m-btn m-btn-ai flex-1">Simpan pengaturan</button>
          <button type="button" id="gen-reset" class="m-btn">Pakai bawaan (hapus BYOK)</button>
          <span id="gen-byok-status" class="m-status"></span>
        </div>
      </div>
    </div>

    <div>
      <div class="section-head"><h2><i class="fa-solid fa-cloud-arrow-up ico"></i> Unggah gambar tambahan</h2></div>
      <div class="card extra-card">
        <div class="field">
          <label for="extra-name">Nama gambar (tanpa spasi)</label>
          <input id="extra-name" type="text" placeholder="misal: peta-indonesia">
        </div>
        <div class="field">
          <label for="extra-file">File foto (JPG/PNG/WebP)</label>
          <input id="extra-file" type="file" accept="image/*">
        </div>
        <button id="extra-upload" class="btn btn-accent" style="align-self:stretch">Unggah</button>
      </div>
      <p id="extra-status" class="m-status" style="margin-top:8px"></p>
    </div>

    <div>
      <div class="section-head"><h2><i class="fa-solid fa-photo-film ico"></i> Gambar tersimpan (${items.length})</h2></div>
      <div class="grid-gallery">${gallery}</div>
    </div>
  </main>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script>
(function () {
  var CSRF = ${JSON.stringify(csrfToken).replace(/</g, '\\u003c')};
  var CSRF = ${JSON.stringify(csrfToken).replace(/</g, '\\u003c')};
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
      fetch('/api/media/' + encodeURIComponent(SLUG), { method: 'POST', headers: { 'X-CSRF-Token': CSRF }, body: form })
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
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
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
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
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
  }    fetch('/api/media/' + encodeURIComponent(SLUG) + '/gen-config', { method: 'GET' })
    .then(function (res) { return res.json().catch(function () { return null; }); })
    .then(function (data) {
      var cfg = data && data.config;
      if (!cfg) return;
      if (cfg.source === 'app') {
        setByokVisible(true);
        var url = document.getElementById('gen-url');
        var key = document.getElementById('gen-key');
        if (url) url.value = cfg.apiUrl || '';
        if (key) {
          // Kunci tidak pernah dikirim balik ke browser (anti-bocor). Yang
          // tampil hanya penanda bahwa kunci sudah tersimpan.
          key.value = '';
          key.placeholder = cfg.hasKey ? 'Kunci tersimpan — biarkan kosong untuk mempertahankan' : '';
        }
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
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
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
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
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
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    :root{--bg:#ffffff;--surface:#f9f9f9;--border:#e5e5e5;--text:#171717;--text-secondary:#737373;--accent:#7c3aed;--danger:#ef4444}
    @media(prefers-color-scheme:dark){:root{--bg:#212121;--surface:#303030;--border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--accent:#8b5cf6;--danger:#f87171}}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .card{max-width:480px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px}
    h1{font-size:15px;font-weight:600;color:var(--danger);margin:0 0 8px}
    p{font-size:13px;color:var(--text-secondary);line-height:1.55;margin:0}
    a{display:inline-flex;align-items:center;gap:6px;margin-top:18px;padding:8px 16px;background:var(--accent);color:#fff;border-radius:8px;font-size:12.5px;font-weight:500;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${escapeHtml(backHref)}">&larr; Kembali ke Dashboard</a>
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
    // listMediaNames (list saja) bukan listMedia (yang mengunduh ISI tiap
    // gambar). Dulu dashboard mengunduh seluruh byte gambar hanya untuk
    // menghitung "3 dari 5 gambar belum diunggah" — sumber utama latensi
    // publish dengan KV remote.
    const names = await listMediaNames(env, project.slug);
    const uploaded = new Set(names);
    return {
      ...project,
      media_slots: slots.length,
      media_missing: slots.filter((name) => !uploaded.has(name)).length,
    };
  } catch {
    return project;
  }
}

