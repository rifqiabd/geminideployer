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
