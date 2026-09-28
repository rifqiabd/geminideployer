/* ==========================================================================
 * Halaman publik aplikasi siswa (hasil pemecahan index.ts): GET /p/:slug —
 * naskah biasa atau lembar cetak (`?print=1`). Kunci jawaban (`&kunci=1`)
 * hanya untuk sesi admin dan dijawab 404 bila tidak berhak.
 * ========================================================================== */
import type { Hono } from 'hono';
import { isAuthed } from './auth';
import { renderPrintSheet } from './quiz';
import type { QuizSpec } from './quiz';
import { messageCard } from './ui-card.ts';

// Bindings minimal: KV untuk html/spec + SESSION_SECRET untuk isAuthed().
type PublicAppBindings = { STORAGE: KVNamespace; SESSION_SECRET?: string };
type PublicAppEnv = { Bindings: PublicAppBindings };

export function registerPublicAppRoute<E extends PublicAppEnv>(app: Hono<E>) {
// Buka Aplikasi Berdasarkan Slug
app.get('/p/:slug', async (c) => {
  const slug = c.req.param('slug');

  // Mode cetak (Print to PDF) khusus kuis JSON: `?print=1` (+ `&kunci=1`).
  // Aplikasi lama yang dulu dipublish sebagai HTML/React tidak punya spec
  // terstruktur, jadi permintaan cetakinya dilewati dan halamannya tampil biasa.
  if (c.req.query('print') === '1') {
    // Kunci jawaban hanya lewat sesi admin (T6). 404, bukan 403 — 403
    // mengonfirmasi bahwa kunci memang ada. `?print=1` tanpa `kunci` tetap
    // publik: mencetak naskah soal bukan kebocoran.
    const wantsKunci = c.req.query('kunci') === '1';
    if (wantsKunci && !(await isAuthed(c))) {
      return c.html(notFoundCard(), 404);
    }
    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (specRaw) {
      try {
        const spec = JSON.parse(specRaw) as QuizSpec;
        return c.html(
          renderPrintSheet(spec, slug, {
            showKunci: wantsKunci,
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
    return c.html(notFoundCard(), 404);
  }

  /* Tombol cetak tidak pernah dirender di HTML halaman siswa (tersimpan
     statis, tidak tahu siapa yang membuka). Untuk admin, tombol disuntik ke
     placeholder #admin-tools di sini saat halaman disajikan — siswa tidak
     melihat apa pun karena penyuntikan hanya terjadi bila sesi admin valid. */
  if (await isAuthed(c)) {
    const adminTools = `<a class="q-btn q-btn-mini" href="?print=1" title="Cetak / Simpan PDF">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
          Cetak
        </a>`;
    const injected = html.includes('id="admin-tools"')
      ? html.replace('<span class="q-admin-tools" id="admin-tools"></span>', `<span class="q-admin-tools" id="admin-tools">${adminTools}</span>`)
      : html; // HTML lama tanpa placeholder: dilewati, tombol cetak tersedia dari dashboard
    return c.html(injected);
  }

  return c.html(html);
});
}

/**
 * 404 untuk halaman siswa. Tetap polos dan tanpa tombol: halaman ini terbuka
 * untuk umum, jadi tidak boleh menawarkan tautan ke dashboard admin dan tidak
 * boleh membocorkan apakah sebuah slug pernah ada. Pesannya sengaja generik.
 */
function notFoundCard(): string {
  return messageCard({
    title: 'Aplikasi tidak ditemukan',
    message: 'Alamat ini tidak ada atau sudah dipindahkan. Periksa kembali tautan yang kamu terima dari guru.',
    tone: 'warn',
  });
}
