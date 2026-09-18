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
import { collectMediaSlots, escapeHtml, parseQuizSpec, sanitizeMediaName } from './quiz';
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
  /* 4. Panel guru: atur gambar tiap soal                                */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/media', async (c) => {
    if (!isAuthed(c)) return c.redirect('/');

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    const meta = metaRaw ? (JSON.parse(metaRaw) as { title?: string; type?: string }) : null;
    if (!meta) return c.html(errorCard(`/p/${slug}`, 'Aplikasi tidak ditemukan', 'Pastikan alamatnya benar.'), 404);

    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    let slots: string[] = [];
    if (specRaw) {
      try {
        slots = collectMediaSlots(parseQuizSpec(specRaw));
      } catch {
        slots = [];
      }
    }

    const isJsonQuiz = meta.type === 'json';
    const items = await listMedia(c.env, slug);
    const uploaded = new Map(items.map((item) => [item.name, item]));
    const missing = slots.filter((name) => !uploaded.has(name));
    const storageLabel = c.env.MEDIA ? 'Cloudflare R2' : 'Cloudflare KV';

    const slotCards = slots
      .map((name) => {
        const saved = uploaded.get(name);
        const badge = saved
          ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Sudah ada</span>`
          : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">Belum diunggah</span>`;
        const info = saved ? `${(saved.size / 1024).toFixed(0)} KB` : 'Siswa saat ini melihat kotak "Gambar belum diunggah".';
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
            ${saved ? `<button class="js-delete px-3 py-2 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg text-xs transition" data-name="${escapeHtml(name)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
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
    const slots = collectMediaSlots(parseQuizSpec(specRaw));
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

