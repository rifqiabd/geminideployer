/* ==========================================================================
 * Koreksi jawaban esai dari halaman rekap data.
 * --------------------------------------------------------------------------
 * Soal esai tidak bisa dinilai otomatis, tapi nilai objektifnya juga belum
 * lengkap sebelum esainya diberi nilai. Karena itu:
 *   - nilai objektif tetap ditampilkan apa adanya,
 *   - nilai AKHIR baru dihitung setelah semua esai di satu kiriman dinilai,
 *     supaya nilai siswa tidak turun sepihak saat esainya belum selesai dikoreksi.
 *
 * Poin esai disimpan di payload kiriman (`essay_scores`) lalu penilaian
 * dihitung ulang dengan gradeSubmission() yang sama seperti saat siswa mengirim,
 * jadi tidak ada rumus ganda yang bisa berbeda hasilnya.
 * ========================================================================== */

import type { Hono } from 'hono';
import { isAuthed, safeSlug } from './auth';
import { escapeHtml, gradeSubmission, mediaBaseFor, parseQuizSpec } from './quiz';
import type { GradeResult, GradedDetail, QuizSpec } from './quiz';
import type { MediaBindings } from './media';

type EssayBindings = MediaBindings & { DB: D1Database };

type StoredPayload = {
  score?: number;
  final_score?: number | null;
  lulus?: boolean | null;
  essay_pending?: number;
  essay_earned?: number;
  essay_total?: number;
  essay_scores?: Record<string, number>;
  answers?: unknown;
  detail?: GradedDetail[];
};

export function registerEssayGradingRoutes<E extends { Bindings: EssayBindings }>(app: Hono<E>) {
  /* ------------------------------------------------------------------ */
  /* Halaman koreksi                                                     */
  /* ------------------------------------------------------------------ */
  app.get('/p/:slug/essay', async (c) => {
    if (!isAuthed(c)) return c.redirect('/');

    const slug = safeSlug(c.req.param('slug'));
    const metaRaw = await c.env.STORAGE.get(`meta:${slug}`);
    if (!metaRaw) return c.html(messagePage('Aplikasi tidak ditemukan', `Tidak ada aplikasi di /p/${slug}.`), 404);

    const meta = JSON.parse(metaRaw) as { title?: string; type?: string };
    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (meta.type !== 'json' || !specRaw) {
      return c.html(
        messagePage('Hanya untuk aplikasi mode "JSON Soal"', 'Aplikasi HTML/React tidak punya daftar soal yang bisa dikoreksi di sini.'),
        400
      );
    }

    let spec: QuizSpec;
    try {
      spec = parseQuizSpec(specRaw);
    } catch (error) {
      return c.html(messagePage('Soal kuis tidak terbaca', String(error)), 400);
    }
    if (!spec.questions.some((question) => question.type === 'essay')) {
      return c.html(messagePage('Tidak ada soal esai', 'Kuis ini seluruhnya dinilai otomatis, jadi tidak ada yang perlu dikoreksi manual.'), 400);
    }

    const showAll = c.req.query('show') === 'all';
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM app_records WHERE app_slug = ? ORDER BY created_at ASC'
    )
      .bind(slug)
      .all();

    const entries = (results as Array<Record<string, unknown>>)
      .map((row) => {
        let payload: StoredPayload;
        try {
          payload = JSON.parse(String(row.payload_json)) as StoredPayload;
        } catch {
          return null;
        }
        const essays = (payload.detail ?? []).filter((detail) => detail && detail.type === 'essay');
        if (!essays.length) return null;
        return {
          id: String(row.id),
          name: String(row.user_id ?? 'anonim'),
          createdAt: String(row.created_at ?? ''),
          payload,
          essays,
          pending: typeof payload.essay_pending === 'number' ? payload.essay_pending : essays.length,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const pendingEntries = entries.filter((entry) => entry.pending > 0);
    const visible = showAll ? entries : pendingEntries;

    const cards = visible
      .map((entry) => {
        const scores = entry.payload.essay_scores ?? {};
        const essaysHtml = entry.essays
          .map((essay) => {
            const max = essay.poin_maks || 1;
            const saved = typeof scores[essay.id] === 'number' ? scores[essay.id] : null;
            return `
        <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-2" data-qid="${escapeHtml(essay.id)}" data-max="${max}">
          <div class="text-sm text-slate-200 leading-relaxed">${essay.question_html || ''}</div>
          <p class="text-[11px] text-slate-500">Jawaban siswa:</p>
          <div class="text-sm text-slate-100 bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 whitespace-pre-wrap break-words">${escapeHtml(essay.jawaban || '(kosong)')}</div>
          <div class="flex items-center gap-2 flex-wrap">
            <label class="text-[11px] text-slate-400">Nilai</label>
            <input type="number" min="0" max="${max}" step="0.5" value="${saved === null ? '' : saved}" class="js-score w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-orange-500">
            <span class="text-[11px] text-slate-400">dari ${max} poin</span>
            <button type="button" class="js-full px-2.5 py-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg text-[11px] font-medium">Nilai penuh</button>
            <span class="js-qstatus text-[11px] ${saved === null ? 'text-slate-500' : 'text-emerald-400'}">${saved === null ? 'Belum dinilai' : 'Sudah dinilai'}</span>
          </div>
        </div>`;
          })
          .join('');

        return `
      <article class="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3" data-record="${escapeHtml(entry.id)}" data-slug="${escapeHtml(slug)}">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 class="text-sm font-bold text-white">${escapeHtml(entry.name)}</h3>
            <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(entry.createdAt)}</p>
            <p class="js-summary text-[11px] text-slate-400 mt-1">${escapeHtml(summaryLine(entry.payload))}</p>
          </div>
          <span class="js-badge text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            entry.pending > 0
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          }">${entry.pending > 0 ? `${entry.pending} esai belum dinilai` : 'Sudah dikoreksi'}</span>
        </div>
        ${essaysHtml}
        <div class="flex items-center gap-3 pt-1">
          <button type="button" class="js-save px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-xs font-semibold"><i class="fa-solid fa-floppy-disk mr-1"></i>Simpan Koreksi</button>
          <span class="js-status text-[11px] text-slate-400"></span>
        </div>
      </article>`;
      })
      .join('');

    return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Koreksi Esai - ${escapeHtml(meta.title ?? slug)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6 font-sans">
  <div class="max-w-4xl mx-auto space-y-5">
    <div class="flex items-start justify-between gap-4 border-b border-slate-800 pb-4 flex-wrap">
      <div>
        <a href="/p/${escapeHtml(slug)}/data" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-arrow-left mr-1"></i>Rekap Data</a>
        <h1 class="text-xl font-bold text-white mt-1">Koreksi Jawaban Esai</h1>
        <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(meta.title ?? slug)} &bull; /p/${escapeHtml(slug)}</p>
      </div>
      <div class="flex items-center gap-2">
        <a href="/p/${escapeHtml(slug)}/edit" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit Soal</a>
        <a href="/p/${escapeHtml(slug)}" target="_blank" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold"><i class="fa-solid fa-eye mr-1"></i>Lihat Kuis</a>
      </div>
    </div>

    <div class="flex items-center gap-2 text-xs">
      <a href="/p/${escapeHtml(slug)}/essay" class="${
        showAll ? 'text-slate-400 hover:text-slate-200' : 'text-white font-semibold'
      } px-3 py-1.5 rounded-lg ${showAll ? '' : 'bg-slate-800 border border-slate-700'}">Belum dikoreksi (${pendingEntries.length})</a>
      <a href="/p/${escapeHtml(slug)}/essay?show=all" class="${
        showAll ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
      } px-3 py-1.5 rounded-lg ${showAll ? 'bg-slate-800 border border-slate-700' : ''}">Semua kiriman (${entries.length})</a>
    </div>

    <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-xs text-slate-300 leading-relaxed">
      <p class="font-semibold text-slate-100 mb-1"><i class="fa-solid fa-circle-info text-orange-400 mr-1"></i>Cara penilaian esai</p>
      Isi poin 0 sampai poin maksimal tiap soal, lalu simpan. Nilai objektif selalu ditampilkan; <b>nilai akhir</b>
      (objektif + esai) baru dihitung setelah semua esai di satu kiriman selesai dinilai, supaya nilai siswa tidak
      turun sepihak selama esainya masih menunggu. Mengosongkan kolom nilai berarti soal itu dianggap belum dikoreksi.
    </div>

    ${cards || `<div class="bg-slate-800/50 p-10 rounded-2xl border border-slate-800 text-center text-slate-400 text-sm">
        ${showAll ? 'Belum ada kiriman siswa yang punya jawaban esai.' : 'Semua jawaban esai sudah dikoreksi. Tidak ada antrean.'}
      </div>`}
  </div>

  <script src="/vendor/quiz-essay.js"></script>
</body>
</html>`);
  });

  /* ------------------------------------------------------------------ */
  /* Simpan nilai esai                                                   */
  /* ------------------------------------------------------------------ */
  app.post('/api/quiz/:slug/essay', async (c) => {
    if (!isAuthed(c)) return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);

    const slug = safeSlug(c.req.param('slug'));
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; scores?: Record<string, unknown> } | null;
    const recordId = String(body?.id ?? '').trim();
    if (!recordId) return c.json({ status: 'error', message: 'Kiriman siswa tidak dikenal.' }, 400);

    const specRaw = await c.env.STORAGE.get(`quiz:${slug}`);
    if (!specRaw) return c.json({ status: 'error', message: 'Soal kuis tidak ditemukan.' }, 404);

    let spec: QuizSpec;
    try {
      spec = parseQuizSpec(specRaw);
    } catch (error) {
      return c.json({ status: 'error', message: `Soal kuis tidak terbaca: ${String(error)}` }, 400);
    }

    const row = await c.env.DB.prepare('SELECT * FROM app_records WHERE id = ? AND app_slug = ?')
      .bind(recordId, slug)
      .first();
    if (!row) return c.json({ status: 'error', message: 'Kiriman siswa tidak ditemukan.' }, 404);

    let payload: StoredPayload;
    try {
      payload = JSON.parse(String(row.payload_json)) as StoredPayload;
    } catch {
      return c.json({ status: 'error', message: 'Data jawaban rusak dan tidak bisa dibaca.' }, 400);
    }

    // Tanpa jawaban aslinya, penilaian ulang cuma akan menghasilkan nilai nol
    // dan menimpa data lama — jadi tolak daripada merusak rekap.
    if (payload.answers === undefined) {
      return c.json({ status: 'error', message: 'Kiriman ini tidak menyimpan jawaban siswa, jadi tidak bisa dinilai ulang.' }, 400);
    }

    // Hanya soal esai milik kuis ini yang boleh dinilai dari sini.
    const essayIds = new Set(spec.questions.filter((question) => question.type === 'essay').map((question) => question.id));
    const merged: Record<string, number> = { ...(payload.essay_scores ?? {}) };
    for (const [key, value] of Object.entries(body?.scores ?? {})) {
      if (!essayIds.has(key)) continue;
      const text = String(value).trim();
      if (text === '') {
        delete merged[key]; // dikosongkan = batal dikoreksi
        continue;
      }
      const number = Number(text);
      if (Number.isFinite(number)) merged[key] = number;
    }

    const graded: GradeResult = gradeSubmission(spec, payload.answers, mediaBaseFor(slug), merged);
    const lulus = graded.essay_pending > 0 ? null : (graded.final_score ?? graded.score) >= spec.passingScore;

    const updated: StoredPayload & Record<string, unknown> = {
      ...payload,
      essay_scores: merged,
      score: graded.score,
      points_earned: graded.points_earned,
      points_total: graded.points_total,
      full_points: graded.full_points,
      essay_pending: graded.essay_pending,
      essay_graded: graded.essay_graded,
      essay_earned: graded.essay_earned,
      essay_total: graded.essay_total,
      final_score: graded.final_score,
      lulus,
      detail: graded.detail,
      corrected_at: new Date().toISOString(),
    };

    await c.env.DB.prepare('UPDATE app_records SET payload_json = ? WHERE id = ? AND app_slug = ?')
      .bind(JSON.stringify(updated), recordId, slug)
      .run();

    return c.json({
      status: 'success',
      message: 'Koreksi tersimpan.',
      summary: summaryLine(updated),
      essay_pending: graded.essay_pending,
      score: graded.score,
      final_score: graded.final_score,
      lulus,
    });
  });
}

/** Satu baris ringkas yang dipakai halaman maupun balasan API (biar selalu sama). */
function summaryLine(payload: StoredPayload): string {
  const parts = [`Nilai objektif: ${payload.score ?? '-'}`];
  parts.push(
    payload.final_score === null || payload.final_score === undefined
      ? 'Nilai akhir: menunggu semua esai dikoreksi'
      : `Nilai akhir: ${payload.final_score}`
  );
  if (payload.essay_total) parts.push(`Poin esai: ${payload.essay_earned ?? 0}/${payload.essay_total}`);
  if (payload.lulus === true) parts.push('LULUS');
  else if (payload.lulus === false) parts.push('BELUM LULUS');
  return parts.join(' · ');
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
