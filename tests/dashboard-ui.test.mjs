/* ==========================================================================
 * Test markup dashboard (src/dashboard.ts) — perubahan UI, bukan logika quiz.
 *
 * Dashboard dirender sebagai template string besar dengan inline JS, jadi tidak
 * ada yang bisa dipanggil langsung dari Node. Test ini membaca sumbernya dan
 * mengunci perilaku yang kalau salah terasa sebagai "halaman rusak" tanpa error
 * di console:
 *   - navigasi detail -> home tidak boleh menyisakan layar kosong,
 *   - toggle tab disembunyikan hanya saat detail,
 *   - ikon toggle sidebar & banner tidak boleh terbalik lagi,
 *   - judul dan lebar konten sesuai nilai yang disepakati.
 * ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';

const src = readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../src/tka-studio.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/guide.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/quiz-editor.ts', import.meta.url), 'utf8');

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

/** Ambil isi satu fungsi di inline JS dashboard. */
function fn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const end = src.indexOf('\n  }', start);
  return src.slice(start, end < 0 ? start + 400 : end);
}

const showHome = fn('showHome');
const showEmptyState = fn('showEmptyState');
const showDetailClose = fn('showDetailClose');
// Logika render view pindah ke renderDetail(); showDetail tinggal wrapper yang
// menambahkan pushState supaya alamat /?app=<slug> tercatat di address bar.
const renderDetail = fn('renderDetail');
const showDetail = fn('showDetail');
const setHomeTab = fn('setHomeTab');

/* ---------- navigasi: bug layar kosong ---------- */
// showDetail() menyembunyikan #viewHome. Setiap jalan pulang harus memanggil
// showHome() yang memunculkannya lagi, kalau tidak yang tampil hanya
// background kosong.
check('showHome ada', showHome.length > 0, true);
check('showHome memunculkan viewHome', showHome.includes("getElementById('viewHome')") && showHome.includes("home.style.display = 'flex'"), true);
check('showHome menyembunyikan viewDetail', showHome.includes("detail.style.display = 'none'"), true);
check('showHome melepas kelas view-detail', showHome.includes("classList.remove('view-detail')"), true);
check('showEmptyState memanggil showHome', showEmptyState.includes('showHome()'), true);
check('showDetailClose memanggil showHome', showDetailClose.includes('showHome()'), true);
// Prompt Engine pindah ke tab topbar, jadi setHomeTab yang jadi satu-satunya
// pengalih view home. showStudio wrapper-nya sudah dihapus sebagai kode mati.
check('wrapper showStudio sudah dihapus', src.includes('function showStudio'), false);
check('setHomeTab menyalakan viewStudio', setHomeTab.includes("studio.style.display = isDeploy ? 'none' : 'flex'"), true);
check('setHomeTab menyalakan viewEmpty', setHomeTab.includes("deploy.style.display = isDeploy ? 'flex' : 'none'"), true);
check('setHomeTab tetap lazy-load iframe studio', setHomeTab.includes("frame.setAttribute('src', '/studio')"), true);
check('showDetailClose memanggil showHome', showDetailClose.includes('showHome()'), true);
check('renderDetail menyembunyikan viewHome', renderDetail.includes("home.style.display = 'none'"), true);
check('renderDetail memasang kelas view-detail', renderDetail.includes("classList.add('view-detail')"), true);
// Navigasi berbasis URL: klik sidebar mendorong /?app=<slug> ke history,
// popstate menggambar ulang tampilan tanpa menyentuh history lagi.
check('showDetail mendorong URL detail ke history', showDetail.includes('setDetailUrl(slug)'), true);
check('setDetailUrl memakai pushState', src.includes("window.history.pushState({ app: slug || null }, '', url)"), true);
check('popstate membuka kembali detail', src.includes("window.addEventListener('popstate'") && src.includes('renderDetail(item, slug)'), true);
check('popstate tidak memanggil showDetailClose', src.includes('showDetailClose();') === false, true);
check('tutup detail membersihkan URL', showDetailClose.includes('closeDetailUrl()'), true);
check('closeDetailUrl memakai replaceState', src.includes("window.history.replaceState({ app: null }, '', window.location.pathname)"), true);
// Deep-link tetap mempertahankan ?app= di URL (refresh membuka panel yang sama).
check('deep-link tidak membuang query app', src.includes("window.history.replaceState(null, '', window.location.pathname);\n      return;") === false, true);
// Tidak boleh ada jalur pulang ke home yang masih managing view sendiri.
check('tidak adaDisplay manual di showEmptyState', showEmptyState.includes('viewDetail'), false);
check('tidak ada display manual di showDetailClose', showDetailClose.includes('viewDetail'), false);

/* ---------- toggle tab disembunyikan saat detail ---------- */
check('CSS menyembunyikan topbar-center saat detail', src.includes('body.view-detail .topbar-center{visibility:hidden}'), true);
check('toggle disembunyikan dengan visibility bukan display', src.includes('body.view-detail .topbar-center{display:none}'), false);
check('id homeTabs masih ada', src.includes('id="homeTabs"'), true);

/* ---------- ikon toggle sidebar ---------- */
// Kedua ikon harus pakai garis panel di kiri (x1=9); hanya arah chevron yang
// dibalik: saat sidebar terbuka tombolnya berarti "lipat" (panah ke kiri), saat
// terlipat berarti "panggil" (panah ke kanan).
const iClose = src.match(/<svg class="i-close"[\s\S]*?<\/svg>/)?.[0] ?? '';
const iOpen = src.match(/<svg class="i-open"[\s\S]*?<\/svg>/)?.[0] ?? '';
check('ikon i-close ada', iClose.length > 0, true);
check('ikon i-open ada', iOpen.length > 0, true);
check('i-close garis panel kiri', iClose.includes('x1="9"'), true);
check('i-open garis panel kiri', iOpen.includes('x1="9"'), true);
check('i-close chevron ke kiri (lipat)', iClose.includes('points="15 9 12 12 15 15"'), true);
check('i-open chevron ke kanan (panggil)', iOpen.includes('points="10 9 13 12 10 15"'), true);
check('i-open tidak memakai garis kanan', iOpen.includes('x1="15"'), false);
check('CSS i-close tampil saat sidebar terbuka', src.includes('.topbar-toggle .i-close{display:block}'), true);
check('CSS i-open tampil saat terlipat', src.includes('body.sb-collapsed .topbar-toggle .i-open{display:block}'), true);

/* ---------- ikon banner ---------- */
const bannerHide = src.match(/<button[^>]*class="brand-banner-hide"[\s\S]*?<\/svg>/)?.[0] ?? '';
const bannerShow = src.match(/<button[^>]*class="banner-show"[\s\S]*?<\/svg>/)?.[0] ?? '';
check('tombol sembunyikan banner ada', bannerHide.length > 0, true);
check('ikon saat banner terlihat adalah X', bannerHide.includes('<line x1="6" y1="6" x2="18" y2="18"/>') && bannerHide.includes('<line x1="6" y1="18" x2="18" y2="6"/>'), true);
check('ikon saat banner terlihat bukan chevron', bannerHide.includes('polyline'), false);
check('ikon saat banner tersembunyi adalah panah bawah', bannerShow.includes('points="6 9 12 15 18 9"'), true);
check('panah bawah hanya saat banner hidden', src.includes('body.banner-hidden .banner-show{display:flex}'), true);

/* ---------- jumlah aplikasi di pojok dihapus ---------- */
check('chip jumlah aplikasi dihapus', src.includes('} Aplikasi</span>'), false);
check('tidak ada lagi hitung projects.length di topbar', src.includes("style=\"display:${projects.length ? 'inline-block' : 'none'}\""), false);
check('topbar-actions masih ada untuk tombol banner', src.includes('class="topbar-actions"'), true);

/* ---------- judul ---------- */
check('judul tab browser diganti', src.includes('<title>TQAssesment - SMK Thibbil Qulub Assimbani</title>'), true);
check('judul sidebar diganti', src.includes('<span class="sidebar-title">TQAssesment</span>'), true);
check('judul topbar diganti', src.includes('<span class="topbar-title">TQAssesment</span>'), true);
check('judul lama tidak tersisa di dashboard', src.includes('Gemini Edge Deployer'), false);

/* ---------- logo sekolah di banner ---------- */
// Logo SMK (public/assets/logo.png) hanya jadi identitas di banner sekolah;
// kotak "SQ" tetap mark aplikasi di sidebar dan topbar. Kalau path-nya salah
// atau markupl-nya balik ke SVG, yang hilang cuma gambar tanpa error log.
check('badge banner memakai logo sekolah', src.includes('<img src="/assets/logo.png" alt="" width="32" height="32"'), true);
check('logo sekolah ada di dalam badge banner', /class="brand-banner-badge"[\s\S]{0,200}assets\/logo\.png/.test(src), true);
check('badge banner tidak pakai ikon topi lagi', /class="brand-banner-badge"[\s\S]{0,200}<svg/.test(src), false);
check('rasio logo dijaga object-fit', src.includes('.brand-banner-badge img{width:100%;height:100%;object-fit:contain'), true);
check('badge banner punya dimensi tetap', src.includes('.brand-banner-badge{width:32px;height:32px;'), true);
check('mark aplikasi pakai file logoapps.jpg', src.includes('<img class="sidebar-logo" src="/assets/logoapps.jpg"') && src.includes('<img class="topbar-logo" src="/assets/logoapps.jpg"'), true);
check('kotak teks SQ tidak tersisa di dashboard', src.includes('>SQ</span>'), false);
check('rasio mark aplikasi dijaga object-fit', src.includes('img.sidebar-logo,img.topbar-logo{display:block;object-fit:contain}'), true);
check('mark aplikasi punya dimensi agar tidak melompat', src.includes('width="28" height="28"') && src.includes('width="34" height="34"'), true);
check('mark aplikasi punya alt text', src.includes('alt="Logo TQAssesment"'), true);
check('berkas mark aplikasi ada di public/assets', existsSync(new URL('../public/assets/logoapps.jpg', import.meta.url)), true);
check('berkas logo ada di public/assets', existsSync(new URL('../public/assets/logo.png', import.meta.url)), true);

/* ---------- aksi "Salin Link" di panel detail ---------- */
// Tombolnya menyalin URL absolut /p/<slug>. Penegasan: navigator.clipboard
// hanya jalan di konteks aman, jadi fallback execCommand wajib ada — kalau
// hilang, tombolnya diam saja saat guru buka dashboard lewat localhost.
const copyFn = fn('copyAppLink');
const copyTextFn = fn('copyText');
check('aksi Salin Link ada di panel detail', src.includes('data-copy-btn='), true);
check('aksi Salin Link muncul setelah Buka App', src.indexOf('<span data-copy-label>Salin Link</span>') > src.indexOf('Buka App</a>'), true);
check('label tombol punya slot yang bisa diganti', src.includes('<span data-copy-label>Salin Link</span>'), true);
check('tautan yang disalin adalah URL absolut /p/slug', copyFn.includes("window.location.origin + '/p/' + slug"), true);
check('pakai clipboard API bila konteks aman', copyTextFn.includes('navigator.clipboard && window.isSecureContext'), true);
check('ada fallback untuk konteks tidak aman', copyTextFn.includes("document.execCommand('copy')"), true);
check('fallback membersihkan textarea sementara', copyTextFn.includes('document.body.removeChild(ta)'), true);
check('sukses dan gagal dibedakan di label', src.includes("flashCopy(btn, label, original, 'Tersalin')") && src.includes("flashCopy(btn, label, original, 'Gagal')"), true);
check('label dikembalikan setelah 1,6 detik', fn('flashCopy').includes('}, 1600);'), true);
check('konfirmasi tidak perlu toast baru', src.includes('.detail-action.done{color:var(--ok)'), true);
check('klik Salin Link ditangani lewat delegasi', src.includes("e.target.closest('[data-copy-btn]')"), true);

/* ---------- lebar konten ---------- */
check('deploy box 960px', src.includes('.empty-state{text-align:center;max-width:960px;width:100%}'), true);
check('detail app 900px', src.includes('.detail-view{display:none;width:100%;max-width:900px}'), true);
check('prompt engine konten 1400px', studio.includes('main{max-width:1400px;'), true);
check('prompt engine bukan 1000px lagi', studio.includes('max-width:1000px'), false);

/* ---------- chrome Prompt Engine dipangkas ---------- */
// Topbar-nya (SQ, judul, tombol Panduan) dihapus karena halaman ini hidup di
// iframe dashboard yang sudah punya topbar; Gem Gemini pindah ke sebelah
// tombol "Salin prompt" supaya tidak hilang fitur.
check('topbar prompt engine dihapus', studio.includes('<nav class="topbar">'), false);
check('css topbar prompt engine ikut dibersihkan', studio.includes('.topbar-inner{'), false);
check('script embedded ikut dibersihkan', studio.includes("classList.add('embedded')"), false);
check('Gem Gemini pindah ke card hasil prompt', studio.includes('href="${GEM_URL}" target="_blank" rel="noopener"'), true);
check('Gem Gemini duduk di sebelah Salin prompt', /card-actions[\s\S]{0,400}fa-gem[\s\S]{0,400}Salin prompt/.test(studio), true);
check('Gem Gemini tidak lagi di sidebar', src.includes('Gem Gemini'), false);
check('Prompt Engine tidak lagi di sidebar', src.includes('/studio" class="sidebar-footer-btn"'), false);
check('sidebar footer masih ada Panduan', src.includes('/panduan" class="sidebar-footer-btn"'), true);
check('sidebar footer masih ada Keluar', src.includes('/api/logout" class="sidebar-footer-btn"'), true);
check('dashboard tidak mengimpor GEM_URL lagi', src.includes("import { GEM_URL } from './guide'"), false);

/* ---------- halaman panduan ikut tema ---------- */
check('panduan pakai font Geist', guide.includes("@font-face{font-family:'Geist'"), true);
check('panduan shim class tailwind ke token', guide.includes('.bg-slate-900{background-color:var(--bg)!important}'), true);
check('panduan punya token tema sendiri', guide.includes('--accent:#7c3aed;'), true);
check('panduan ikut mode gelap', guide.includes('@media(prefers-color-scheme:dark)'), true);
check('panduan judul ikut TQAssesment', guide.includes('Panduan Penggunaan - TQAssesment'), true);

/* ---------- isi panduan ikut alur aplikasi terkini ---------- */
// Panduan ditulis sebelum Prompt Engine, Salin Link, dan backfill ada. Yang
// dicek di sini: setiap fitur yang benar-benar ada di UI juga disebut di
// /panduan, dan penomoran langkahnya tidak tertinggal.
check('panduan menyebut Prompt Engine', guide.includes('Prompt Engine'), true);
check('panduan menyebut keempat tab Prompt Engine', ['Generator', 'Kelola Mapel', 'Admin Template', 'Import / Export'].every((t) => guide.includes(t)), true);
check('panduan menyebut aksi Salin Link', guide.includes('Salin Link'), true);
check('panduan menyebut tombol pindai index R2', guide.includes('Pindai aplikasi lama ke index R2'), true);
check('panduan menjelaskan identitas Nama + kelas', guide.includes('Nama + kelas'), true);
check('panduan menjelaskan render LaTeX otomatis', guide.includes('KaTeX'), true);
check('panduan menyebut batas lockout login', guide.includes('15 menit'), true);
check('panduan menautkan halaman /studio', guide.includes('/studio'), true);
check('panduan menautkan halaman /panduan', guide.includes('/panduan'), true);
check('panduan menyebut kartu 404', guide.includes('Aplikasi tidak ditemukan'), true);
check('panduan nav pakai logo SQ', guide.includes('>SQ</div>'), true);
check('panduan tidak menyalin prompt lewat sidebar', guide.includes('Prompt Engine bukan tombol sidebar'), true);
check('panduan menyebut tombol Gem di kartu hasil', guide.includes('Gem Gemini</b> yang membuka Gem'), true);
// Strip langkah jadi 6 (Prompt Engine masuk sebagai langkah 1), bagian bawah
// 3+3 supaya simetris. Badge angka diseragamkan ke warna accent.
check('strip langkah panduan 3+3', guide.includes('sm:grid-cols-5') && guide.includes('grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-center'), true);
check('strip langkah panduan punya 6 kotak', (guide.match(/w-7 h-7 rounded-full bg-orange-500/g) || []).length === 6, true);
check('penomoran langkah panduan lengkap 1-6', [1, 2, 3, 4, 5, 6].every((n) => guide.includes(`stepHeader('${n}',`)), true);
// Sub-label 3a/3b/3c harus ikut naik ke 4a/4b/4c setelah Prompt Engine
// menyingkirkan satu langkah. Kalau belum, referensinya menunjuk kartu Salah.
check('sub-label langkah gambar ikut naik', ['4a.', '4b.', '4c.'].every((t) => guide.includes(t)) && !/3[abc]\. Generate|<span class="text-sm">3[abc]\./.test(guide), true);
check('rujukan silang panel Gambar menunjuk langkah 4', guide.includes('(Langkah 4)'), true);

/* ---------- <select> "Identitas siswa" di editor soal ---------- */
// Select adalah satu-satunya kontrol di kartu identitas yang TIDAK ikut aturan
// .field, jadi tampilannya jatuh ke bawaan browser. Di mode gelap yang berarti
// teks terang (--text) di atas latar putih UA — praktis tak terbaca.
check('identitas siswa memang sebuah select', editor.includes('<select id="qe-identity">'), true);
check('select ikut aturan .field', editor.includes('.field textarea,.field select{width:100%;'), true);
check('select punya focus ring yang sama', editor.includes('.field textarea:focus,.field select:focus{border-color:var(--accent)}'), true);
check('select global mengambil warna tema', editor.includes('select{background:var(--bg);color:var(--text);border:1px solid var(--border)'), true);
check('opsi dropdown ikut tema', editor.includes('option{background:var(--bg);color:var(--text)}'), true);
check('panah dropdown diganti chevron sendiri', editor.includes('appearance:none;-webkit-appearance:none;') && editor.includes('background-position:right 11px center'), true);
check('ruang untuk chevron tidak menimpa padding lain', editor.includes('padding-right:34px;'), true);
check('select tipe soal punya fokus', editor.includes('select[data-field=type]:focus{border-color:var(--accent)!important}'), true);

/* ---------- tombol Dashboard di editor digantikan logo ---------- */
// Di editor soal, mark logo aplikasi (yang menuju "/") menggantikan tombol
// teks "Dashboard". Kalau tombolnya masih ada, ada dua jalan ke dashboard di
// satu topbar; kalau logo jadi <span> biasa, guru klik logo tapi tidak terjadi
// apa-apa karena <a> pembungkusnya hilang.
check('tombol Dashboard di editor dihapus', editor.includes('class="back"'), false);
check('css .back di editor ikut dibersihkan', editor.includes('.back{'), false);
check('mark logo di editor jadi tautan ke /', /<a class="brand" href="\/" title="Kembali ke Dashboard"/.test(editor), true);
check('mark logo di editor memakai logoapps.jpg', /<a class="brand"[\s\S]{0,200}assets\/logoapps\.jpg/.test(editor), true);
check('mark logo di editor punya aria-label', editor.includes('aria-label="Kembali ke Dashboard"'), true);
check('gambar mark punya dimensi tetap', editor.includes('<img src="/assets/logoapps.jpg" alt="" width="34" height="34"'), true);
check('rasio mark di editor dijaga object-fit', editor.includes('.brand img{width:100%;height:100%;object-fit:contain'), true);
check('judul Edit Soal tetap ada setelah logo', editor.includes('<h1>Edit Soal: ${escapeHtml(title)}</h1>'), true);

console.log('');
if (failed) {
  console.log('GAGAL: ' + failed + ' dari ' + (passed + failed) + ' test');
  console.log(failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log('Semua ' + passed + ' test dashboard lulus.');
