// Proxy image generation gratis di atas Cloudflare Workers AI.
// Sumber: github.com/saurav-z/free-image-generation-api (MIT), dimodifikasi:
//   - default model pakai SDXL Lightning (jauh lebih cepat, hemat kuota gratis)
//   - boleh memilih model lewat body "model" (hanya dari daftar allowlist)
//   - batas panjang prompt supaya tidak disalahgunakan
export default {
  async fetch(request, env) {
    const API_KEY = env.API_KEY;
    const url = new URL(request.url);
    const auth = request.headers.get('Authorization') || '';

    // Kunci API wajib: header Authorization: Bearer <API_KEY>
    if (!API_KEY || auth !== `Bearer ${API_KEY}`) {
      return json({ error: 'Unauthorized' }, 401);
    }
    if (request.method !== 'POST' || url.pathname !== '/') {
      return json({ error: 'Not allowed' }, 405);
    }

    try {
      const body = await request.json();
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return json({ error: 'Prompt is required' }, 400);
      if (prompt.length > 1000) return json({ error: 'Prompt too long (max 1000 chars)' }, 400);

      const MODELS = [
        '@cf/bytedance/stable-diffusion-xl-lightning',
        '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        '@cf/black-forest-labs/flux-1-schnell',
        '@cf/lykon/dreamshaper-8-lcm',
      ];
      const model = MODELS.includes(body.model) ? body.model : MODELS[0];

      const result = await env.AI.run(model, { prompt });
      // Bentuk output berbeda per model:
      //   - SDXL / DreamShaper: ReadableStream berisi byte gambar.
      //   - flux-1-schnell: objek { image: "<base64>" }.
      // Dinormalisasi di sini supaya keduanya keluar sebagai gambar (atau error jelas).
      const bytes = await imageBytes(result);
      if (!bytes) {
        return json({ error: 'Failed to generate image', details: 'Output model tidak dikenali.' }, 502);
      }
      const contentType = sniffContentType(bytes);
      if (!contentType) {
        return json({ error: 'Failed to generate image', details: 'Respons model bukan gambar yang dikenali.' }, 502);
      }
      return new Response(bytes, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      return json({ error: 'Failed to generate image', details: String(err && err.message) }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Ubah hasil env.AI.run() menjadi Uint8Array, apa pun bentuk output modelnya. */
async function imageBytes(result) {
  if (result == null) return null;
  // flux-1-schnell: { image: "<base64>" }
  if (typeof result.image === 'string' && result.image) {
    return base64ToBytes(result.image);
  }
  // SDXL / DreamShaper: ReadableStream byte gambar.
  if (typeof result.getReader === 'function') {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (ArrayBuffer.isView(result) && result.buffer instanceof ArrayBuffer) {
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }
  return null;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Tentukan tipe MIME dari magic bytes (mirip sniffing di worker utama). */
function sniffContentType(bytes) {
  if (bytes && bytes.length >= 12) {
    const b = bytes;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      return 'image/webp';
    }
  }
  return null;
}
