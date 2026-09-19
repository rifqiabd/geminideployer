# imggen-proxy

Proxy image generation gratis di atas Cloudflare Workers AI — turunan dari
[free-image-generation-api](https://github.com/saurav-z/free-image-generation-api)
(MIT), dengan beberapa penyesuaian:

- Default model `@cf/bytedance/stable-diffusion-xl-lightning` (cepat & hemat kuota).
- Model bisa dipilih lewat body `"model"` (hanya dari allowlist).
- Prompt dibatasi 1000 karakter.

## Deploy

```bash
cd imggen-proxy
npm install
npx wrangler deploy
```

Jika gagal dengan pesan soal AI binding, aktifkan dulu Workers AI:
Dashboard Cloudflare → Workers & Pages → AI → **Enable**.

## Set API key

```bash
npx wrangler secret put API_KEY
# tempel nilai kunci yang sama dengan IMGGEN_API_KEY di worker utama
```

## Cepat coba

```bash
curl -X POST https://imggen-proxy.<subdomain>.workers.dev/ \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"skema rangkaian relay lampu sorot otomotif"}' \
  --output test.jpg
```

## Sambungkan ke worker utama

```bash
npx wrangler secret put IMGGEN_API_URL   # https://imggen-proxy.<subdomain>.workers.dev
npx wrangler secret put IMGGEN_API_KEY   # sama dengan API_KEY di atas
```

Setelah itu tombol **AI** muncul otomatis di panel Gambar (`/p/<slug>/media`).

## Kuota

Workers AI gratis: ±10.000 neuron/hari. SDXL Lightning ±437 neuron/gambar →
sekitar 20-an gambar/hari gratis. Model lain punya bobot berbeda; kalau butuh
lebih banyak gambar per hari, ganti model ke `flux-1-schnell` (lebih murah per
gambar) di `worker.js`.
