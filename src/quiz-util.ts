/* ==========================================================================
 * Helper teks murni: normalisasi jawaban, sanitasi media, dan utilitas kecil.
 * Tidak boleh import modul kuis lain (tanpa dependency).
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* Helper teks                                                                */
/* -------------------------------------------------------------------------- */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalisasi untuk pencocokan jawaban.
 * Toleran terhadap: harakat/tanda Arab, hamza (أ/إ/آ -> ا), alif maqsura (ى -> ي),
 * ta marbuta (ة -> ه), tatweel, huruf besar-kecil, dan tanda baca.
 */


/**
 * Normalisasi untuk pencocokan jawaban.
 * Toleran terhadap: harakat/tanda Arab, hamza (أ/إ/آ -> ا), alif maqsura (ى -> ي),
 * ta marbuta (ة -> ه), tatweel, huruf besar-kecil, dan tanda baca.
 */
export function normalizeAnswer(text: string): string {
  return String(text)
    .normalize('NFKD')
    // Tanda diakritik Latin + harakat Arab (fathah, kasrah, dhammah, sukun,
    // tasydid, hamza di atas/bawah, maddah). Wajib: NFKD memecah "إ" jadi
    // alif + U+0655, jadi tanpa ini "لا اله" tidak akan pernah cocok dengan
    // kunci "لا إله" — padahal itulah cara siswa menulis.
    .replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0640/g, '')
    // Angka Arab (٠-٩ dan ۰-۹) disamakan dengan angka Latin.
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nama slot media — dipakai di token `media:nama` dan di URL /media/<slug>/<nama>.
 * Selalu huruf kecil, tanpa garis miring, tanpa titik di awal/akhir, jadi tidak
 * bisa dipakai keluar dari folder aplikasi (path traversal) atau menyembunyikan file.
 */


/**
 * Nama slot media — dipakai di token `media:nama` dan di URL /media/<slug>/<nama>.
 * Selalu huruf kecil, tanpa garis miring, tanpa titik di awal/akhir, jadi tidak
 * bisa dipakai keluar dari folder aplikasi (path traversal) atau menyembunyikan file.
 */
export function sanitizeMediaName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, 64);
}

/** Basis URL semua media milik satu aplikasi. */


/** Basis URL semua media milik satu aplikasi. */
export function mediaBaseFor(slug: string): string {
  return `/media/${encodeURIComponent(slug)}/`;
}

/**
 * Ubah nilai gambar jadi URL yang aman dipakai di src:
 *   - `media:fotosintesis` -> /media/<slug>/fotosintesis (diisi guru lewat panel Gambar)
 *   - `https://...`        -> dipakai apa adanya
 *   - `/path/relatif`      -> dipakai apa adanya (mis. hasil unggahan di domain sendiri)
 * Selain itu ditolak, termasuk `javascript:` dan `data:` (data URI bisa menyelundupkan HTML).
 */


/**
 * Ubah nilai gambar jadi URL yang aman dipakai di src:
 *   - `media:fotosintesis` -> /media/<slug>/fotosintesis (diisi guru lewat panel Gambar)
 *   - `https://...`        -> dipakai apa adanya
 *   - `/path/relatif`      -> dipakai apa adanya (mis. hasil unggahan di domain sendiri)
 * Selain itu ditolak, termasuk `javascript:` dan `data:` (data URI bisa menyelundupkan HTML).
 */
export function resolveMediaUrl(raw: unknown, mediaBase = ''): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/^media:/i.test(value)) {
    const name = sanitizeMediaName(value.replace(/^media:/i, ''));
    return name && mediaBase ? mediaBase + encodeURIComponent(name) : '';
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('..')) return value;
  return '';
}

/**
 * Field gambar terpisah (`"image": "media:bagan"`) diubah jadi markdown supaya
 * ikut diproses renderer yang sama dengan gambar di dalam teks soal.
 */


/**
 * Field gambar terpisah (`"image": "media:bagan"`) diubah jadi markdown supaya
 * ikut diproses renderer yang sama dengan gambar di dalam teks soal.
 */
export function imageFieldToMarkdown(rawImage: unknown): string {
  let src = '';
  let alt = 'Gambar soal';
  if (typeof rawImage === 'string') {
    src = rawImage.trim();
  } else if (rawImage && typeof rawImage === 'object' && !Array.isArray(rawImage)) {
    const obj = rawImage as Record<string, unknown>;
    const slot = pick(obj, ['media', 'slot', 'nama']);
    src = slot !== undefined ? `media:${String(slot).trim()}` : String(pick(obj, ['src', 'url', 'file']) ?? '').trim();
    alt = String(pick(obj, ['alt', 'caption', 'keterangan']) ?? alt).trim() || alt;
  }
  if (!src) return '';
  return `![${alt.replace(/[[\]]/g, '')}](${src})`;
}

/**
 * Daftar nama slot media langsung dari teks JSON yang disimpan, TANPA harus
 * lolos parseQuizSpec. Dipakai panel Gambar sebagai jaring pengaman: spec yang
 * disimpan di KV sudah bentuk ternormalisasi (kuncinya `keys`, bukan `answer`),
 * sehingga parse ulang bisa gagal dan membuat jumlah slot terbaca 0/0 padahal
 * soalnya bergambar. Cukup pindai token `media:nama` dari seluruh teks.
 */


export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}



export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim() !== '');
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [String(value)];
}



export function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Ambil JSON mentah (setelah melepas pagar ``` kalau ada) untuk disimpan apa adanya. */


/** Ambil JSON mentah (setelah melepas pagar ``` kalau ada) untuk disimpan apa adanya. */
export function parseQuizJson(raw: string): unknown {
  return JSON.parse(stripFences(raw));
}



export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|JSON)?\s*\r?\n?/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Parsing spec                                                               */
/* -------------------------------------------------------------------------- */



/* --- Tipe lanjutan: helper parsing ------------------------------------------ */

/**
 * Hash FNV-1a sederhana, dipakai sebagai bibit pengacakan. Tujuannya bukan
 * keamanan, cuma supaya urutan yang tampil ke siswa SELALU sama untuk soal yang
 * sama — kalau tidak, halaman kuis berubah tiap kali dirender ulang dan kunci
 * guru tidak lagi cocok dengan urutan yang dilihat siswa.
 */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Urutan indeks hasil pengacakan deterministik (Fisher-Yates berbenih). */
