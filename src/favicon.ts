/* ==========================================================================
 * Mark favicon bersama untuk semua halaman.
 *
 * Worker ini tidak punya satu file layout: tiap modul rute menulis <head>
 * sendiri di dalam template literal-nya, jadi tag di bawah diekspor sekali di
 * sini lalu disisipkan di setiap <head> — bukan ditulis ulang 9x. Kalau
 * favicon berubah, cukup ubah file ini.
 *
 * Berkas fisiknya dilayani binding ASSETS dari folder public/:
 *   favicon.svg, favicon-96x96.png, favicon.ico, apple-touch-icon.png,
 *   web-app-manifest-192x192.png, web-app-manifest-512x512.png,
 *   site.webmanifest
 *
 * Semua halaman memakainya, termasuk halaman cetak (?print=1) dan kartu error.
 * ========================================================================== */

/* Tag favicon + PWA. Sisipkan sebagai ${FAVICON_TAGS} tepat setelah
 * <meta name="viewport"> di dalam <head>.
 * - icon png 96 + svg: dipakai browser modern (svg diskalakan, tetap tajam di
 *   layar retina),
 * - shortcut icon .ico: fallback untuk browser lama yang hanya cari .ico,
 * - apple-touch-icon: iOS tidak membaca manifest, hanya melihat link ini,
 * - manifest: untuk "Add to Home Screen" (judul window = apple-mobile-web-app-title).
 * Urutan png -> svg -> ico sengaja dari yang paling baik dulu: browser
 * mengambil tag PERTAMA yang cocok, bukan yang terakhir. */
export const FAVICON_TAGS = `<link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="shortcut icon" href="/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-title" content="TQAssesment" />
<link rel="manifest" href="/site.webmanifest" />`;
