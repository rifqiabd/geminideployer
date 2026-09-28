/* ==========================================================================
 * Indeks aplikasi di R2 — supaya dashboard tidak perlu `list` KV.
 * --------------------------------------------------------------------------`
 * Kenapa perlu:
 *   Kuota free Workers KV itu 1.000 LIST per HARI (tulis/hapus 1.000 juga,
 *   baca 100.000). Memakai `list({prefix:'meta:'})` untuk memuat sidebar berarti
 *   1 list per buka dashboard, dan begitu kuota itu habis dashboard langsung
 *   500 — bukan karena data hilang, tapi karena satu panggilan diblokir.
 *
 * Cara kerja:
 *   Setiap meta aplikasi juga disalin ke object R2 `_index/app/<slug>.json`.
 *   Satu object per aplikasi, BUKAN satu index besar, jadi tidak ada baca-ubah-
 *   tulis yang bisa saling menimpa saat dua publish berjalan bersamaan.
 *
 * Kenapa prefix `_index/` aman:
 *   Object media memakai `<slug>/<nama>`, dan `safeSlug()` hanya mengizinkan
 *   [a-z0-9-] — jadi tidak mungkin ada media yang object's diawali `_index/`.
 *
 * Perilaku lama tetap jadi cadangan:
 *   `listAppsForDashboard` tetap mencoba `list` KV (best-effort, error ditelan)
 *   lalu menggabungkannya. Begitu kuota harian pulih, aplikasi lama muncul
 *   kembali dengan sendirinya tanpa perlu migrasi manual. KV menang kalau ada
 *   slug yang sama di kedua tempat, karena KV yang jadi sumber kebenaran.
 * ========================================================================== */

const INDEX_PREFIX = '_index/app/';

/**
 * Bentuk meta aplikasi. Field yang dipakai dashboard dideklarasikan eksplisit
 * (walau sebenarnya semua bebas), supaya tipe tetap sempit dan dashboard bisa
 * membaca `slug` tanpa cast.
 */
type AppMeta = {
  slug?: string;
  type?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  size?: unknown;
  // Diisi `syncMediaStats`; lihat media-routes.ts untuk pemakaiannya.
  media_slots?: unknown;
  media_names?: unknown;
  [key: string]: unknown;
};
type IndexBindings = { STORAGE: KVNamespace; MEDIA?: R2Bucket; DB?: D1Database };

export type { AppMeta, IndexBindings };

function indexKey(slug: string): string {
  return `${INDEX_PREFIX}${slug}.json`;
}

function slugOf(meta: AppMeta | null): string {
  const slug = meta?.slug;
  return typeof slug === 'string' ? slug : '';
}

/**
 * Cermin meta ke R2. Mengembalikan `true` kalau benar-benar tersimpan.
 *
 * Nilai balik dipakai `backfillIndexFromKv` untuk memberi tahu admin berapa
 * yang berhasil; kalau R2 tidak terpasang atau sedang gagal, hasilnya `false`
 * supaya angka di layar tidak menyesatkan.
 */
async function mirrorToIndex(env: IndexBindings, meta: AppMeta): Promise<boolean> {
  if (!env.MEDIA) return false;
  const slug = slugOf(meta);
  if (!slug) return false;
  try {
    await env.MEDIA.put(indexKey(slug), JSON.stringify(meta), {
      httpMetadata: { contentType: 'application/json' },
    });
    return true;
  } catch {
    // Index cuma bayangan dari KV: aplikasi tetap utuh di KV, dan bisa
    // dipindahkan lagi lewat `POST /api/app-index/backfill`.
    return false;
  }
}

/**
 * Tulis meta aplikasi ke KV (sumber kebenaran) lalu cermin ke index R2.
 * Dipakai di SETIAP tempat yang menulis `meta:<slug>` supaya tidak ada jalur
 * yang hanya menulis KV sehingga aplikasinya hilang dari dashboard.
 */
export async function writeAppMeta(env: IndexBindings, meta: AppMeta): Promise<void> {
  const slug = slugOf(meta);
  if (!slug) return;
  await env.STORAGE.put(`meta:${slug}`, JSON.stringify(meta));
  await mirrorToIndex(env, meta);
}

/** Hapus meta aplikasi dari KV dan index R2 secara berpasangan. */
export async function deleteAppMeta(env: IndexBindings, slug: string): Promise<void> {
  await env.STORAGE.delete(`meta:${slug}`);
  if (!env.MEDIA) return;
  try {
    await env.MEDIA.delete(indexKey(slug));
  } catch {
    // Objek index yang tertinggal cuma perlu dihapus manual, tidak berbahaya.
  }
}

async function readIndexObjects(env: IndexBindings): Promise<AppMeta[]> {
  if (!env.MEDIA) return [];
  const listed = await env.MEDIA.list({ prefix: INDEX_PREFIX, limit: 1000 });
  const metas = await Promise.all(
    listed.objects.map(async (object) => {
      try {
        // `list` cuma mengembalikan metadata, jadi isinya diambil ulang per object.
        const body = await env.MEDIA!.get(object.key);
        if (!body) return null;
        const parsed = (await body.json()) as AppMeta | null;
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    })
  );
  return metas.filter((meta): meta is AppMeta => meta !== null && Boolean(slugOf(meta)));
}

/** Apps dari KV. Sengaja menelan exception: kuota list habis bukan berarti gagal. */
async function readKvApps(env: IndexBindings): Promise<AppMeta[]> {
  try {
    const listed = await env.STORAGE.list({ prefix: 'meta:', limit: 1000 });
    const metas = await Promise.all(
      listed.keys.map(async (key) => {
        try {
          const raw = await env.STORAGE.get(key.name);
          return raw ? (JSON.parse(raw) as AppMeta) : null;
        } catch {
          return null;
        }
      })
    );
    return metas.filter((meta): meta is AppMeta => meta !== null && Boolean(slugOf(meta)));
  } catch {
    return [];
  }
}

/**
 * Darurat, hanya jalan saat index R2 masih kosong: ambil slug dari D1.
 *
 * `app_records.app_slug` sudah mencatat setiap aplikasi yang pernah menerima
 * kiriman siswa, dan D1 tidak punya kuota harian sekecil KV. Jadi ini bisa
 * menemukan aplikasi lama TANPA satu pun `list` KV — penting justru saat kuota
 * `list` sedang habis, karena saat begitu tidak ada cara lain untuk tahu
 * aplikasi apa saja yang ada.
 *
 * Yang tidak tertangkap: aplikasi yang belum pernah menerima kiriman siswa. Itu
 * otomatis ikut muncul begitu kuota `list` pulih, lewat `readKvApps`.
 *
 * Hasilnya ikut dicerminkan ke R2, jadi index terisi sendiri dan jalur ini
 * tidak dijalankan lagi pada render berikutnya.
 */
async function readD1Slugs(env: IndexBindings): Promise<AppMeta[]> {
  if (!env.DB) return [];
  try {
    // WITHOUT ORDER BY: `DISTINCT` + `ORDER BY kolom_terpilih` ditolak SQLite,
    // dan urutan di sini tidak berpengaruh apa pun — dashboard mengurutkan
    // ulang sendiri dari `created_at` milik masing-masing meta.
    const result = await env.DB.prepare('SELECT DISTINCT app_slug FROM app_records').all<{
      app_slug: string;
    }>();
    const rows = (result?.results ?? []) as { app_slug: string }[];
    const metas = await Promise.all(
      rows.map(async ({ app_slug }) => {
        if (!app_slug) return null;
        try {
          // Ini READ, bukan list: kuota baca KV 100.000/hari, aman.
          const raw = await env.STORAGE.get(`meta:${app_slug}`);
          return raw ? (JSON.parse(raw) as AppMeta) : null;
        } catch {
          return null;
        }
      })
    );
    const found = metas.filter((meta): meta is AppMeta => meta !== null && Boolean(slugOf(meta)));
    await Promise.all(found.map((meta) => mirrorToIndex(env, meta)));
    return found;
  } catch {
    return [];
  }
}

/**
 * Daftar aplikasi untuk dashboard: index R2, ditambah D1 sebagai行本 saat
 * index masih kosong.
 *
 * Sengaja TIDAK ada `list` KV di sini. Kuota `list` harian KV cuma 1.000
 * operasi dan setelah habis seluruh dashboard mati, karena satu `list` yang
 * gagal sudah cukup untuk membuat halaman tidak menampilkan aplikasi
 * apa pun. Semua pembacaan yang tersisa lewat `get` per slug, yang kuotanya
 * 100.000/hari dan tidak jadi masalah.
 *
 * Untuk memindahkan aplikasi lama yang tidak ada di D1, jalankan
 * `POST /api/app-index/backfill` satu kali: perintah itu memakai satu
 * `list` KV dan setelah itu index R2 tidak pernah butuh `list` lagi.
 */
export async function listAppsForDashboard(env: IndexBindings): Promise<AppMeta[]> {
  const indexed = await readIndexObjects(env);
  const merged = new Map<string, AppMeta>();
  for (const meta of indexed) {
    const slug = slugOf(meta);
    if (slug) merged.set(slug, meta);
  }

  // Index masih kosong -> cari slug dari D1 supaya dashboard langsung punya isi
  // walau `list` KV sedang diblokir.
  if (merged.size === 0) {
    for (const meta of await readD1Slugs(env)) {
      const slug = slugOf(meta);
      if (slug) merged.set(slug, meta);
    }
  }

  return [...merged.values()];
}

/**
 * Satu kali jalan: pindahkan seluruh aplikasi yang masih hidup di KV ke index
 * R2 memakai satu `list` KV. Setelah ini, dashboard tidak pernah memakai
 * `list` KV lagi — termasuk setelah kuota hari ini habis.
 */
export async function backfillIndexFromKv(env: IndexBindings): Promise<{ mirrored: number; found: number }> {
  const metas = await readKvApps(env);
  const usable = metas.filter((meta) => Boolean(slugOf(meta)));
  const results = await Promise.all(usable.map((meta) => mirrorToIndex(env, meta)));
  return { found: metas.length, mirrored: results.filter(Boolean).length };
}
