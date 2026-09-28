/* ==========================================================================
 * Helper admin bersama (hasil pemecahan index.ts): halaman error guru dan
 * guard sesi+CSRF untuk rute aksi. Dipakai oleh auth-routes.ts dan actions.ts
 * supaya pemeriksaan keamanan tidak terduplikasi.
 * ========================================================================== */
import type { Context } from 'hono';
import { errorCard } from './ui-card.ts';
import { getSession, verifyCsrfFromRequest } from './auth';

// Bindings minimal guard: verifikasi sesi & CSRF hanya butuh SESSION_SECRET.
type GuardEnv = { Bindings: { SESSION_SECRET?: string } };

/* Helper: Halaman error yang bisa dibaca guru (bukan teks polos).
 * delegate ke messageCard supaya gaya dan token tema sama dengan halaman
 * dashboard — bukan lagi kartu Tailwind CDN biru-slate yang terlihat seperti
 * produk berbeda. Signature tetap (title, message) jadi auth-routes.ts dan
 * actions.ts tidak perlu berubah. */
export function errorPage(title: string, message: string): string {
  return errorCard(title, message);
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
