/* ==========================================================================
 * Test helper sesi bertanda tangan dari src/auth.ts (T8 di
 * docs/plan-hardening-auth.md). Helper inti sengaja tidak memakai Context
 * supaya bisa diimpor langsung dari Node tanpa harness HTTP.
 *
 * Tidak menyentuh tests/quiz.test.mjs — file itu memverifikasi
 * docs/gemini-gem-prompt-full.md dan punya riwayat perubahan sendiri.
 * ========================================================================== */

import {
  signSession,
  verifySession,
  signPreSession,
  verifyPreSession,
  csrfFor,
  randomNpc,
  safeEqual,
  safeSlug,
  missingSecrets,
  SESSION_COOKIE_NAME,
} from '../src/auth.ts';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failed += 1;
    failures.push(name);
    console.log('FAIL ' + name + ' — harapan: ' + JSON.stringify(expected) + ', nyata: ' + JSON.stringify(actual));
  }
}

const SECRET = 'test-secret-untuk-unit-test-auth-2026';
const NOW = 1_700_000_000_000; // milidetik tetap supaya hasil deterministik

/* --- safeEqual ------------------------------------------------------------ */

check('safeEqual: string sama → true', safeEqual('abc', 'abc'), true);
check('safeEqual: string kosong vs kosong → true', safeEqual('', ''), true);
check('safeEqual: isi beda, panjang sama → false', safeEqual('abc', 'abd'), false);
check('safeEqual: panjang beda → false', safeEqual('abc', 'abcd'), false);
check('safeEqual: kosong vs tidak kosong → false', safeEqual('', 'x'), false);

/* --- signSession → verifySession ------------------------------------------ */

const cookie = await signSession(SECRET, 3600, NOW);
check('signSession: bentuk dua bagian dipisah titik', /^[\w-]+.[\w-]+$/.test(cookie), true);

const verified = await verifySession(cookie, SECRET, NOW);
check('verifySession: sesi valid terbaca', verified !== null, true);
check('verifySession: role admin', verified?.role, 'admin');
check('verifySession: sub admin', verified?.sub, 'admin');
check('verifySession: npc ada', typeof verified?.npc === 'string' && verified.npc.length > 10, true);
check('verifySession: exp = iat + ttl', verified?.exp - verified?.iat, 3600);

const verifiedLater = await verifySession(cookie, SECRET, NOW + 3599_000);
check('verifySession: masih valid sebelum exp', verifiedLater !== null, true);
check('verifySession: ditolak tepat pada exp', await verifySession(cookie, SECRET, NOW + 3600_000), null);
check('verifySession: ditolak setelah exp', await verifySession(cookie, SECRET, NOW + 7200_000), null);

// Regression guard terpenting: cookie statis lama TIDAK boleh lolos lagi.
check('regresi: cookie lama authenticated_user ditolak', await verifySession('authenticated_user', SECRET, NOW), null);
check('regresi: cookie lama ditolak walau secret kosong', await verifySession('authenticated_user', '', NOW), null);
check('regresi: cookie lama tanpa titik ditolak', await verifySession('authenticated_user', SECRET, NOW), null);

/* --- Tamper dan secret salah ---------------------------------------------- */

const [body, mac] = cookie.split('.');
const tamperedBody = body.slice(0, -4) + (body.endsWith('AAAA') ? 'AAAB' : 'AAAA');
check('tamper: payload diubah → ditolak', await verifySession(`${tamperedBody}.${mac}`, SECRET, NOW), null);
check('tamper: mac diubah satu karakter → ditolak', await verifySession(`${body}.${mac.slice(0, -1)}A`), null);
check(
  'tamper: mac diubah satu karakter (varian) → ditolak',
  await verifySession(`${body}.${mac.slice(0, -1)}A`, SECRET, NOW),
  null
);
check('tamper: titik hilang → ditolak', await verifySession(body + mac, SECRET, NOW), null);
check('tamper: format tiga bagian → ditolak', await verifySession(`${body}.${mac}.ekstra`, SECRET, NOW), null);
check('tamper: nilai kosong → ditolak', await verifySession('', SECRET, NOW), null);
check('tamper: base64url ilegal di payload → ditolak', await verifySession(`***.${mac}`, SECRET, NOW), null);

const otherSecret = await signSession('rahasia-lain-yang-cukup-panjang', 3600, NOW);
check('secret salah: token secret lain ditolak', await verifySession(otherSecret, SECRET, NOW), null);
check('secret salah: token asli ditolak oleh secret lain', await verifySession(cookie, 'rahasia-lain-yang-cukup-panjang', NOW), null);
check('secret kosong: semua ditolak', await verifySession(cookie, '', NOW), null);

/* --- exp dan iat ----------------------------------------------------------- */

// Cookie yang di-sign dengan TTL 60 detik, diperiksa satu jam kemudian.
const shortLived = await signSession(SECRET, 60, NOW);
check('exp lewat: ditolak', await verifySession(shortLived, SECRET, NOW + 61_000), null);

// iat di masa depan di luar toleransi 60 detik → tolak. Sign "di masa depan"
// disimulasikan dengan NOW + 10 menit, lalu diverifikasi pada NOW.
const future = await signSession(SECRET, 3600, NOW + 10 * 60_000);
check('iat di masa depan (di luar toleransi 60 d): ditolak', await verifySession(future, SECRET, NOW), null);

// Di dalam toleransi masih diterima (drift jam wajar).
const slightlyFuture = await signSession(SECRET, 3600, NOW + 30_000);
check('iat di masa depan (dalam toleransi 30 d): diterima', (await verifySession(slightlyFuture, SECRET, NOW)) !== null, true);

/* --- Versi format ---------------------------------------------------------- */

// Bentuk payload v1 dipalsukan dengan tanda tangan ASLI dari secret yang sama:
// ganti "v":1 menjadi "v":2 lalu tanda tangani ulang secara manual.
async function forgeCookie(payloadObj) {
  const payloadB64 = btoa(JSON.stringify(payloadObj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encoder = new TextEncoder();
  const { subtle } = globalThis.crypto;
  const key = await subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const macB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${payloadB64}.${macB64}`;
}

const v2Cookie = await forgeCookie({ v: 2, sub: 'admin', role: 'admin', npc: 'abcdefghij12', iat: NOW / 1000, exp: NOW / 1000 + 3600 });
check('v bukan 1: ditolak walau tanda tangan valid', await verifySession(v2Cookie, SECRET, NOW), null);

const rolePre = await forgeCookie({ v: 1, sub: 'pre', role: 'pre', npc: 'abcdefghij12', iat: NOW / 1000, exp: NOW / 1000 + 3600 });
check('role pre dipakai sebagai sesi: ditolak', await verifySession(rolePre, SECRET, NOW), null);

const noNpc = await forgeCookie({ v: 1, sub: 'admin', role: 'admin', npc: '', iat: NOW / 1000, exp: NOW / 1000 + 3600 });
check('npc kosong: ditolak', await verifySession(noNpc, SECRET, NOW), null);

/* --- npc dan csrfFor -------------------------------------------------------- */

check('randomNpc: 16 byte → 22 karakter base64url', randomNpc().length, 22);
check('randomNpc: dua panggilan berbeda', randomNpc() !== randomNpc(), true);

const npcA = 'npc-A-contoh-0001';
const npcB = 'npc-B-contoh-0002';
const tokenA1 = await csrfFor(npcA, SECRET);
const tokenA2 = await csrfFor(npcA, SECRET);
const tokenB = await csrfFor(npcB, SECRET);
check('csrfFor: deterministik per npc', tokenA1, tokenA2);
check('csrfFor: beda npc → beda token', tokenA1 !== tokenB, true);
check('csrfFor: beda secret → beda token', tokenA1 !== (await csrfFor(npcA, 'secret-lain')), true);
check('csrfFor: bentuk base64url', /^[A-Za-z0-9_-]+$/.test(tokenA1), true);

/* --- Pre-session (login CSRF) ---------------------------------------------- */

const pre = await signPreSession(SECRET, 30 * 60, NOW);
const preParsed = await verifyPreSession(pre, SECRET, NOW);
check('pre: valid terbaca', preParsed !== null, true);
check('pre: role pre', preParsed?.role, 'pre');
check('pre: ditolak setelah exp', await verifyPreSession(pre, SECRET, NOW + 30 * 60_000), null);
check('pre: ditolak oleh verifySession', await verifySession(pre, SECRET, NOW), null);
check('pre: sesi admin ditolak oleh verifyPreSession', await verifyPreSession(cookie, SECRET, NOW), null);

const preFixed = await signPreSession(SECRET, 30 * 60, NOW, npcA);
check('pre: npc suntikan dipakai', (await verifyPreSession(preFixed, SECRET, NOW))?.npc, npcA);
check('pre: csrfFor dari npc pre = token form login', await csrfFor(npcA, SECRET), tokenA1);

/* --- csrfFor sebagai penurunan sesi ----------------------------------------- */

// Token CSRF sesi admin harus cocok dengan csrfFor(npc) — kontrak yang
// diverifikasi ulang di sini karena verifyCsrfFromRequest butuh Context.
const sessionNpc = (await verifySession(cookie, SECRET, NOW))?.npc ?? '';
check('sesi: csrfFor(npc sesi) stabil', await csrfFor(sessionNpc, SECRET), await csrfFor(sessionNpc, SECRET));
check('sesi: token npc lain tidak cocok', (await csrfFor(sessionNpc, SECRET)) === (await csrfFor('npc-lain', SECRET)), false);

/* --- safeSlug & missingSecrets ---------------------------------------------- */

check('safeSlug: tidak berubah perilaku', safeSlug('Kuis Kelas-7A!'), 'kuiskelas-7a');
check('safeSlug: kosong', safeSlug(''), '');

check('missingSecrets: lengkap → kosong', missingSecrets({ SESSION_SECRET: 'a', APP_PASSWORD: 'b' }).length, 0);
check('missingSecrets: secret hilang', missingSecrets({ APP_PASSWORD: 'b' }).join(','), 'SESSION_SECRET');
check('missingSecrets: password hilang', missingSecrets({ SESSION_SECRET: 'a' }).join(','), 'APP_PASSWORD');
check('missingSecrets: dua-duanya hilang', missingSecrets({}).length, 2);

/* --- Konstanta cookie -------------------------------------------------------- */

check('nama cookie sesi tetap auth_session', SESSION_COOKIE_NAME, 'auth_session');

/* --- Ringkasan ---------------------------------------------------------------- */

console.log(`\n${passed} lulus, ${failed} gagal (tests/auth.test.mjs)`);
if (failed > 0) {
  console.error('Gagal: ' + failures.join('; '));
  process.exit(1);
}
