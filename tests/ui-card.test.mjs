/* ==========================================================================
 * Test kartu pesan/error bersama (src/ui-card.ts).
 *
 * Modul ini menggantikan empat salinan yang sebelumnya hidup terpisah
 * (errorPage + errorCard + 2x messagePage) dan satu halaman 503, yang
 * semuanya terlihat seperti produk berbeda. Yang dijaga di sini:
 *   1. SELURUH input di-escape (pesan bisa berisi slug dari storage).
 *   2. Gaya ikut tema terang/gelap lewat token, bukan warna hardcoded.
 *   3. Tidak ada CDN Tailwind di halaman error mana pun.
 *   4. Halaman setup 503 tetap menyebut dua perintah wajib.
 * ========================================================================== */

import { errorCard, messageCard } from '../src/ui-card.ts';
import { missingSecrets, secretSetupPage } from '../src/auth.ts';
import { readFileSync, existsSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failed += 1;
    failures.push(name);
    console.log('FAIL ' + name + ' — harapan: ' + JSON.stringify(expected) + ', nyata: ' + JSON.stringify(actual));
  }
}

/* ---------- escaping ---------- */
const xss = messageCard({ title: '<script>x</script>', message: 'slug <b>"a"</b> & co' });
check('title di-escape', xss.includes('&lt;script&gt;'), true);
check('title tidak mentah', xss.includes('<script>x</script>'), false);
check('pesan meng-escape kutip dan &', xss.includes('&lt;b&gt;&quot;a&quot;&lt;/b&gt; &amp; co'), true);

const href = messageCard({ title: 'x', message: 'y', backHref: '/p/a"onmouseover="1' });
check('backHref di-escape', href.includes('/p/a&quot;onmouseover=&quot;1'), true);
check('backHref tidak mentah', href.includes('onmouseover="1"'), false);

/* ---------- tombol kembali opsional ---------- */
check('tanpa backHref tidak ada tombol', errorCard('A', 'B', '').includes('class="back"'), false);
check('dengan backHref ada tombol', errorCard('A', 'B', '/').includes('href="/"'), true);
check('label tombol default', errorCard('A', 'B', '/').includes('Kembali ke Dashboard'), true);
check('label tombol custom', messageCard({ title: 'A', message: 'B', backHref: '/x', backLabel: 'Ke-absen' }).includes('Ke-absen'), true);
check('errorCard default ke dashboard', errorCard('A', 'B').includes('href="/"'), true);

/* ---------- nada & blok tambahan ---------- */
check('nada default danger', messageCard({ title: 'A', message: 'B' }).includes('color:var(--danger)'), true);
check('nada warn', messageCard({ title: 'A', message: 'B', tone: 'warn' }).includes('color:var(--warn)'), true);
check('nada info', messageCard({ title: 'A', message: 'B', tone: 'info' }).includes('color:var(--accent)'), true);
check('detail jadi pre', messageCard({ title: 'A', message: 'B', detail: 'npm i' }).includes('<pre class="detail">npm i</pre>'), true);
check('tanpa detail tidak ada pre', messageCard({ title: 'A', message: 'B' }).includes('<pre'), false);

const twoBlock = messageCard({ title: 'A', message: 'B', detail: 'd', note: 'n' });
check('note dirender setelah detail', twoBlock.indexOf('class="note"') > twoBlock.indexOf('class="detail"'), true);

/* ---------- halaman setup 503 ---------- */
const setup = secretSetupPage();
check('503 sebut SESSION_SECRET', setup.includes('npx wrangler secret put SESSION_SECRET'), true);
check('503 sebut APP_PASSWORD', setup.includes('npx wrangler secret put APP_PASSWORD'), true);
check('503 hilang warna hardcoded', setup.includes('#0f172a'), false);
check('503 ikut token tema', setup.includes('prefers-color-scheme:dark'), true);
check('503 tanpa tombol dashboard', setup.includes('Kembali ke Dashboard'), false);
check('missingSecrets kosong saat dua secret ada', missingSecrets({ SESSION_SECRET: 's', APP_PASSWORD: 'p' }).length, 0);

/* ---------- kartu tidak pernah menarik CSS/JS dari luar ---------- */
check('kartu tanpa tag script', xss.includes('<script'), false);
check('kartu tanpa CDN tailwind', xss.includes('cdn.tailwindcss.com'), false);
check('kartu memuat token tema', xss.includes('--accent:'), true);
check('kartu ikut memakai favicon bersama', xss.includes('href="/favicon.svg"'), true);

/* ---------- favicon: satu sumber, semua halaman ---------- */
//src/favicon.ts diekspor sekali lalu disisipkan di setiap <head>. Dua
// kegagalan yang tidak terlihat dari browser: ada halaman yang lupa
// menyisipkannya (tab jadi ikon default), atau tag ditulis ulang di tiap
// modul sehingga favicon berikutnya harus diubah 9x.
const faviconSrc = readFileSync(new URL('../src/favicon.ts', import.meta.url), 'utf8');
const pageModules = ['dashboard', 'guide', 'tka-studio', 'quiz-page', 'quiz-editor', 'quiz-essay', 'records', 'media-routes', 'ui-card'];
const pages = pageModules.map((m) => [m, readFileSync(new URL('../src/' + m + '.ts', import.meta.url), 'utf8')]);

check('FAVICON_TAGS diekspor sekali', faviconSrc.includes('export const FAVICON_TAGS'), true);
check('tag memuat keenam baris RealFaviconGenerator', [
  '<link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />',
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
  '<link rel="shortcut icon" href="/favicon.ico" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-title" content="TQAssesment" />',
  '<link rel="manifest" href="/site.webmanifest" />'
].every((tag) => faviconSrc.includes(tag)), true);
// Halaman cetak di quiz-page punya <head> sendiri, jadi penyisipannya
// dihitung per <head>, bukan per berkas.
for (const [name, code] of pages) {
  const heads = (code.match(/<head>/g) || []).length;
  const tags = (code.match(/\$\{FAVICON_TAGS\}/g) || []).length;
  check(name + ': setiap <head> memakai FAVICON_TAGS', heads > 0 && heads === tags, true);
  check(name + ': mengimpor FAVICON_TAGS', /import \{ FAVICON_TAGS \} from '\.\/favicon(\.ts)?'/.test(code), true);
  check(name + ': tidak menulis tag favicon sendiri', !/<link rel="(shortcut )?icon"/.test(code), true);
  check(name + ': tidak ada lagi favicon data-URI SQ', !/rel="icon" href="data:image\/svg\+xml/.test(code), true);
}
for (const file of ['favicon.svg', 'favicon-96x96.png', 'favicon.ico', 'apple-touch-icon.png', 'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png', 'site.webmanifest']) {
  check('berkas ' + file + ' ada di public/', existsSync(new URL('../public/' + file, import.meta.url)), true);
}
const manifest = JSON.parse(readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
check('manifest bernama TQAssesment', manifest.name, 'TQAssesment');
check('manifest punya dua ikon', manifest.icons.length, 2);
check('icon manifest menunjuk berkas yang ada', manifest.icons.every((i) => existsSync(new URL('../public' + i.src, import.meta.url))), true);

console.log('');
if (failed) {
  console.log('GAGAL: ' + failed + ' dari ' + (passed + failed) + ' test');
  console.log(failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log('Semua ' + passed + ' test ui-card lulus.');
