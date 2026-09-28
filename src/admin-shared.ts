/* ==========================================================================
 * Helper admin bersama (hasil pemecahan index.ts): halaman error guru dan
 * guard sesi+CSRF untuk rute aksi. Dipakai oleh auth-routes.ts dan actions.ts
 * supaya pemeriksaan keamanan tidak terduplikasi.
 * ========================================================================== */
import type { Context } from 'hono';
import { escapeHtml } from './quiz';
import { getSession, verifyCsrfFromRequest } from './auth';

// Bindings minimal guard: verifikasi sesi & CSRF hanya butuh SESSION_SECRET.
type GuardEnv = { Bindings: { SESSION_SECRET?: string } };

// Helper: Halaman error yang bisa dibaca guru (bukan teks polos)
export function errorPage(title: string, message: string): string {
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

/* --------------------------------------------------------------------------
 * Guard admin untuk route aksi (T2/T4): sesi valid + token CSRF cocok.
 * Mengembalikan Response bila ditolak, atau null bila boleh lanjut.
 * parseBody() di Hono di-cache per request, jadi membacanya di sini untuk CSRF
 * lalu lagi di handler tidak mengonsumsi body dua kali.
 * ------------------------------------------------------------------------ */
export async function denyAdminRequest<E extends GuardEnv>(c: Context<E>): Promise<Response | null> {
  const session = await getSession(c);
  if (!session) {
    const accept = c.req.header('Accept') ?? '';
    if (accept.includes('text/html')) return c.redirect('/');
    return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);
  }
  if (!(await verifyCsrfFromRequest(c, session, c.env.SESSION_SECRET ?? ''))) {
    return c.html(errorPage('Token keamanan tidak valid', 'Muat ulang halaman, lalu ulangi aksinya. Permintaan ditolak karena token CSRF tidak cocok.'), 403);
  }
  return null;
}
