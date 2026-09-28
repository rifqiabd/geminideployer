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

/* --- LaTeX tanpa pembatas ---------------------------------------------------- */

/** Perintah LaTeX yang selalu butuh pembatas: `\frac`, `\begin{pmatrix}`, `\det`, ... */
const LATEX_COMMAND = /\\[a-zA-Z]+/;

/**
 * Pangkat/indeks tanpa backslash: `B^{-1}`, `(AB)^{-1}`, `a_{12}`. Cukup kuat
 * untuk jadi penanda rumus — prosa tidak pernah menulis `^{` atau `_{`.
 * `^` dan `_` telanjang sengaja TIDAK dipakai: `x^2` masih muncul di kalimat
 * biasa, dan `_` justru sering muncul di nama file atau slot media.
 */
const SCRIPT_MARK = /[\^_]\{/;

/**
 * Kata huruf yang di dalam rumus tetap diperlakukan sebagai bagian rumus, bukan
 * prosa — `sin 30^\circ` dan `\max` bukan kalimat.
 */
const MATH_WORDS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'lim',
  'max', 'min', 'gcd', 'lcm', 'mod', 'det', 'deg', 'dim', 'ker', 'sup', 'inf',
]);

/** Placeholder sementara untuk rumus yang sudah dibungkus `$` / `$$`. */
const MATH_HOLD = '\u0001';

/** Penanda satu token yang sudah pasti bagian rumus, dengan atau tanpa `\`. */
function isMathAnchor(token: string): boolean {
  return LATEX_COMMAND.test(token) || SCRIPT_MARK.test(token);
}

/**
 * Apakah satu token (potongan tanpa spasi) masih bisa ikut masuk satu rumus.
 * Yang menentukan: ada penanda rumus, atau tidak ada kata prosa di dalamnya.
 * Nama variabel tetap dianggap rumus walau lebih dari satu huruf — `AB` di
 * `(AB)^{-1}` bukan kata bahasa. Rumus yang sudah dibungkus `$` selalu menjadi
 * batas supaya tidak ter-nesting.
 */
function isMathToken(token: string): boolean {
  if (token.includes(MATH_HOLD)) return false;
  if (isMathAnchor(token)) return true;
  const words = token.match(/\p{L}+/gu) ?? [];
  if (!words.length) return true; // 6, &, =, {, }, -1/2
  return words.every(
    (word) => word.length === 1 || MATH_WORDS.has(word.toLowerCase()) || word === word.toUpperCase()
  );
}

/**
 * Bungkus rumus LaTeX yang telanjang dengan `$...$` supaya KaTeX merendernya.
 *
 * Dipakai untuk pilihan jawaban dan teks jawaban lain, karena di situ guru
 * sering menulis `\frac{1}{4}(\sqrt{6}+\sqrt{2})` tanpa pembatas — hasilnya
 * bukan simbol matematika, tapi karakter mentah yang tidak bisa dibaca.
 *
 * Aturannya sengaja konservatif:
 *   - teks tanpa penanda rumus sama sekali tidak tersentuh;
 *   - `$...$` dan `$$...$$` yang sudah ada dikunci dulu, jadi pemanggilan
 *     berulang mengembalikan teks yang sama persis (idempoten) dan rumus lama
 *     tidak pernah jadi `$...$...$`;
 *   - hanya rentetan matematika yang dibungkus: token ber-`\...` atau berpangkat
 *     `^{`/`_{`, plus tetangganya yang bukan prosa. Kata prosa minimal dua huruf
 *     (mis. `dan`, `adalah`) membelah rentetan, jadi kalimat tidak ikut berubah
 *     jadi rumus dan `1/2 dan -1/2\sqrt{3}` hanya bagian kedua yang dibungkus.
 */
export function wrapBareLatex(text: string): string {
  const source = String(text ?? '');
  if (!LATEX_COMMAND.test(source) && !SCRIPT_MARK.test(source)) return source;
  // Teks yang `$`-nya sudah ganjil memang sudah rusak; membungkus lagi hanya
  // menambah satu pasangan yang tidak berpasangan, jadi biarkan apa adanya.
  if ((source.match(/\$/g) ?? []).length % 2 === 1) return source;

  // Kunci dulu rumus yang sudah dibungkus supaya tidak ikut ter-wrap lagi.
  const held: string[] = [];
  let body = source.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (match) => {
    held.push(match);
    return `${MATH_HOLD}${held.length - 1}${MATH_HOLD}`;
  });
  // Semua rumusnya sudah berada di dalam `$...$`: biarkan apa adanya.
  if (!LATEX_COMMAND.test(body) && !SCRIPT_MARK.test(body)) return source;

  const tokens: Array<{ text: string; start: number; end: number }> = [];
  for (const match of body.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }

  // Kumpulkan rentetan matematika: token berurutan yang bukan prosa. Proyek atau
  // angka di dalam prosa jadi run sendiri, jadi `1/2 dan -1/2\sqrt{3}` membelah
  // diri dan hanya bagian yang punya penanda rumus yang ikut dibungkus.
  const runs: Array<[number, number]> = [];
  let open = -1;
  tokens.forEach((token, index) => {
    if (isMathToken(token.text)) {
      if (open < 0) open = index;
    } else if (open >= 0) {
      runs.push([open, index - 1]);
      open = -1;
    }
  });
  if (open >= 0) runs.push([open, tokens.length - 1]);

  const targets = runs.filter(([from, to]) => tokens.slice(from, to + 1).some((token) => isMathAnchor(token.text)));
  if (!targets.length) return source;

  // Bungkus dari belakang supaya offset token di depannya tidak bergeser.
  for (const [from, to] of targets.reverse()) {
    const start = tokens[from].start;
    const end = tokens[to].end;
    body = body.slice(0, start) + '$' + body.slice(start, end) + '$' + body.slice(end);
  }

  return body.replace(
    new RegExp(`${MATH_HOLD}(\\d+)${MATH_HOLD}`, 'g'),
    (_match, index: string) => held[Number(index)] ?? ''
  );
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

/* -------------------------------------------------------------------------- */
/* Helper tanggal                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ofset zona waktu untuk menghitung batas "hari" pada label tanggal.
 * WIB (UTC+7) dipilih karena seluruh antarmuka ini bahasa Indonesia dan
 * dipakai di dalam satu sekolah. Ofset ini hanya dipakai untuk membulatkan
 * ke hari kalender (label "Hari ini"), TIDAK untuk mengurutkan — sorting memakai
 * milidetik asli dari `parseStamp`, jadi urutan tidak pernah terpengaruh zona.
 */
const WIB_OFFSET_MINUTES = 7 * 60;

const DAY_MS = 86400000;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Ubah cap waktu menjadi milidetik sejak epoch, atau 0 kalau tidak bisa dibaca.
 *
 * Menerima dua bentuk yang memang tersimpan di KV:
 *   - `2026-09-27` (data lama, tanggal saja tanpa jam)
 *   - `2026-09-27T14:32:00.000Z` (data baru, ISO penuh)
 *
 * `Date.parse` memperlakukan bentuk tanggal-saja sebagai UTC tengah malam
 * sesuai spesifikasi ECMAScript, jadi keduanya tidak perlu cabang terpisah.
 * Nilai 0 sekaligus dipakai sebagai penanda "tidak ada tanggal": tidak pernah
 * muncul di data nyata, dan membuat pemanggil cukup memeriksa satu kondisi.
 */
export function parseStamp(raw: unknown): number {
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Cap waktu ISO penuh (dengan jam) untuk disimpan ke KV. */
export function stampNow(): string {
  return new Date().toISOString();
}

/** Awal hari kalender WIB, dalam milidetik sejak epoch. */
function wibDayStart(ms: number): number {
  const shifted = new Date(ms + WIB_OFFSET_MINUTES * 60000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Label tanggal yang dipakai di sidebar dan panel detail:
 * "Hari ini" / "Kemarin" / "3 hari lalu" / "27 Sep 2026".
 *
 * Selisih hari dihitung dari awal hari kalender di kedua sisi, jadi jam
 * penyimpanannya tidak memengaruhi label. Hasil selalu sama untuk semua
 * pengguna di zona waktu berbeda, dan kuis yang dibuat pukul 01:00 WIB tetap
 * berlabel "Hari ini" sampai lewat tengah malam, bukan berubah jadi "Kemarin"
 * di tengah hari.
 *
 * Mengembalikan string kosong kalau tanggalnya tidak ada atau rusak, supaya
 * pemanggil bisa menamparkannya tanpa perlu cek tambahan. Lihat `tests/meta-date.test.mjs`.
 */
export function relTime(raw: unknown, now: number = Date.now()): string {
  const ms = parseStamp(raw);
  if (!ms) return '';
  const days = Math.floor((wibDayStart(now) - wibDayStart(ms)) / DAY_MS);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  if (days < 7) return days + ' hari lalu';
  const shifted = new Date(ms + WIB_OFFSET_MINUTES * 60000);
  return `${shifted.getUTCDate()} ${MONTH_SHORT[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

/* -------------------------------------------------------------------------- */
/* Helper slug unik                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Alfabet untuk sufiks slug. Huruf `i`, `l`, `o` dan angka `0`, `1` sengaja
 * tidak dipakai supaya guru yang menyalin URL ke WA tidak salah ketik — `l`
 * vs `1` dan `O` vs `0` adalah kesalahan ketik yang paling sering.
 */
const SLUG_SUFFIX_LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const SLUG_SUFFIX_BODY = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Sufiks acak 4 karakter untuk slug yang sudah dipakai, misalnya `a1b2`.
 *
 * Karakter pertama dipaksa huruf supaya alamatnya tidak pernah dimulai angka.
 * Acaknya dari `crypto.getRandomValues`, yang tersedia di Workers maupun di
 * Node, jadi tidak perlu seeding dan tidak bisa ditebak dari slug sebelumnya.
 * Hasilnya selalu lolos `safeSlug()` di `auth.ts` karena hanya memakai huruf
 * kecil dan angka.
 */
export function randomSlugSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let out = SLUG_SUFFIX_LETTERS[bytes[0] % SLUG_SUFFIX_LETTERS.length];
  for (let i = 1; i < 4; i++) {
    out += SLUG_SUFFIX_BODY[bytes[i] % SLUG_SUFFIX_BODY.length];
  }
  return out;
}
