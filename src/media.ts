/* ==========================================================================
 * Penyimpanan media (foto soal) hasil unggahan guru.
 * --------------------------------------------------------------------------
 * Kenapa harus diunggah, bukan ditempel di JSON?
 *   Gem/Gemini hanya menghasilkan TEKS. Ia tidak bisa menempelkan file gambar
 *   ke dalam kode yang dibuatnya, dan data URI base64 bikin JSON soal berat
 *   serta sulit dibaca. Jadi soal cukup menulis `media:nama-slot`, lalu guru
 *   mengunggah fotonya lewat panel Gambar.
 *
 * Tempat simpan: R2 kalau binding MEDIA dipasang, kalau tidak otomatis pakai
 * KV (binding STORAGE yang sudah ada) — jadi tidak wajib setup apa pun.
 * ========================================================================== */

// Impor sengaja memakai ekstensi .ts: file ini ikut dijalankan langsung oleh Node
// dari tests/quiz.test.mjs, dan Node ESM tidak menebak ekstensi seperti esbuild.
import { collectMediaSlotsFromStored, escapeHtml, sanitizeMediaName, stampNow } from './quiz.ts';
import { writeAppMeta } from './app-index.ts';
import type { AppMeta } from './app-index.ts';

export type MediaBindings = {
  STORAGE: KVNamespace;
  MEDIA?: R2Bucket;
  // Opsional: API generate gambar AI (proxy free-image-generation-api).
  // Kalau keduanya diisi, panel Gambar mendapat tombol "Generate AI".
  IMGGEN_API_URL?: string;
  IMGGEN_API_KEY?: string;
  // Wajib sejak hardening auth: dipakai verifikasi sesi admin dan token CSRF.
  SESSION_SECRET?: string;
  // Opsional: allowlist CORS untuk endpoint admin.
  ALLOWED_ORIGINS?: string;
};

/** Batas ukuran satu file. Foto dari HP (3-5 MB) masih masuk, video tidak. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export const MAX_MEDIA_PER_APP = 200;

/**
 * Daftar nama slot media yang sudah ada untuk satu aplikasi — hanya nama, tanpa
 * membaca isi file. Satu operasi `list` per pemanggilan, jadi murah dipakai
 * sebagai guard sebelum setiap tulis.
 *
 * Dipisah dari `listMedia()` (yang membaca metadata tiap file) karena pemakaian
 * utamanya adalah menghitung dan mengecek keberadaan nama, bukan menampilkan
 * detail ke panel.
 *
 * Kalau binding MEDIA aktif, R2 yang jadi acuan dan KV tidak dilist sama
 * sekali. Alasannya kuota: `list` KV free hanya 1.000 per HARI, dan jalur panas
 * (panel Gambar, dashboard, guard batas unggah) memanggil fungsi ini terus
 * teruss. Gambar lama yang masih di KV tidak hilang — `getMedia` memindahkannya
 * ke R2 saat pertama kali dibaca, dan `listMediaUnion` (dipakai jalur rename dan
 * hapus aplikasi) tetap melihat keduanya.
 */
export async function listMediaNames(env: MediaBindings, slug: string): Promise<string[]> {
  if (env.MEDIA) return r2Names(env, slug);
  return kvNames(env, slug);
}

/**
 * Batas tulis media per aplikasi (bug lama: batas hanya dipakai sebagai `limit`
 * saat list, sehingga upload ke-201 dan seterusnya berhasil tapi tak terlihat).
 *
 * Mengembalikan pesan error bila menulis `name` akan melewati batas, atau null
 * bila boleh. Menimpa slot yang sudah ada TIDAK dihitung tulis baru — revisi
 * foto di aplikasi penuh tetap harus jalan.
 */
export function mediaWriteCapError(existingNames: string[], name: string): string | null {
  if (existingNames.includes(name)) return null;
  if (existingNames.length < MAX_MEDIA_PER_APP) return null;
  return `Batas ${MAX_MEDIA_PER_APP} gambar per aplikasi sudah tercapai. Hapus gambar yang tidak terpakai di panel Gambar dulu.`;
}

export type StoredMedia = {
  body: ArrayBuffer;
  contentType: string;
  size: number;
  uploadedAt: string;
};

export type MediaListItem = {
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

/**
 * Tipe file ditentukan dari isi file (magic bytes), bukan dari Content-Type
 * kiriman browser yang gampang dipalsukan. SVG sengaja tidak diterima: file SVG
 * bisa berisi <script> dan disajikan dari domain yang sama (celah XSS).
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp';
  const ascii = (start: number) => String.fromCharCode(at(start), at(start + 1), at(start + 2), at(start + 3));
  if (ascii(0) === 'RIFF' && ascii(8) === 'WEBP') return 'image/webp';
  if (ascii(4) === 'ftyp') {
    const brand = ascii(8);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** Nama file kiriman guru -> nama slot yang dipakai di JSON soal. */
export function suggestMediaName(fileName: string, fallback = ''): string {
  const withoutExt = String(fileName ?? '').replace(/\.[^.]+$/, '');
  return sanitizeMediaName(withoutExt) || sanitizeMediaName(fallback);
}

function kvKey(slug: string, name: string): string {
  return `media:${slug}:${name}`;
}

function objectKey(slug: string, name: string): string {
  return `${slug}/${name}`;
}

async function r2Names(env: MediaBindings, slug: string): Promise<string[]> {
  if (!env.MEDIA) return [];
  const listed = await env.MEDIA.list({ prefix: `${slug}/`, limit: MAX_MEDIA_PER_APP });
  return listed.objects.map((object) => object.key.slice(slug.length + 1));
}

async function kvNames(env: MediaBindings, slug: string): Promise<string[]> {
  const prefix = kvKey(slug, '');
  const listed = await env.STORAGE.list({ prefix, limit: MAX_MEDIA_PER_APP });
  return listed.keys.map((key) => key.name.slice(prefix.length));
}

/**
 * `kvNames` yang menelan error.
 *
 * `list` KV punya kuota harian yang sangat kecil dan bisa habis kapan saja
 * (HTTP 429). Itu tidak apa-apa untuk satu jalur yang memang boleh gagal
 * pelan, tapi `listMediaUnion` dipakai saat rename dan hapus aplikasi — kalau
 * error-nya diteruskan, satu aplikasi yang bermasalah akan membuat seluruh
 * perintah rename/hapus ikut gagal. Jadi kuota habis diperlakukan sebagai
 * "KV tidak menambah apa-apa" di sini, bukan sebagai kegagalan.
 */
async function safeKvNames(env: MediaBindings, slug: string): Promise<string[]> {
  try {
    return await kvNames(env, slug);
  } catch {
    return [];
  }
}

/** Simpan gambar. Nama slot yang sama akan menimpa gambar lama (revisi aman). */
export async function putMedia(
  env: MediaBindings,
  slug: string,
  name: string,
  body: ArrayBuffer,
  contentType: string
): Promise<string> {
  const uploadedAt = new Date().toISOString();
  if (env.MEDIA) {
    await env.MEDIA.put(objectKey(slug, name), body, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { uploadedAt },
    });
  } else {
    await env.STORAGE.put(kvKey(slug, name), body, { metadata: { contentType, uploadedAt } });
  }
  return uploadedAt;
}

/**
 * Baca satu gambar, R2 dulu lalu KV.
 *
 * Migrasi mandiri: kalau R2 belum punya file ini tapi KV masih punya, file-nya
 * disalin ke R2 dan KEY KV-nya dihapus (best-effort) sebelum dikembalikan.
 * Setiap gambar lama pindah tepat satu kali, saat pertama kali dibaca — tidak
 * perlu jendela downtime dan tidak perlu tooling terpisah.
 *
 * Kegagalan salin atau hapus ditelan: file di KV tetap terbaca seperti biasa,
 * jadi worsenya hanya "belum pindah", bukan "gambar hilang". Kalau kuota hapus KV
 * sedang habis, salinannya tetap berhasil sehingga R2 jadi acuan dan file tidak
 * terbaca dua kali.
 */
export async function getMedia(env: MediaBindings, slug: string, name: string): Promise<StoredMedia | null> {
  if (env.MEDIA) {
    const object = await env.MEDIA.get(objectKey(slug, name));
    if (object) {
      const body = await object.arrayBuffer();
      return {
        body,
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
        size: body.byteLength,
        uploadedAt: object.customMetadata?.uploadedAt ?? '',
      };
    }
  }

  const stored = await env.STORAGE.getWithMetadata(kvKey(slug, name), 'arrayBuffer');
  if (!stored.value) return null;
  const meta = (stored.metadata ?? {}) as { contentType?: string; uploadedAt?: string };
  if (env.MEDIA) await migrateToR2(env, slug, name, stored.value, meta);
  return {
    body: stored.value,
    contentType: meta.contentType ?? 'application/octet-stream',
    size: stored.value.byteLength,
    uploadedAt: meta.uploadedAt ?? '',
  };
}

async function migrateToR2(
  env: MediaBindings,
  slug: string,
  name: string,
  body: ArrayBuffer,
  meta: { contentType?: string; uploadedAt?: string }
): Promise<void> {
  if (!env.MEDIA) return;
  const contentType = meta.contentType ?? contentTypeFromName(name);
  try {
    await env.MEDIA.put(objectKey(slug, name), body, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: meta.uploadedAt ? { uploadedAt: meta.uploadedAt } : undefined,
    });
  } catch {
    // Salin gagal: biarkan file tetap hidup di KV dan coba lagi lain kali.
    return;
  }
  try {
    await env.STORAGE.delete(kvKey(slug, name));
  } catch {
    // Salin sudah berhasil, jadi R2 yang jadi acuan. Sisa di KV cuma kuota
    // yang tidak terpakai, bukan data yang hilang.
  }
}

/**
 * Daftar lengkap media untuk panel Gambar, lengkap dengan ukuran dan waktu
 * unggah.
 *
 * Panel ini dibuka guru secara sadar dan jarang, jadi di sini boleh paying satu
 * `list` KV untuk menangkap gambar lama yang belum pindah — kalau tidak, gambar
 * unggahan sebelum R2 aktif akan hilang dari panel dan tidak pernah memicu
 * migrasi (karena migrasi terjadi saat file dibaca, sedangkan nama file-nya tidak
 * pernah tampil).
 *
 * Gambar sisa dari KV ikut disalin ke R2 lewat `getMedia`, jadi setiap kali
 * panel dibuka, sisa yang tertinggal menyusut.
 */
export async function listMedia(env: MediaBindings, slug: string): Promise<MediaListItem[]> {
  if (!env.MEDIA) return legacyItems(env, slug, await kvNames(env, slug));

  const listed = await env.MEDIA.list({ prefix: `${slug}/`, limit: MAX_MEDIA_PER_APP });
  const items: MediaListItem[] = listed.objects.map((object) => ({
    name: object.key.slice(slug.length + 1),
    contentType: object.httpMetadata?.contentType ?? contentTypeFromName(object.key),
    size: object.size,
    uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded?.toISOString() ?? '',
  }));

  const migrated = new Set(items.map((item) => item.name));
  // `safeKvNames`, bukan `kvNames`: pemanggilan ini terjadi tiap kali guru
  // membuka panel gambar. Kalau error kuota `list` diteruskan ke sini, seluruh
  // halaman panel gambar gagal dimuat dan guru tidak bisa mengunggah apa pun —
  // padahal daftar R2-nya sendiri sudah lengkap. Gambar lama yang belum
  // terhitung hanya hilang dari daftar, bukan membuat unggahan macet.
  const legacyNames = (await safeKvNames(env, slug)).filter((name) => !migrated.has(name));
  if (legacyNames.length) items.push(...(await legacyItems(env, slug, legacyNames)));
  return items;
}

/**
 * Metadata gambar yang masih di KV, sekaligus memindahkannya ke R2 bila binding
 * MEDIA aktif (`getMedia` yang menjalankan pemindahan itu).
 */
async function legacyItems(env: MediaBindings, slug: string, names: string[]): Promise<MediaListItem[]> {
  const items: MediaListItem[] = [];
  for (const name of names) {
    let stored: StoredMedia | null = null;
    try {
      stored = await getMedia(env, slug, name);
    } catch {
      stored = null;
    }
    if (!stored) continue;
    items.push({
      name,
      contentType: stored.contentType,
      size: stored.size,
      uploadedAt: stored.uploadedAt,
    });
  }
  return items;
}

function contentTypeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Hapus satu gambar dari kedua backend.
 *
 * Dua-duanya penting: kalau binding MEDIA aktif, `getMedia` masih membaca
 * fallback KV. Hanya menghapus object R2 akan membuat gambar yang belum sempat
 * pindah (masih KV saja) muncul kembali begitu dibaca.
 */
export async function deleteMedia(env: MediaBindings, slug: string, name: string): Promise<void> {
  if (env.MEDIA) {
    await env.MEDIA.delete(objectKey(slug, name));
    await env.STORAGE.delete(kvKey(slug, name));
    return;
  }
  await env.STORAGE.delete(kvKey(slug, name));
}

/**
 * Gabungan nama media di R2 dan KV, R2 menang kalau ada nama yang sama.
 *
 * HANYA untuk operasi langka yang butuh benar-benar lengkap: hapus aplikasi dan
 * ganti slug. Kalau operasi ini hanya melihat R2, gambar yang masih tertinggal
 * di KV akan menggantung — dan pada `moveAllMedia` hilang diam-diam, karena
 * sumbernya tidak ikut dipindah lalu ikut dihapus.
 *
 * Jalur panas tetap memakai `listMediaNames` (R2 saja) supaya tidak membakar
 * kuota `list` KV yang cuma 1.000 per hari.
 */
export async function listMediaUnion(env: MediaBindings, slug: string): Promise<string[]> {
  if (!env.MEDIA) return kvNames(env, slug);
  const [stored, legacy] = await Promise.all([r2Names(env, slug), safeKvNames(env, slug)]);
  return [...new Set([...stored, ...legacy])];
}

/** Dipakai saat aplikasi dihapus, supaya gambar tidak jadi sampah di storage. */
export async function deleteAllMedia(env: MediaBindings, slug: string): Promise<number> {
  const names = await listMediaUnion(env, slug);
  for (const name of names) await deleteMedia(env, slug, name);
  return names.length;
}

/**
 * Tandai aplikasi sebagai "baru saja diubah" dengan menyegarkan `updated_at`.
 *
 * Dipanggil setiap kali isi aplikasi berubah lewat panel Gambar (unggah, hapus,
 * generate AI) supaya label "Diubah ..." di sidebar jujur. Field lain tidak
 * disentuh, dan `created_at` ikut dipertahankan apa adanya.
 *
 * Sengaja diam-diam kalau metadata-nya tidak ada: panel Gambar tidak boleh
 * bisa membuat aplikasi yang belum pernah disimpan. Kegagalan di sini juga
 * ditelan supaya metadata yang sudah ada tidak ikut hilang kalau KV sempat error.
 */
export async function touchMeta(env: MediaBindings, slug: string): Promise<void> {
  await syncMediaStats(env, slug);
  try {
    const raw = await env.STORAGE.get(`meta:${slug}`);
    if (!raw) return;
    const meta = JSON.parse(raw) as Record<string, unknown>;
    await writeAppMeta(env, { ...meta, updated_at: stampNow() } as AppMeta);
  } catch {
    // lihat catatan di atas
  }
}

/**
 * Simpan ke `meta:<slug>` statistik media yang dibutuhkan dashboard: nama slot
 * yang dirujuk soal (`media_slots`) dan nama gambar yang benar-benar terunggah
 * (`media_names`).
 *
 * Dipisah dari `withMediaStats` (sekarang fungsi murni) supaya dashboard tidak
 * perlu menyentuh media sama sekali. Sebelumnya tiap render dashboard melakukan
 * 1 `get quiz:<slug>` + 1 `list` media PER APLIKASI, jadi 50 aplikasi = 50 list.
 * Kuota `list` KV free cuma 1.000 per hari; 20 kali buka dashboard sudah habis.
 * Sekarang biayanya nol: dashboard hanya membaca `meta` yang sudah diambil.
 *
 * Memakai `listMediaUnion`, bukan `listMediaNames`, supaya gambar lama yang masih
 * di KV ikut terhitung dan guru tidak melihat peringatan "gambar belum lengkap"
 * yang semu.
 *
 * Sengaja menelan semua error: statistik ini kosmetik, dan kegagalan menulis
 * tidak boleh menggagalkan unggahan yang sedang berjalan.
 */
export async function syncMediaStats(env: MediaBindings, slug: string): Promise<void> {
  try {
    const [metaRaw, specRaw] = await Promise.all([
      env.STORAGE.get(`meta:${slug}`),
      env.STORAGE.get(`quiz:${slug}`),
    ]);
    if (!metaRaw) return;
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    const slots = specRaw ? collectMediaSlotsFromStored(specRaw) : [];
    // `listMediaUnion` (R2 + KV) bukan `listMediaNames` (R2 saja):
    // `syncMediaStats` dipanggil di jalur panas — setiap publish soal dan
    // setiap unggah gambar — jadi satu `list` KV per pemanggilan akan menghabiskan
    // kuota 1.000/hari dengan sendirinya. Gambar lama tidak ikut terhitung
    // sampai sempat dibaca dan pindah ke R2; untuk angka statistik itu tidak
    // masalah, karena yang dihitung juga baru gambar yang sudah diunggah.
    const uploaded = await listMediaNames(env, slug);
    await writeAppMeta(env, {
      ...meta,
      media_slots: slots,
      media_names: uploaded,
    } as AppMeta);
  } catch {
    // lihat catatan di atas
  }
}

/**
 * Pindahkan seluruh media dari satu slug ke slug lain (dipakai saat aplikasi
 * diganti alamatnya). Salin dulu ke tujuan baru, baru hapus asal — kalau gagal
 * di tengah jalan, gambar tidak hilang.
 */
export async function moveAllMedia(env: MediaBindings, fromSlug: string, toSlug: string): Promise<number> {
  const names = await listMediaUnion(env, fromSlug);
  for (const name of names) {
    const stored = await getMedia(env, fromSlug, name);
    if (!stored) continue;

    if (env.MEDIA) {
      await env.MEDIA.put(objectKey(toSlug, name), stored.body, {
        httpMetadata: { contentType: stored.contentType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: stored.uploadedAt ? { uploadedAt: stored.uploadedAt } : undefined,
      });
    } else {
      await env.STORAGE.put(kvKey(toSlug, name), stored.body, {
        metadata: { contentType: stored.contentType, uploadedAt: stored.uploadedAt },
      });
    }

    await deleteMedia(env, fromSlug, name);
  }
  return names.length;
}

/**
 * Gambar yang diminta siswa tapi belum diunggah guru: jangan biarkan ikon
 * "broken image" muncul. Kirim kotak placeholder yang menjelaskan masalahnya.
 * Sengaja no-store supaya begitu guru mengunggah, siswa langsung dapat gambar asli.
 */
export function mediaPlaceholder(name: string): string {
  const label = escapeHtml(name.slice(0, 48) || 'gambar');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320" role="img" aria-label="Gambar belum diunggah">
  <rect width="640" height="320" fill="#f8fafc"/>
  <rect x="8" y="8" width="624" height="304" rx="14" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="10 8"/>
  <text x="320" y="150" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="#64748b">Gambar belum diunggah</text>
  <text x="320" y="184" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="16" fill="#94a3b8">media:${label}</text>
</svg>`;
}
