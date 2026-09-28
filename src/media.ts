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
import { escapeHtml, sanitizeMediaName, stampNow } from './quiz.ts';

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

export async function getMedia(env: MediaBindings, slug: string, name: string): Promise<StoredMedia | null> {
  if (env.MEDIA) {
    const object = await env.MEDIA.get(objectKey(slug, name));
    if (!object) return null;
    const body = await object.arrayBuffer();
    return {
      body,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      size: body.byteLength,
      uploadedAt: object.customMetadata?.uploadedAt ?? '',
    };
  }

  const stored = await env.STORAGE.getWithMetadata(kvKey(slug, name), 'arrayBuffer');
  if (!stored.value) return null;
  const meta = (stored.metadata ?? {}) as { contentType?: string; uploadedAt?: string };
  return {
    body: stored.value,
    contentType: meta.contentType ?? 'application/octet-stream',
    size: stored.value.byteLength,
    uploadedAt: meta.uploadedAt ?? '',
  };
}

export async function listMedia(env: MediaBindings, slug: string): Promise<MediaListItem[]> {
  if (env.MEDIA) {
    const listed = await env.MEDIA.list({ prefix: `${slug}/`, limit: MAX_MEDIA_PER_APP });
    return listed.objects.map((object) => ({
      name: object.key.slice(slug.length + 1),
      contentType: object.httpMetadata?.contentType ?? contentTypeFromName(object.key),
      size: object.size,
      uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded?.toISOString() ?? '',
    }));
  }

  const listed = await env.STORAGE.list({ prefix: kvKey(slug, ''), limit: MAX_MEDIA_PER_APP });
  const items: MediaListItem[] = [];
  for (const key of listed.keys) {
    const stored = await env.STORAGE.getWithMetadata(key.name, 'arrayBuffer');
    const meta = (stored.metadata ?? {}) as { contentType?: string; uploadedAt?: string };
    items.push({
      name: key.name.slice(kvKey(slug, '').length),
      contentType: meta.contentType ?? contentTypeFromName(key.name),
      size: stored.value?.byteLength ?? 0,
      uploadedAt: meta.uploadedAt ?? '',
    });
  }
  return items;
}

function contentTypeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

export async function deleteMedia(env: MediaBindings, slug: string, name: string): Promise<void> {
  if (env.MEDIA) {
    await env.MEDIA.delete(objectKey(slug, name));
    return;
  }
  await env.STORAGE.delete(kvKey(slug, name));
}

/** Dipakai saat aplikasi dihapus, supaya gambar tidak jadi sampah di storage. */
export async function deleteAllMedia(env: MediaBindings, slug: string): Promise<number> {
  const items = await listMedia(env, slug);
  for (const item of items) await deleteMedia(env, slug, item.name);
  return items.length;
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
  try {
    const raw = await env.STORAGE.get(`meta:${slug}`);
    if (!raw) return;
    const meta = JSON.parse(raw) as Record<string, unknown>;
    await env.STORAGE.put(`meta:${slug}`, JSON.stringify({ ...meta, updated_at: stampNow() }));
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
  const items = await listMedia(env, fromSlug);
  for (const item of items) {
    const stored = await getMedia(env, fromSlug, item.name);
    if (!stored) continue;

    if (env.MEDIA) {
      await env.MEDIA.put(objectKey(toSlug, item.name), stored.body, {
        httpMetadata: { contentType: stored.contentType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: stored.uploadedAt ? { uploadedAt: stored.uploadedAt } : undefined,
      });
    } else {
      await env.STORAGE.put(kvKey(toSlug, item.name), stored.body, {
        metadata: { contentType: stored.contentType, uploadedAt: stored.uploadedAt },
      });
    }

    await deleteMedia(env, fromSlug, item.name);
  }
  return items.length;
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
