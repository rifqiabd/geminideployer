/* ==========================================================================
 * Helper bersama untuk semua rute admin (dashboard, panel gambar, editor soal).
 * Dipisah supaya cek sesi dan normalisasi slug tidak disalin berulang.
 * ========================================================================== */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

export const AUTH_SESSION = 'authenticated_user';

export function isAuthed(c: Context): boolean {
  return getCookie(c, 'auth_session') === AUTH_SESSION;
}

/**
 * Slug yang tersimpan di KV selalu hasil sanitizeSlug() di index.ts, yaitu hanya
 * [a-z0-9-]. Penyaringan ini tidak mengubah apa pun untuk slug yang sah — cuma
 * menutup celah kalau ada yang menembak endpoint dengan slug karangan.
 */
export function safeSlug(raw: string): string {
  return String(raw ?? '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
}
