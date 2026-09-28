#!/usr/bin/env node
/* ==========================================================================
 * Monitor kuota KV (dipakai manual, bukan bagian npm test).
 *
 *   npm run kv:usage             # namespace production
 *   npm run kv:usage:staging     # namespace staging
 *
 * Latar belakang: media guru disimpan di KV (binding STORAGE) yang di free
 * tier dibatasi 1 GB total dan 100 rb baca/hari. Batas tulis media per
 * aplikasi (200 slot) sudah ditutup di kode, tapi ukuran total tetap harus
 * dipantau — sekali mendekati 1 GB, seluruh penulisan KV (termasuk meta dan
 * quiz) mulai gagal tanpa pesan yang jelas.
 *
 * Sumber data: Cloudflare REST API memakai kredensial yang sama dengan
 * wrangler (token OAuth tersimpan di ~/.wrangler/config). Ukuran nilai tidak
 * tersedia via metadata endpoint, jadi dihitung dari unduhan isi kunci —
 * skrip ini hanya MEMBACA, tidak pernah menulis/menghapus.
 * ========================================================================== */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NAMESPACES = {
  production: 'eccfd622d7004c58ae8e9c8e1d223ba2',
  staging: '26f5f45fa7894f6faf8ba6a97e97f53e',
};
const ACCOUNT_ID = '6cbdf78ebf9f69de639ce496c5c7103b';
const KV_FREE_BYTES = 1024 ** 3; // 1 GiB
const MEDIA_PREFIX = 'media:';

const envArg = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'production';
const namespaceId = NAMESPACES[envArg];
if (!namespaceId) {
  console.error(`Env tidak dikenal: ${envArg}. Pilihan: production, staging (--env staging)`);
  process.exit(2);
}

/* --- Ambil token OAuth milik wrangler ------------------------------------- */
async function wranglerToken() {
  for (const dir of [
    '.wrangler',
    join(homedir(), '.wrangler'),
    join(process.env.XDG_CONFIG_HOME ?? '', 'wrangler'),
    // Windows: wrangler (via npm config get) bisa memakai jalur xdg.config di Roaming.
    join(homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler'),
  ]) {
    if (!dir) continue;
    for (const file of ['config/default.toml', 'config.toml']) {
      try {
        const text = await readFile(join(dir, file), 'utf8');
        const token = text.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
        if (token) return token;
      } catch {
        // Coba lokasi berikutnya.
      }
    }
  }
  console.error('Token wrangler tidak ditemukan. Jalankan "npx wrangler whoami" dulu, lalu ulangi skrip ini.');
  process.exit(2);
}

const token = await wranglerToken();
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}`;

async function api(path, asJson = true) {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`API ${path} gagal: HTTP ${res.status}`);
    process.exit(1);
  }
  return asJson ? res.json() : res.arrayBuffer();
}

/* --- Daftar kunci media (prefix media:, cursor penuh) ---------------------- */
const mediaKeys = [];
let cursor = '';
for (;;) {
  const page = await api(`/keys?prefix=${encodeURIComponent(MEDIA_PREFIX)}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
  mediaKeys.push(...(page.result ?? []));
  cursor = page.result_info?.cursor ?? '';
  if (!cursor) break;
}

/* --- Ukuran tiap kunci: metadata murah, nilai diunduh hanya untuk media ---- */
let mediaBytes = 0;
const perApp = new Map();
for (const key of mediaKeys) {
  const value = (await api(`/values/${encodeURIComponent(key.name)}`, false)) ?? new ArrayBuffer(0);
  const size = value.byteLength;
  mediaBytes += size;
  const app = key.name.slice(MEDIA_PREFIX.length).split(':')[0] || '(tanpa-slug)';
  const entry = perApp.get(app) ?? { count: 0, bytes: 0 };
  entry.count += 1;
  entry.bytes += size;
  perApp.set(app, entry);
}

/* --- Perkiraan ukuran kunci non-media tanpa mengunduhnya satu per satu:
       ukuran metadata diambil dari perkiraan kasar (quiz/meta bisa besar),
       jadi bagian ini ditampilkan terpisah sebagai "di luar media". --------- */
let nonMediaCount = 0;
let allCursor = '';
for (;;) {
  const page = await api(`/keys?limit=1000${allCursor ? `&cursor=${allCursor}` : ''}`);
  nonMediaCount += (page.result ?? []).filter((k) => !k.name.startsWith(MEDIA_PREFIX)).length;
  allCursor = page.result_info?.cursor ?? '';
  if (!allCursor) break;
}

const fmt = (n) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

console.log(`\nNamespace KV ${envArg} (${namespaceId})`);
console.log('='.repeat(56));
console.log(`Kunci media       : ${mediaKeys.length} kunci, total ${fmt(mediaBytes)}`);
console.log(`Kunci non-media   : ~${nonMediaCount} kunci (ukuran di luar hitungan ini)`);
console.log(`Ruang terpakai    : ${fmt(mediaBytes)} dari 1 GB (${((mediaBytes / KV_FREE_BYTES) * 100).toFixed(1)}%) untuk media`);

if (perApp.size) {
  console.log('\nPer aplikasi (terbesar dulu):');
  for (const [app, { count, bytes }] of [...perApp.entries()].sort((a, b) => b.bytes - a.bytes)) {
    console.log(`  ${app.padEnd(40)} ${String(count).padStart(3)} file  ${fmt(bytes)}`);
  }
}

const percent = (mediaBytes / KV_FREE_BYTES) * 100;
console.log(
  percent >= 80
    ? '\n⚠️  MELEWATI 80% — saatnya pindah ke R2 (aktifkan R2 di dashboard, buka blok r2_buckets di wrangler.jsonc).'
    : percent >= 50
      ? '\nNote: di atas 50% — mulai pantau tiap bulan.'
      : '\nAman. Pantau ulang kapan saja dengan npm run kv:usage.'
);
