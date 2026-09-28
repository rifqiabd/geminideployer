/* ==========================================================================
 * Kartu pesan/error untuk halaman penuh (bukan komponen di dalam dashboard).
 *
 * Sebelumnya tiap modul punya salinan sendiri: `errorPage` (Tailwind CDN
 * slate-900, hardcoded gelap), `errorCard` di media-routes, dan dua `messagePage`
 * di quiz-editor/quiz-essay. Semuanya terlihat seperti produk berbeda —
// "password salah" masih biru-slate tua sementara halaman lain sudah Geist +
 * token tema. Modul ini jadi satu sumber kebenaran: satu gaya, satu token,
 * satu tempat untuk menambahkan ikon atau aksi baru.
 *
 * Sifat penting: self-contained. Halaman ini muncul justru ketika hal lain
 * rusak (secret belum dipasang, KV kosong, siswa salah alamat), jadi tidak
 * boleh bergantung pada JS, binding, atau stylesheet halaman utama. Font
 * diambil dari /vendor lewat @font-face dengan fallback sistem.
 * ========================================================================== */
import { escapeHtml } from './quiz-util.ts';
import { FAVICON_TAGS } from './favicon.ts';

/** Nada kartu. Menentukan warna judul dan ikon lonceng. */
export type CardTone = 'danger' | 'warn' | 'info';

export type CardOptions = {
  /** Judul kartu. Contoh: "Password salah". */
  title: string;
  /** Isi pesan. Baris baru dipertahankan. */
  message: string;
  /** Halaman tujuan tombol. Kalau diisi, tombol "kembali" dirender. */
  backHref?: string;
  /** Label tombol. Default "Kembali ke Dashboard". */
  backLabel?: string;
  /** Nada warna. Default "danger". */
  tone?: CardTone;
  /**
   * Potongan monospace di bawah pesan (perintah terminal, slug, dsb).
   * String mentah yang di-escape, bukan HTML.
   */
  detail?: string;
  /** Catatan penutup yang dirender DI BAWAH `detail`. */
  note?: string;
};

const TONE_COLOR: Record<CardTone, string> = {
  danger: 'var(--danger)',
  warn: 'var(--warn)',
  info: 'var(--accent)',
};

/** Lonceng sesuai nada; inline SVG supaya tidak perlu request ikon. */
function bellIcon(tone: CardTone): string {
  if (tone === 'info') {
    return '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.5" x2="12.01" y2="7.5"/>';
  }
  const body = tone === 'warn'
    ? '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
    : '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  return body;
}

/**
 * Halaman kartu pesan penuh. Selalu self-contained (inline CSS, tanpa CDN),
 * mengikuti tema terang/gelap lewat `prefers-color-scheme` seperti halaman
 * dashboard, dan meng-escape semua input supaya pesan dari storage (slug,
 * pesan server) tidak pernah jadi markup.
 */
export function messageCard(options: CardOptions): string {
  const tone: CardTone = options.tone ?? 'danger';
  const color = TONE_COLOR[tone];
  const backHref = options.backHref ? escapeHtml(options.backHref) : '';
  const backLabel = escapeHtml(options.backLabel ?? 'Kembali ke Dashboard');
  const detail = options.detail
    ? `<pre class="detail">${escapeHtml(options.detail)}</pre>`
    : '';
  const note = options.note ? `<p class="note">${escapeHtml(options.note)}</p>` : '';
  const back = backHref
    ? `<a class="back" href="${backHref}">&larr; ${backLabel}</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  ${FAVICON_TAGS}
  <style>
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geistmono-variable.woff2') format('woff2')}
    :root{--bg:#ffffff;--surface:#f9f9f9;--surface-2:#f0f0f0;--border:#e5e5e5;--text:#171717;--text-secondary:#737373;--text-faint:#a3a3a3;--accent:#7c3aed;--danger:#ef4444;--warn:#d97706;--radius:14px;--shadow:0 8px 32px rgba(0,0,0,.1)}
    @media(prefers-color-scheme:dark){:root{--bg:#212121;--surface:#303030;--surface-2:#3a3a3a;--border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--text-faint:#6b6b6b;--accent:#8b5cf6;--danger:#f87171;--warn:#fbbf24;--shadow:0 8px 32px rgba(0,0,0,.4)}}
    *{box-sizing:border-box}
    html{-webkit-text-size-adjust:100%}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
    .card{width:100%;max-width:480px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow)}
    h1{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;letter-spacing:-.01em;color:${color};margin:0 0 8px}
    h1 svg{flex:none}
    p{font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0;white-space:pre-wrap}
    .note{margin-top:12px;color:var(--text-faint)}
    .detail{margin:14px 0 0;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.8;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-word}
    a.back{display:inline-flex;align-items:center;gap:6px;margin-top:18px;padding:8px 16px;background:var(--accent);color:#fff;border-radius:8px;font-size:12.5px;font-weight:500;text-decoration:none;transition:opacity .15s}
    a.back:hover{opacity:.9}
  </style>
</head>
<body>
  <div class="card">
    <h1><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${bellIcon(tone)}</svg>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.message)}</p>
    ${detail}
    ${note}
    ${back}
  </div>
</body>
</html>`;
}

/**
 * Pintasan untuk kasus yang paling sering muncul di admin: satu judul, satu
 * pesan, tombol kembali ke dashboard.
 */
export function errorCard(title: string, message: string, backHref = '/'): string {
  return messageCard({ title, message, backHref, tone: 'danger' });
}
