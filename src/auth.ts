/* ==========================================================================
 * Helper bersama untuk semua rute admin (dashboard, panel gambar, editor soal).
 * Dipisah supaya cek sesi dan normalisasi slug tidak disalin berulang.
 *
 * Sesi bertanda tangan (T1 di docs/plan-hardening-auth.md):
 *   auth_session = <base64url(payload)>.<base64url(hmac)>
 *   payload      = {"v":1,"sub":"admin","role":"admin","npc":"...","iat":...,"exp":...}
 *   hmac         = HMAC-SHA256(SESSION_SECRET, base64url(payload))
 *
 * Tidak ada dependensi baru: base64url + HMAC ditulis manual dengan
 * crypto.subtle, dan helper inti tidak memakai Context supaya bisa diuji
 * langsung dari Node di tests/auth.test.mjs.
 * ========================================================================== */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

/** Sesi login admin yang sudah terverifikasi. */
export type Session = {
  v: 1;
  sub: string;
  role: 'admin';
  npc: string;
  iat: number;
  exp: number;
};

/** Pra-sesi login: hanya dipakai untuk menurunkan token CSRF di form login. */
export type PreSession = {
  v: 1;
  sub: 'pre';
  role: 'pre';
  npc: string;
  iat: number;
  exp: number;
};

const SESSION_COOKIE = 'auth_session';
const PRE_COOKIE = 'auth_pre';
/** Toleransi drift jam untuk `iat` di masa depan, dalam detik. */
const IAT_TOLERANCE = 60;

const textEncoder = new TextEncoder();

/* --------------------------------------------------------------------------
 * base64url (RFC 4648 §5, tanpa padding) — ditulis manual, tanpa Buffer,
 * supaya kode yang sama jalan di Workers dan Node.
 * ------------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 * HMAC-SHA256 + util kripto
 * ------------------------------------------------------------------------ */

async function hmacBytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return new Uint8Array(signature);
}

/** Nonce 16 byte untuk satu sesi — juga menjadi dasar token CSRF. */
export function randomNpc(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Perbandingan string waktu-tetap. Membandingkan panjang tetap (maksimum dari
 * kedua panjang) dan tidak pernah keluar loop lebih awal, jadi panjang maupun
 * isi tidak bocor lewat timing. String kosong vs string kosong → true.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = textEncoder.encode(String(a ?? ''));
  const bb = textEncoder.encode(String(b ?? ''));
  const length = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < length; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/* --------------------------------------------------------------------------
 * Sesi admin
 * ------------------------------------------------------------------------ */

function nowSeconds(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

/**
 * Bentuk nilai cookie sesi bertanda tangan. `now` dalam milidetik (default
 * Date.now()) supaya test bisa menyuntik waktu.
 */
export async function signSession(secret: string, ttlSeconds: number, now?: number): Promise<string> {
  const iat = nowSeconds(now);
  const payload = {
    v: 1 as const,
    sub: 'admin',
    role: 'admin' as const,
    npc: randomNpc(),
    iat,
    exp: iat + Math.floor(ttlSeconds),
  };
  const body = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const mac = bytesToBase64Url(await hmacBytes(secret, body));
  return `${body}.${mac}`;
}

/**
 * Verifikasi nilai cookie sesi. Mengembalikan Session atau null; tidak pernah
 * melempar dan tidak pernah membocorkan alasan kegagalan ke pemanggil.
 *
 * Ditolak bila: format salah, HMAC tidak cocok, `v` bukan 1, `role` bukan
 * admin (memblokir cookie pra-sesi dipakai ulang sebagai sesi), `exp` sudah
 * lewat, atau `iat` ada di masa depan di luar toleransi 60 detik.
 */
export async function verifySession(value: string, secret: string, now?: number): Promise<Session | null> {
  try {
    if (!value || !secret) return null;
    const dot = value.indexOf('.');
    if (dot <= 0 || dot === value.length - 1) return null;
    const body = value.slice(0, dot);
    const mac = value.slice(dot + 1);

    const expected = bytesToBase64Url(await hmacBytes(secret, body));
    if (!safeEqual(mac, expected)) return null;

    const raw = base64UrlToBytes(body);
    if (!raw) return null;
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<Session> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const seconds = nowSeconds(now);
    if (parsed.v !== 1) return null;
    if (parsed.role !== 'admin' || typeof parsed.sub !== 'string' || !parsed.sub) return null;
    if (typeof parsed.npc !== 'string' || !parsed.npc) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= seconds) return null;
    if (parsed.iat > seconds + IAT_TOLERANCE) return null;

    return { v: 1, sub: parsed.sub, role: 'admin', npc: parsed.npc, iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Pra-sesi login (login CSRF)
 * ------------------------------------------------------------------------ */

/** Cookie `auth_pre` bertanda tangan, TTL 30 menit di pemanggil. */
export async function signPreSession(secret: string, ttlSeconds: number, now?: number, npc?: string): Promise<string> {
  const iat = nowSeconds(now);
  const payload = {
    v: 1 as const,
    sub: 'pre' as const,
    role: 'pre' as const,
    npc: npc ?? randomNpc(),
    iat,
    exp: iat + Math.floor(ttlSeconds),
  };
  const body = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const mac = bytesToBase64Url(await hmacBytes(secret, body));
  return `${body}.${mac}`;
}

export async function verifyPreSession(value: string, secret: string, now?: number): Promise<PreSession | null> {
  try {
    if (!value || !secret) return null;
    const dot = value.indexOf('.');
    if (dot <= 0 || dot === value.length - 1) return null;
    const body = value.slice(0, dot);
    const mac = value.slice(dot + 1);

    const expected = bytesToBase64Url(await hmacBytes(secret, body));
    if (!safeEqual(mac, expected)) return null;

    const raw = base64UrlToBytes(body);
    if (!raw) return null;
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<PreSession> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const seconds = nowSeconds(now);
    if (parsed.v !== 1) return null;
    if (parsed.role !== 'pre') return null;
    if (typeof parsed.npc !== 'string' || !parsed.npc) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= seconds) return null;
    if (parsed.iat > seconds + IAT_TOLERANCE) return null;

    return { v: 1, sub: 'pre', role: 'pre', npc: parsed.npc, iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 * CSRF
 * ------------------------------------------------------------------------ */

/**
 * Token CSRF diturunkan dari nonce sesi: deterministik, tanpa state, dan
 * otomatis tidak valid kalau cookie sesi berubah.
 */
export async function csrfFor(npc: string, secret: string): Promise<string> {
  return bytesToBase64Url(await hmacBytes(secret, `csrf:${npc}`));
}

/**
 * Verifikasi token CSRF dari request: field `_csrf` pada body form (termasuk
 * multipart/form-data) atau header `X-CSRF-Token` untuk jalur fetch. Selalu
 * dibandingkan dengan safeEqual. Tidak pernah melempar.
 *
 * Catatan: c.req.parseBody() di Hono di-cache, jadi route yang memanggilnya
 * lagi setelah fungsi ini tidak membaca body dua kali.
 */
export async function verifyCsrfFromRequest(
  c: Context,
  session: Session | null,
  secret: string
): Promise<boolean> {
  if (!session || !secret) return false;
  const expected = await csrfFor(session.npc, secret);

  let provided = '';
  try {
    const header = c.req.header('X-CSRF-Token');
    if (typeof header === 'string' && header.trim()) provided = header.trim();
  } catch {
    // Header tidak bisa dibaca: lanjut ke jalur body.
  }
  if (!provided) {
    try {
      const body = (await c.req.parseBody()) as Record<string, unknown> | unknown;
      const field = (body as Record<string, unknown> | null)?._csrf;
      if (typeof field === 'string' && field.trim()) provided = field.trim();
    } catch {
      // Body kosong/bukan form: token hanya bisa datang dari header.
    }
  }
  if (!provided) return false;
  return safeEqual(provided, expected);
}

/* --------------------------------------------------------------------------
 * Pembacaan sesi dari Context
 * ------------------------------------------------------------------------ */

type AuthEnv = { Bindings: { SESSION_SECRET?: string } };

/** Sesi admin yang sudah terverifikasi dari cookie, atau null. */
export async function getSession<E extends AuthEnv>(c: Context<E>): Promise<Session | null> {
  const value = getCookie(c, SESSION_COOKIE);
  if (!value) return null;
  return verifySession(value, c.env.SESSION_SECRET ?? '', Date.now());
}

/** Benar bila request membawa sesi admin yang valid. */
export async function isAuthed<E extends AuthEnv>(c: Context<E>): Promise<boolean> {
  return (await getSession(c)) !== null;
}

/**
 * Gerbang admin: 401 JSON untuk request API, redirect ke `/` untuk request
 * HTML. Mengembalikan Response bila ditolak, atau null bila boleh lanjut.
 */
export async function requireAdmin<E extends AuthEnv>(c: Context<E>): Promise<Response | null> {
  if (await isAuthed(c)) return null;
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('text/html')) return c.redirect('/');
  return c.json({ status: 'error', message: 'Sesi login habis. Masuk lagi lewat dashboard.' }, 401);
}

/* --------------------------------------------------------------------------
 * Secret setup (T0): kode menolak login kalau konfigurasi kosong, bukan
 * memakai password default. Halaman ini supaya lockout tidak butuh tebakan.
 * ------------------------------------------------------------------------ */

export function missingSecrets(env: { SESSION_SECRET?: string; APP_PASSWORD?: string }): string[] {
  const missing: string[] = [];
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!env.APP_PASSWORD) missing.push('APP_PASSWORD');
  return missing;
}

/** Halaman 503 berisi dua perintah yang harus dijalankan, dalam bahasa Indonesia. */
export function secretSetupPage(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Konfigurasi belum lengkap</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px}
    .card{max-width:640px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px}
    h1{font-size:16px;color:#fb7185;margin:0 0 12px}
    p{font-size:13px;line-height:1.7;margin:0 0 14px}
    pre{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px 14px;font-size:12px;overflow-x:auto;margin:0 0 10px;line-height:1.8}
  </style>
</head>
<body>
  <div class="card">
    <h1>503 — Konfigurasi login belum lengkap</h1>
    <p>Login admin dinonaktifkan karena secret wajib belum dipasang. Jalankan dua perintah berikut, lalu coba lagi:</p>
    <pre>npx wrangler secret put SESSION_SECRET
npx wrangler secret put APP_PASSWORD</pre>
    <p>Nilai SESSION_SECRET sebaiknya dibuat acak, misalnya dari
    <code>openssl rand -base64 32</code>. Untuk environment staging, tambahkan
    flag <code>--env staging</code> pada keduanya. Tanpa secret ini dashboard
    akan selalu menampilkan halaman ini — tidak ada lagi password bawaan.</p>
  </div>
</body>
</html>`;
}

/* --------------------------------------------------------------------------
 * Slug
 * ------------------------------------------------------------------------ */

/**
 * Slug yang tersimpan di KV selalu hasil sanitizeSlug() di index.ts, yaitu hanya
 * [a-z0-9-]. Penyaringan ini tidak mengubah apa pun untuk slug yang sah — cuma
 * menutup celah kalau ada yang menembak endpoint dengan slug karangan.
 */
export function safeSlug(raw: string): string {
  return String(raw ?? '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
}

/* --------------------------------------------------------------------------
 * Konstanta cookie untuk pemanggil (login/logout) — bukan nilai cookie.
 * ------------------------------------------------------------------------ */

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const PRE_COOKIE_NAME = PRE_COOKIE;
