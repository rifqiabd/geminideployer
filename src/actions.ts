/* ==========================================================================
 * Aksi admin (hasil pemecahan index.ts):
 *   POST /api/deploy     — publish JSON soal jadi aplikasi baru
 *   POST /api/delete     — hapus aplikasi + medianya
 *   POST /api/app/update — ubah judul/slug (baris D1 digeser lebih dulu)
 * ========================================================================== */
import type { Hono } from 'hono';
import { escapeHtml, parseQuizJson, parseQuizSpec, QuizError, randomSlugSuffix, renderQuizApp, stampNow } from './quiz';
import type { QuizSpec } from './quiz';
import { safeSlug } from './auth';
import { deleteAllMedia, moveAllMedia } from './media';
import { denyAdminRequest, errorPage } from './admin-shared';

// Bindings minimal aksi: KV + D1 (riwayat jawaban) + R2 opsional (media) + secret.
type ActionBindings = { STORAGE: KVNamespace; DB: D1Database; MEDIA?: R2Bucket; SESSION_SECRET?: string };
type ActionEnv = { Bindings: ActionBindings };

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
async function uniqueSlug(env: { STORAGE: KVNamespace }, base: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base}-${randomSlugSuffix()}`;
    const taken = await env.STORAGE.get(`meta:${candidate}`);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Helper: Simpan HTML aplikasi + metadatanya ke KV
async function saveApp(env: { STORAGE: KVNamespace }, entry: { title: string; slug: string; type: string; html: string }) {
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

export function registerActionRoutes<E extends ActionEnv>(app: Hono<E>) {
// ==========================================
// 4. ACTION HANDLERS
// ==========================================
app.post('/api/deploy', async (c) => {
  const denied = await denyAdminRequest(c);
  if (denied) return denied;

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
  const denied = await denyAdminRequest(c);
  if (denied) return denied;

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
  const denied = await denyAdminRequest(c);
  if (denied) return denied;

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
}
