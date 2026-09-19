/* ==========================================================================
 * Generate gambar soal dengan AI (Cloudflare Workers AI lewat proxy
 * free-image-generation-api, lihat github.com/saurav-z/free-image-generation-api).
 * --------------------------------------------------------------------------
 * Alurnya: guru menulis prompt di panel Gambar -> Worker kita memanggil API
 * image generation -> hasilnya (binary gambar) langsung disimpan ke storage
 * media dengan nama slot yang diminta soal. Guru tidak perlu repot unduh-unggah.
 *
 * Konfigurasi (opsional — kalau kosong, tombol Generate tidak tampil):
 *   IMGGEN_API_URL : URL worker proxy, mis. https://img-gen.x.subdomain.workers.dev
 *   IMGGEN_API_KEY : nilai API_KEY yang dipakai proxy (Bearer).
 * ========================================================================== */

import { putMedia } from './media.ts';
import type { MediaBindings } from './media.ts';

// Impor sengaja memakai ekstensi .ts: file ini ikut dijalankan langsung oleh Node
// dari tests/quiz.test.mjs, dan Node ESM tidak menebak ekstensi seperti esbuild.
import { sniffImageType } from './media.ts';

export type MediaGenConfig = {
  apiUrl: string;
  apiKey: string;
  /** Model di sisi proxy. Opsional: hanya dikirim kalau diisi. */
  model?: string;
};

export function mediaGenConfig(env: { IMGGEN_API_URL?: string; IMGGEN_API_KEY?: string }): MediaGenConfig | null {
  const apiUrl = String(env.IMGGEN_API_URL ?? '').trim();
  const apiKey = String(env.IMGGEN_API_KEY ?? '').trim();
  // Hanya terima https supaya kunci API tidak dikirim ke server yang tidak terenkripsi.
  if (!apiUrl || !/^https:\/\//i.test(apiUrl) || !apiKey) return null;
  return { apiUrl, apiKey };
}

/**
 * Prompt yang diketik guru dibungkus instruksi supaya hasilnya cocok dipakai
 * sebagai gambar pendukung soal: jelas, bersih, tanpa watermark/teks acak.
 */
export function buildImagePrompt(topic: string): string {
  const clean = topic.replace(/\s+/g, ' ').trim().slice(0, 400);
  return (
    `Buat satu gambar ilustrasi edukatif yang jernih dan informatif untuk soal sekolah. ` +
    `Gaya: ilustrasi/diagram yang mudah dibaca siswa, komposisi rapi, pencahayaan jelas. ` +
    `Tanpa watermark, tanpa tanda tangan, tanpa teks kalimat panjang. ` +
    `Topik: ${clean || 'ilustrasi edukatif umum'}.`
  );
}

/**
 * Prompt mandiri untuk ditempel guru di gemini.google.com (akun Gemini sendiri).
 * Berbeda dari buildImagePrompt: Gemini lebih andal menggambar teks, jadi label
 * pendek (1-3 kata) pada diagram boleh dipakai — sisanya tetap tanpa watermark.
 */
export function buildGeminiPrompt(topic: string): string {
  const clean = topic.replace(/\s+/g, ' ').trim().slice(0, 1600);
  return (
    `Buat satu gambar ilustrasi edukatif yang jernih dan informatif untuk soal sekolah. ` +
    `Gaya: ilustrasi/diagram sederhana yang mudah dipahami siswa, komposisi rapi, warna jelas. ` +
    `Teks pada gambar hanya boleh untuk label penting (paling banyak 3 kata), jangan kalimat panjang. ` +
    `Tanpa watermark dan tanpa tanda tangan. ` +
    `Topik: ${clean || 'ilustrasi edukatif umum'}.`
  );
}

/**
 * Model yang bisa dipilih guru di panel Gambar — senada dengan allowlist proxy
 * (imggen-proxy/worker.js). Default pertama = model bawaan proxy.
 */
export const IMGGEN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '@cf/bytedance/stable-diffusion-xl-lightning', label: 'SDXL Lightning — cepat, hemat kuota' },
  { id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell — detail lebih halus' },
  { id: '@cf/lykon/dreamshaper-8-lcm', label: 'DreamShaper 8 LCM — gaya artistik' },
  { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL 1.0 — kualitas, lebih lambat' },
];

/** Pengaturan API gambar milik satu aplikasi (BYOK), disimpan di KV `imggencfg:<slug>`. */
export type MediaGenSettings = {
  apiUrl: string;
  apiKey: string;
  model?: string;
};

export type GenerateImageResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; error: string };

/**
 * Panggil API image generation. Respons sukses adalah binary gambar (biasanya
 * JPEG) — di sini ditolak kalau ternyata bukan gambar yang dikenali magic bytes.
 * `model` opsional: menang saat diisi. API sendiri (BYOK) bebas pakai model apa;
 * bila API tidak kenal model itu, sebagian server mengembalikan error ke sini.
 */
export async function generateImage(
  config: MediaGenConfig,
  topic: string,
  model?: string
): Promise<GenerateImageResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  const payload: Record<string, unknown> = { prompt: buildImagePrompt(topic) };
  const chosen = (model ?? '').trim() || (config.model ?? '').trim();
  if (chosen) payload.model = chosen;

  let response: Response;
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { ok: false, error: `Tidak bisa menghubungi API gambar: ${String(error)}` };
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    return { ok: false, error: `API gambar menolak (HTTP ${response.status})${detail ? `: ${detail}` : '.'}` };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { ok: false, error: 'Respons API bukan gambar yang dikenali (JPG/PNG/WebP/GIF/BMP/AVIF).' };
  }
  return { ok: true, bytes, contentType };
}

/** Simpan hasil generate ke storage media dengan nama slot yang sudah disanitasi. */
export function saveGeneratedMedia(
  env: MediaBindings,
  slug: string,
  name: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  // Salin ke ArrayBuffer agar tipe yang diterima putMedia konsisten di runtime.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return putMedia(env, slug, name, copy, contentType);
}
