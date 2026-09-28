/* ==========================================================================
 * Test write cap media per aplikasi (src/media.ts).
 * Melengkapi temuan lama: MAX_MEDIA_PER_APP hanya dipakai sebagai `limit`
 * saat list, sehingga upload ke-201 dan seterusnya berhasil tapi tak terlihat.
 * ========================================================================== */

import {
  deleteMedia,
  getMedia,
  listMedia,
  listMediaNames,
  listMediaUnion,
  MAX_MEDIA_PER_APP,
  mediaWriteCapError,
  putMedia,
  syncMediaStats,
} from '../src/media.ts';

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

/* --- Migrasi mandiri R2 <-> KV --------------------------------------------------
 * Saat binding MEDIA aktif, getMedia harus: R2 dulu, kalau miss baru KV, lalu
 * menyalin hasil bacaan itu ke R2 dan menghapus key KV-nya. Ini yang membuat
 * gambar lama tetap tampil tanpa perlu tooling migrasi terpisah.
 * --------------------------------------------------------------------------- */

/** Mock KV yang bisa getWithMetadata + delete, dan mencatat penghapusan. */
function mockStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  const deleted = [];
  return {
    data,
    deleted,
    listCalls: 0,
    async list({ prefix, limit }) {
      this.listCalls += 1;
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
      return { keys: keys.map((name) => ({ name })) };
    },
    async getWithMetadata(key) {
      const entry = data.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.body, metadata: entry.metadata };
    },
    // KV menyimpan nilai sebagai string; entri media di mock ini dibungkus
    // `{ body, metadata }` supaya `getWithMetadata` punya sesuatu untuk
    // dikembalikan. `get` harus.unwrap bentuk itu, kalau tidak `syncMediaStats`
    // akan selalu gagal diam-diam dan tesnya jadi lulus palsu.
    async get(key) {
      const entry = data.get(key);
      if (entry === undefined) return null;
      return entry && typeof entry === 'object' && 'body' in entry ? entry.body : entry;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      deleted.push(key);
      data.delete(key);
    },
  };
}

/** Mock R2 dengan get/put/list/delete, semuanya mencatat jejak. */
function mockBucket(initial = {}) {
  const data = new Map(Object.entries(initial));
  const puts = [];
  const deleted = [];
  return {
    data,
    puts,
    deleted,
    async list({ prefix, limit }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
      return { objects: keys.map((key) => ({ key, size: 3, httpMetadata: {}, customMetadata: {} })) };
    },
    async get(key) {
      const body = data.get(key);
      if (body === undefined) return null;
      return {
        body,
        arrayBuffer: async () => body.buffer.slice(0),
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { uploadedAt: '2020-01-01T00:00:00.000Z' },
      };
    },
    async put(key, body, opts) {
      puts.push({ key, opts });
      data.set(key, body);
    },
    async delete(key) {
      deleted.push(key);
      data.delete(key);
    },
  };
}

const bytes = (s) => new TextEncoder().encode(s);

// 1. Gambar hanya di KV -> terbaca, tersalin ke R2, key KV dihapus.
{
  const kv = mockStore({
    'media:app-a:lama': { body: bytes('abc').buffer, metadata: { contentType: 'image/png', uploadedAt: 'u1' } },
  });
  const r2 = mockBucket();
  const found = await getMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'lama');
  check('read-through: gambar lama di KV tetap terbaca', found?.contentType, 'image/png');
  check('read-through: isi bytes utuh', new TextDecoder().decode(found.body), 'abc');
  check('read-through: disalin ke R2', r2.puts.length, 1);
  check('read-through: key R2 benar', r2.puts[0]?.key, 'app-a/lama');
  check('read-through: key KV dihapus', kv.deleted[0], 'media:app-a:lama');
  check('read-through: KV jadi bersih', kv.data.size, 0);
}

// 2. Gambar sudah di R2 -> KV tidak disentuh sama sekali.
{
  const kv = mockStore();
  const r2 = mockBucket({ 'app-a/baru': bytes('xyz') });
  const found = await getMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'baru');
  check('R2 hit: tidak menulis ke R2 lagi', r2.puts.length, 0);
  check('R2 hit: tidak menghapus dari KV', kv.deleted.length, 0);
  check('R2 hit: isi benar', new TextDecoder().decode(found.body), 'xyz');
}

// 3. Tidak ada di dua-duanya -> null, dan tidak ada penulisan sampingan.
{
  const kv = mockStore();
  const r2 = mockBucket();
  const found = await getMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'hilang');
  check('read-through: nama tidak ada -> null', found, null);
  check('read-through: tidak ada yang ditulis', r2.puts.length + kv.deleted.length, 0);
}

// 4. Kegagalan salin ke R2 ditelan: file tetap terbaca dari KV.
{
  const kv = mockStore({
    'media:app-a:lama': { body: bytes('abc').buffer, metadata: { contentType: 'image/png' } },
  });
  const r2 = mockBucket();
  r2.put = async () => {
    throw new Error('R2 sedang tidak bisa');
  };
  const found = await getMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'lama');
  check('R2 gagal: gambar tetap terbaca', new TextDecoder().decode(found.body), 'abc');
  check('R2 gagal: key KV tidak dihapus (aman dicoba lagi)', kv.deleted.length, 0);
}

// 5. Upload baru goes to R2 only, tidak menyentuh KV sama sekali.
{
  const kv = mockStore();
  const r2 = mockBucket();
  await putMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'baru', bytes('q').buffer, 'image/png');
  check('put: masuk R2', r2.puts[0]?.key, 'app-a/baru');
  check('put: KV tidak ditulis', kv.data.size, 0);
}

// 6. Hapus harus membersihkan KEDUA backend, kalau tidak gambar lama di KV
//    akan muncul lagi begitu dibaca lewat fallback read-through.
{
  const kv = mockStore({ 'media:app-a:lama': { body: bytes('abc').buffer, metadata: {} } });
  const r2 = mockBucket({ 'app-a/lama': bytes('abc') });
  await deleteMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a', 'lama');
  check('delete: object R2 dihapus', r2.deleted[0], 'app-a/lama');
  check('delete: key KV dihapus', kv.deleted[0], 'media:app-a:lama');
  check('delete: tidak tersisa di R2', r2.data.size, 0);
}

// 7. listMediaNames (jalur panas) tidak boleh menyentuh KV: itu yang membuat
//    kuota list 1.000/hari aman. listMediaUnion (jalur rename/hapus) boleh.
{
  const kv = mockStore({
    'media:app-a:lama': { body: bytes('a').buffer, metadata: {} },
  });
  const r2 = mockBucket({ 'app-a/baru': bytes('b') });
  const hot = await listMediaNames({ STORAGE: kv, MEDIA: r2 }, 'app-a');
  check('listMediaNames: R2 saja, tidak menggabung KV', JSON.stringify(hot), JSON.stringify(['baru']));
  const both = await listMediaUnion({ STORAGE: kv, MEDIA: r2 }, 'app-a');
  check('listMediaUnion: R2 + KV digabung', JSON.stringify(both.sort()), JSON.stringify(['baru', 'lama']));
}

// 8. Nama yang sama di R2 dan KV tidak terhitung dua kali (bounded by 200).
{
  const kv = mockStore({ 'media:app-a:sama': { body: bytes('a').buffer, metadata: {} } });
  const r2 = mockBucket({ 'app-a/sama': bytes('a') });
  const both = await listMediaUnion({ STORAGE: kv, MEDIA: r2 }, 'app-a');
  check('listMediaUnion: nama kembar tidak digandakan', both.length, 1);
}

// 9. syncMediaStats jalan di jalur panas (setiap publish soal, setiap unggah
//    gambar), jadi tidak boleh memakai `list` KV. Kalau iya, kuota 1.000/hari
//    habis sendiri tanpa ada yang menyadarinya. Daftar gambarnya cukup dari R2;
//    gambar lama baru ikut terhitung setelah sempat dibaca dan pindah ke R2.
{
  const kv = mockStore({
    'meta:app-a': JSON.stringify({ slug: 'app-a', title: 'App A', type: 'json' }),
    // Slot media dipindai dari pola `media: <nama>` di dalam teks soal.
    'quiz:app-a': JSON.stringify({
      slug: 'app-a',
      title: 'App A',
      questions: [{ type: 'choice', text: 'Perhatikan media: gambar1', options: ['a', 'b'], answer: 'a' }],
    }),
    'media:app-a:lama': { body: bytes('a').buffer, metadata: {} },
  });
  const r2 = mockBucket({ 'app-a/baru': bytes('b') });
  await syncMediaStats({ STORAGE: kv, MEDIA: r2 }, 'app-a');
  check('syncMediaStats: tidak memanggil list KV', kv.listCalls, 0);
  const meta = JSON.parse(kv.data.get('meta:app-a'));
  check('syncMediaStats: slot media tetap tercatat', JSON.stringify(meta.media_slots), JSON.stringify(['gambar1']));
  check('syncMediaStats: nama gambar dari R2', JSON.stringify(meta.media_names), JSON.stringify(['baru']));
}


// 10. Panel gambar harus tetap bisa dibuka saat kuota `list` KV habis.
//     `listMedia` dipakai `GET /p/:slug/media`, jadi kalau error 429-nya
//     diteruskan, halaman panelnya gagal dimuat dan guru tidak bisa mengunggah
//     gambar sama sekali — meski daftar R2-nya sudah lengkap. Ini persis
//     gejala "nggak bisa input gambar".
{
  const kv = mockStore({
    'media:app-a:lama': { body: bytes('a').buffer, metadata: {} },
  });
  kv.list = async () => {
    kv.listCalls += 1;
    throw new Error('10048 free usage limit');
  };
  const r2 = mockBucket({ 'app-a/baru': bytes('b') });
  const items = await listMedia({ STORAGE: kv, MEDIA: r2 }, 'app-a');
  check('listMedia tetap hidup saat list KV 429', items.length, 1);
  check('listMedia: gambar dari R2 tetap tampil', items[0].name, 'baru');
}

// 11. Tanpa binding R2, KV adalah satu-satunya penyimpanan — error-nya harus
//     tetap terdengar, bukan ditelan, supaya tidak ada data yang hilang diam-diam.
{
  const kv = mockStore({ 'media:app-a:aja': { body: bytes('a').buffer, metadata: {} } });
  kv.list = async () => {
    throw new Error('10048 free usage limit');
  };
  let ditolak = false;
  try {
    await listMedia({ STORAGE: kv }, 'app-a');
  } catch {
    ditolak = true;
  }
  check('tanpa R2: kegagalan KV tidak ditelan', ditolak, true);
}

/* --- Ringkasan ----------------------------------------------------------------- */

console.log(`\n${passed} lulus, ${failed} gagal (tests/media-cap.test.mjs)`);
if (failed > 0) {
  console.error('Gagal: ' + failures.join('; '));
  process.exit(1);
}
