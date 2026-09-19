/* ==========================================================================
 * Mode "JSON Soal" — barrel (agregator) dari modul-modul kuis.
 *
 * Importer memakai:
 *   - './quiz'        (tanpa ekstensi) => dibundle esbuild/wrangler
 *   - './quiz.ts'     (dengan ekstensi) => dibaca Node langsung oleh tests
 *
 * Modul-modul penyusun:
 *   quiz-types   jenis data + konstanta inti
 *   quiz-util    helper teks murni (tanpa dependensi)
 *   quiz-media   slot media + konteks prompt gambar
 *   quiz-parse   normalisasi spec, deteksi fitur, authoring source
 *   quiz-rich    renderer teks kaya (subset markdown)
 *   quiz-grade   penilaian server-side
 *   quiz-page    generator halaman kuis
 * ========================================================================== */

export * from './quiz-types.ts';
export * from './quiz-util.ts';
export * from './quiz-media.ts';
export * from './quiz-parse.ts';
export * from './quiz-rich.ts';
export * from './quiz-grade.ts';
export * from './quiz-page.ts';
