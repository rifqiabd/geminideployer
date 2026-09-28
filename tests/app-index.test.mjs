/* ==========================================================================
 * Test indeks aplikasi R2 (src/app-index.ts).
 *
 * Yang paling penting di sini: dashboard harus tetap bisa memuat aplikasi
 * walaupun `list` KV sedang diblokir kuota harian (error 10048). Itu sebabnya
 * index R2 ada — dan karena itu `listAppsForDashboard` sengaja tidak boleh
 * menyentuh `list` KV sama sekali, hanya `backfillIndexFromKv` yang boleh.
 * ========================================================================== */

import {
  backfillIndexFromKv,
  deleteAppMeta,
  listAppsForDashboard,
  writeAppMeta,
} from '../src/app-index.ts';

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

/** Mock KV. `listBoom` menyimulasikan kuota list harian habis (error 10048). */
function mockKv(initial = {}, { listBoom = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    listCalls: 0,
    async list({ prefix }) {
      this.listCalls += 1;
      if (listBoom) throw new Error('10048 free usage limit');
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

/** Mock R2 dengan list/get/put/delete. */
function mockBucket(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    puts: [],
    async list({ prefix }) {
      return { objects: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
    async get(key) {
      const body = data.get(key);
      if (body === undefined) return null;
      return { json: async () => JSON.parse(body) };
    },
    async put(key, value) {
      this.puts.push(key);
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

const meta = (slug, over = {}) => JSON.stringify({ slug, title: slug, type: 'json', ...over });
const slugs = (list) => list.map((m) => m.slug).sort().join(',');

/* --- writeAppMeta: KV + cermin R2 ------------------------------------------ */

{
  const kv = mockKv();
  const r2 = mockBucket();
  await writeAppMeta({ STORAGE: kv, MEDIA: r2 }, { slug: 'kuis-a', title: 'A', type: 'json' });
  check('write: masuk KV', kv.data.has('meta:kuis-a'), true);
  check('write: dicerminkan ke R2', r2.puts[0], '_index/app/kuis-a.json');
  check('write: isi R2 sama dengan KV', r2.data.get('_index/app/kuis-a.json'), kv.data.get('meta:kuis-a'));
}

/* --- writeAppMeta tanpa binding MEDIA: tetap normal (mode KV-only) ---------- */

{
  const kv = mockKv();
  await writeAppMeta({ STORAGE: kv }, { slug: 'kuis-b', title: 'B' });
  check('write tanpa MEDIA: tetap masuk KV', kv.data.has('meta:kuis-b'), true);
}

/* --- INTI: dashboard tetap hidup saat list KV diblokir kuota --------------- */

{
  const kv = mockKv({ 'meta:lama-1': meta('lama-1'), 'meta:lama-2': meta('lama-2') }, { listBoom: true });
  const r2 = mockBucket({
    '_index/app/kuis-a.json': meta('kuis-a'),
    '_index/app/kuis-b.json': meta('kuis-b'),
  });
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('list KV diblokir: aplikasi dari R2 tetap termuat', slugs(apps), 'kuis-a,kuis-b');
}

/* --- Guard utama: dashboard TIDAK BOLEH pernah memakai `list` KV ------------
 * Kuota `list` KV cuma 1.000/hari. Begitu habis, satu panggilan gagal sudah
 * cukup untuk membuat dashboard menampilkan nol aplikasi. Jadi daftar aplikasi
 * harus sepenuhnya berasal dari index R2, dan `list` KV hanya boleh dipakai
 * oleh perintah backfill yang dipanggil admin secara sadar.
 * ------------------------------------------------------------------------- */

{
  const kv = mockKv({ 'meta:lama-1': meta('lama-1') });
  const r2 = mockBucket({ '_index/app/kuis-a.json': meta('kuis-a') });
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('dashboard: list KV tidak dipanggil', kv.listCalls, 0);
  check('dashboard: hanya baca index R2', slugs(apps), 'kuis-a');
}

{
  // list KV sengaja dibuat meledak. Kalau dashboard masih menyentuh KV,
  // halaman ini akan gagal — persis kondisi produksi hari ini.
  const kv = mockKv({ 'meta:lama-1': meta('lama-1') }, { listBoom: true });
  const r2 = mockBucket({ '_index/app/kuis-a.json': meta('kuis-a') });
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('dashboard tetap hidup saat list KV 429', slugs(apps), 'kuis-a');
}

{
  // Index R2 kosong, KV penuh. Tanpa D1 tidak ada yang bisa ditemukan — dan
  // itu memang perilaku yang diharapkan, bukan regresi: aplikasi yang belum
  // pernah ada di D1 dipindahkan lewat backfill, bukan lewat render dashboard.
  const kv = mockKv({ 'meta:lama-1': meta('lama-1') });
  const r2 = mockBucket();
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('index kosong: tidak diam-diam fallback ke KV', slugs(apps), '');
  check('index kosong: tetap tanpa list KV', kv.listCalls, 0);
}

/* --- Object index rusak tidak boleh menjatuhkan seluruh dashboard ----------- */

{
  const kv = mockKv({}, { listBoom: true });
  const r2 = mockBucket({
    '_index/app/baik.json': meta('baik'),
    '_index/app/rusak.json': '{ ini bukan json',
  });
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('object index rusak dilewati', slugs(apps), 'baik');
}

/* --- Object index tanpa slug diabaikan ------------------------------------ */

{
  const kv = mockKv({}, { listBoom: true });
  const r2 = mockBucket({ '_index/app/no-slug.json': JSON.stringify({ title: 'tanpa slug' }) });
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('index tanpa slug diabaikan', apps.length, 0);
}

/* --- deleteAppMeta membersihkan kedua backend ------------------------------ */

{
  const kv = mockKv({ 'meta:lama-1': meta('lama-1') });
  const r2 = mockBucket({ '_index/app/lama-1.json': meta('lama-1') });
  await deleteAppMeta({ STORAGE: kv, MEDIA: r2 }, 'lama-1');
  check('delete: key KV hilang', kv.data.size, 0);
  check('delete: object index hilang', r2.data.size, 0);
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('delete: aplikasi tidak muncul lagi', apps.length, 0);
}

/* --- Kegagalan menulis ke R2 tidak menggagalkan publish -------------------- */

{
  const kv = mockKv();
  const r2 = mockBucket();
  r2.put = async () => {
    throw new Error('R2 tidak bisa');
  };
  await writeAppMeta({ STORAGE: kv, MEDIA: r2 }, { slug: 'tahan-banting', title: 'X' });
  check('R2 gagal: meta tetap tersimpan di KV', kv.data.has('meta:tahan-banting'), true);
}

/* --- Bootstrap dari D1: index R2 kosong + list KV diblokir ----------------
 * Ini jalur yang bikin dashboard tetap terpakai saat kuota `list` habis:
 * slug diambil dari app_records, lalu meta-nya dibaca (READ, bukan list).
 * ------------------------------------------------------------------------ */

{
  const kv = mockKv(
    { 'meta:dari-kiriman': meta('dari-kiriman'), 'meta:tanpa-kiriman': meta('tanpa-kiriman') },
    { listBoom: true }
  );
  const r2 = mockBucket();
  const db = {
    // `prepare` di D1 asli sinkron, jadi mock ini juga harus sinkron.
    prepare(sql) {
      if (!/FROM app_records/.test(sql)) throw new Error('query tak terduga: ' + sql);
      return { all: async () => ({ results: [{ app_slug: 'dari-kiriman' }] }) };
    },
  };
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2, DB: db });
  check('bootstrap D1: aplikasi dari kiriman masuk', slugs(apps), 'dari-kiriman');
  check('bootstrap D1: meta ikut dicerminkan ke R2', r2.data.has('_index/app/dari-kiriman.json'), true);
  check('bootstrap D1: app tanpa kiriman tidak ikut (ditunggu reset kuota)', apps.length, 1);
}

/* --- Bootstrap D1 hanya jalan saat index masih kosong ---------------------- */

{
  const kv = mockKv({ 'meta:sudah-di-index': meta('sudah-di-index') }, { listBoom: true });
  const r2 = mockBucket({ '_index/app/sudah-di-index.json': meta('sudah-di-index') });
  let dbDipakai = false;
  const db = {
    prepare() {
      dbDipakai = true;
      return { all: async () => ({ results: [{ app_slug: 'dari-kiriman' }] }) };
    },
  };
  await listAppsForDashboard({ STORAGE: kv, MEDIA: r2, DB: db });
  check('index sudah terisi: D1 tidak dikueri', dbDipakai, false);
}

/* --- D1 error tidak boleh menjatuhkan dashboard ---------------------------- */

{
  const kv = mockKv({}, { listBoom: true });
  const r2 = mockBucket({ '_index/app/nyata.json': meta('nyata') });
  const db = {
    prepare() {
      throw new Error('D1 tidak bisa');
    },
  };
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2, DB: db });
  check('D1 gagal: index R2 tetap dipakai', apps.length, 1);
}

/* --- Backfill: satu-satunya jalur yang boleh memakai `list` KV --------------- */

{
  const kv = mockKv({
    'meta:lama-1': meta('lama-1'),
    'meta:lama-2': meta('lama-2'),
    'bukan-meta': 'abaikan saya',
  });
  const r2 = mockBucket();
  const hasil = await backfillIndexFromKv({ STORAGE: kv, MEDIA: r2 });
  check('backfill: list KV dipanggil tepat sekali', kv.listCalls, 1);
  check('backfill: jumlah ditemukan', hasil.found, 2);
  check('backfill: jumlah dicerminkan', hasil.mirrored, 2);
  const apps = await listAppsForDashboard({ STORAGE: kv, MEDIA: r2 });
  check('backfill: dashboard langsung memuat semuanya', slugs(apps), 'lama-1,lama-2');
  check('backfill: render berikutnya tanpa list KV', kv.listCalls, 1);
}

{
  // `list` masih habis: backfill harus melaporkan "tidak ada yang dipindai",
  // bukan diam-diam dianggap berhasil.
  const kv = mockKv({ 'meta:lama-1': meta('lama-1') }, { listBoom: true });
  const r2 = mockBucket();
  const hasil = await backfillIndexFromKv({ STORAGE: kv, MEDIA: r2 });
  check('backfill gagal: found nol', hasil.found, 0);
  check('backfill gagal: mirrored nol', hasil.mirrored, 0);
}

/* --- Ringkasan ----------------------------------------------------------------- */

console.log(`\n${passed} lulus, ${failed} gagal (tests/app-index.test.mjs)`);
if (failed > 0) {
  console.error('Gagal: ' + failures.join('; '));
  process.exit(1);
}
