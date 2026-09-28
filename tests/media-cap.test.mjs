/* ==========================================================================
 * Test write cap media per aplikasi (src/media.ts).
 * Melengkapi temuan lama: MAX_MEDIA_PER_APP hanya dipakai sebagai `limit`
 * saat list, sehingga upload ke-201 dan seterusnya berhasil tapi tak terlihat.
 * ========================================================================== */

import { listMediaNames, MAX_MEDIA_PER_APP, mediaWriteCapError } from '../src/media.ts';

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

/** Mock KV minimal: hanya list() yang dipakai listMediaNames. */
function mockKv(keys) {
  return {
    async list({ prefix, limit }) {
      const matched = keys.filter((name) => name.startsWith(prefix)).slice(0, limit);
      return { keys: matched.map((name) => ({ name })) };
    },
  };
}

/** Mock R2 minimal: hanya list() yang dipakai listMediaNames. */
function mockR2(keys) {
  return {
    async list({ prefix, limit }) {
      const matched = keys.filter((key) => key.startsWith(prefix)).slice(0, limit);
      return { objects: matched.map((key) => ({ key })) };
    },
  };
}

/* --- listMediaNames: KV ---------------------------------------------------- */

const kvEnv = {
  STORAGE: mockKv([
    'media:app-a:foto-1',
    'media:app-a:foto-2.jpg',
    'media:app-b:lain',
    'meta:app-a',
  ]),
};
check(
  'listMediaNames KV: nama slot tanpa prefix, kunci lain tidak ikut',
  JSON.stringify(await listMediaNames(kvEnv, 'app-a')),
  JSON.stringify(['foto-1', 'foto-2.jpg'])
);
check('listMediaNames KV: app tanpa media -> kosong', (await listMediaNames(kvEnv, 'app-c')).length, 0);

/* --- listMediaNames: R2 ----------------------------------------------------- */

const r2Env = { MEDIA: mockR2(['app-a/foto-1', 'app-a/foto-2.jpg', 'app-b/lain']) };
check(
  'listMediaNames R2: nama slot dari object key',
  JSON.stringify(await listMediaNames(r2Env, 'app-a')),
  JSON.stringify(['foto-1', 'foto-2.jpg'])
);

/* --- mediaWriteCapError ------------------------------------------------------ */

check('cap: di bawah batas -> null', mediaWriteCapError(['a', 'b'], 'c'), null);
check('cap: daftar kosong -> null', mediaWriteCapError([], 'c'), null);
check('cap: overwrite slot yang sudah ada -> null', mediaWriteCapError(['a', 'b', 'c'], 'c'), null);
check('cap: konstanta tetap 200', MAX_MEDIA_PER_APP, 200);

/* --- Batas pas 200 ------------------------------------------------------------ */

const penuh = Array.from({ length: MAX_MEDIA_PER_APP }, (_, i) => `slot-${i}`);
const capResult = mediaWriteCapError(penuh, 'slot-baru');
check('cap: 200 slot + slot baru -> ditolak', typeof capResult, 'string');
check('cap: pesan menyebut batas 200', capResult.includes(String(MAX_MEDIA_PER_APP)), true);
check('cap: 200 slot + overwrite -> diizinkan', mediaWriteCapError(penuh, 'slot-0'), null);
const hampir = penuh.slice(0, MAX_MEDIA_PER_APP - 1);
check('cap: 199 slot + slot baru -> diizinkan', mediaWriteCapError(hampir, 'slot-baru'), null);

/* --- Ringkasan ----------------------------------------------------------------- */

console.log(`\n${passed} lulus, ${failed} gagal (tests/media-cap.test.mjs)`);
if (failed > 0) {
  console.error('Gagal: ' + failures.join('; '));
  process.exit(1);
}
