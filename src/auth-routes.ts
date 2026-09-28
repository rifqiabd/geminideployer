/* ==========================================================================
 * Rute autentikasi admin (hasil pemecahan index.ts):
 *   POST /api/login  — rate limit fail-closed + CSRF pra-sesi + sesi HMAC
 *   GET  /api/logout — bersihkan cookie sesi & pra-sesi
 * ========================================================================== */
import type { Context, Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { errorPage } from './admin-shared';
import {
  SESSION_COOKIE_NAME,
  PRE_COOKIE_NAME,
  csrfFor,
  missingSecrets,
  safeEqual,
  secretSetupPage,
  signSession,
  verifyPreSession,
} from './auth';

// Bindings minimal rute login: KV untuk rate limit + secret password/sesi.
type AuthRouteBindings = { STORAGE: KVNamespace; SESSION_SECRET?: string; APP_PASSWORD?: string };
type AuthRouteEnv = { Bindings: AuthRouteBindings };

// Masa berlaku cookie sesi admin: 7 hari.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/* --------------------------------------------------------------------------
 * Rate limit /api/login (T3) — fail-closed: kalau KV gagal, login DITOLAK.
 * IP di-hash supaya tidak tersimpan mentah sebagai key KV.
 * ------------------------------------------------------------------------ */
const LOGIN_RATE_PER_MINUTE = 5;
const LOGIN_LOCK_THRESHOLD = 10;
const LOGIN_LOCK_SECONDS = 15 * 60;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp<E extends AuthRouteEnv>(c: Context<E>): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}

export function registerAuthRoutes<E extends AuthRouteEnv>(app: Hono<E>) {
app.post('/api/login', async (c) => {
  // T0: tanpa secret wajib, login menolak boot dengan instruksi — bukan
  // memakai password bawaan.
  if (missingSecrets(c.env).length) return c.html(secretSetupPage(), 503);

  // Rate limit diperiksa SEBELUM password dibandingkan supaya timing brute
  // force tidak bergantung pada benar/salahnya password.
  const ipHash = await sha256Hex(clientIp(c));
  const minuteBucket = Math.floor(Date.now() / 60000);
  const failKey = `loginfail:${ipHash}:${minuteBucket}`;
  const lockKey = `loginlock:${ipHash}`;
  try {
    const lockedUntil = Number((await c.env.STORAGE.get(lockKey)) ?? '0');
    if (lockedUntil > Math.floor(Date.now() / 1000)) {
      c.header('Retry-After', String(Math.max(1, lockedUntil - Math.floor(Date.now() / 1000))));
      return c.html(errorPage('Login dikunci sementara', 'Terlalu banyak percobaan gagal. Coba lagi setelah 15 menit.'), 429);
    }
    const used = Number((await c.env.STORAGE.get(failKey)) ?? '0');
    if (used >= LOGIN_RATE_PER_MINUTE) {
      c.header('Retry-After', '60');
      return c.html(errorPage('Terlalu banyak percobaan', 'Batas 5 percobaan per menit tercapai. Tunggu sebentar, lalu coba lagi.'), 429);
    }
  } catch {
    // Berbeda dari panel generate AI yang sengaja fail-open, di sini KV gagal
    // berarti pengaman login tidak bisa dihitung → tolak (fail-closed).
    return c.html(errorPage('Layanan sedang tidak tersedia', 'Pemeriksaan batas percobaan login tidak bisa dijalankan. Coba lagi sebentar.'), 503);
  }

  // Login CSRF: token diturunkan dari cookie auth_pre yang dipasang saat
  // GET / tanpa sesi. Tanpa itu, form dibuat sebelum pembaruan ini.
  const secret = c.env.SESSION_SECRET ?? '';
  const preValue = getCookie(c, PRE_COOKIE_NAME);
  const pre = preValue ? await verifyPreSession(preValue, secret) : null;
  const body = await c.req.parseBody();
  const providedToken = typeof body._csrf === 'string' ? body._csrf : '';
  if (!pre || !providedToken || !safeEqual(providedToken, await csrfFor(pre.npc, secret))) {
    return c.html(errorPage('Sesi login kedaluwarsa', 'Muat ulang halaman depan, lalu masukkan password sekali lagi.'), 403);
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const expected = c.env.APP_PASSWORD ?? '';
  if (!expected || !safeEqual(password, expected)) {
    // Catat kegagalan; setelah 10 kegagalan kunci 15 menit. TTL 120 detik
    // menutup bucket menit berjalan + satu bucket berikutnya.
    try {
      const fails = Number((await c.env.STORAGE.get(failKey)) ?? '0') + 1;
      await c.env.STORAGE.put(failKey, String(fails), { expirationTtl: 120 });
      if (fails >= LOGIN_LOCK_THRESHOLD) {
        await c.env.STORAGE.put(lockKey, String(Math.floor(Date.now() / 1000) + LOGIN_LOCK_SECONDS), { expirationTtl: LOGIN_LOCK_SECONDS });
      }
    } catch {
      // KV gagal saat mencatat: percobaan ini tetap ditolak di atas, jadi aman.
    }
    return c.html(errorPage('Password salah', 'Master password yang dimasukkan tidak cocok. Coba lagi dari halaman depan.'), 401);
  }

  // Sukses: bersihkan penghitung gagal, pasang sesi bertanda tangan, buang
  // pra-sesi (nonce-nya sudah terpakai dan tidak boleh dipakai login lagi).
  try {
    await c.env.STORAGE.delete(failKey);
  } catch {
    // Penghitung gagal tinggal; TTL 120 detik menghapusnya sendiri.
  }
  const cookieValue = await signSession(secret, SESSION_TTL_SECONDS);
  setCookie(c, SESSION_COOKIE_NAME, cookieValue, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  });
  deleteCookie(c, PRE_COOKIE_NAME, { path: '/' });
  // `?welcome=1`: tanda login baru, dipakai dashboard untuk menampilkan lagi
  // banner sekolah yang sebelumnya disembunyikan guru (lihat initBanner).
  return c.redirect('/?welcome=1');
});

app.get('/api/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  deleteCookie(c, PRE_COOKIE_NAME, { path: '/' });
  return c.redirect('/');
});
}
