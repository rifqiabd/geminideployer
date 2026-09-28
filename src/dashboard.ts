/* ==========================================================================
 * Dashboard admin (hasil pemecahan index.ts): GET / — form login tanpa sesi,
 * sidebar aplikasi + panel detail saat sesi aktif. Template HTML besar beserta
 * inline JS-nya dipindah utuh, bukan dipecah.
 * ========================================================================== */
import type { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { escapeHtml, parseStamp, relTime } from './quiz';
import { withMediaStats } from './media-routes';
import { GEM_URL } from './guide';
import {
  PRE_COOKIE_NAME,
  csrfFor,
  getSession,
  missingSecrets,
  randomNpc,
  secretSetupPage,
  signPreSession,
  verifyPreSession,
} from './auth';

// Bindings minimal dashboard: KV + R2 opsional (statistik media) + secret auth.
type DashboardBindings = { STORAGE: KVNamespace; MEDIA?: R2Bucket; SESSION_SECRET?: string; APP_PASSWORD?: string; PPDB_WHATSAPP?: string };
type DashboardEnv = { Bindings: DashboardBindings };

export function registerDashboardRoutes<E extends DashboardEnv>(app: Hono<E>) {
app.get('/', async (c) => {
  // T0: tanpa secret wajib, tampilkan halaman instruksi 503 daripada form
  // login yang pasti ditolak — supaya lockout tidak butuh tebakan.
  if (missingSecrets(c.env).length) return c.html(secretSetupPage(), 503);

  const secret = c.env.SESSION_SECRET ?? '';
  const session = await getSession(c);
  const isAuth = session !== null;

  // Pra-sesi login (T2): dipasang saat GET / tanpa sesi supaya form login
  // punya token CSRF tanpa penyimpanan server. TTL 30 menit.
  let loginCsrf = '';
  if (!isAuth) {
    const existing = getCookie(c, PRE_COOKIE_NAME);
    const pre = existing ? await verifyPreSession(existing, secret) : null;
    const npc = pre?.npc ?? randomNpc();
    setCookie(c, PRE_COOKIE_NAME, await signPreSession(secret, 30 * 60, undefined, npc), {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 30 * 60,
    });
    loginCsrf = await csrfFor(npc, secret);
  }
  // Token CSRF sesi: dibaca inline JS lewat meta tag di bawah.
  const authCsrf = session ? await csrfFor(session.npc, secret) : '';

  let projects: any[] = [];
  if (isAuth) {
    const list = await c.env.STORAGE.list({ prefix: 'meta:' });
    // KV remote berarti tiap get adalah round-trip jaringan; dulu loop ini
    // serial sehingga publish terasa berat (N app × beberapa get + statistik
    // media yang ikut mengunduh gambar). Semua pembacaan diparalelkan.
    const metas = await Promise.all(list.keys.map((key) => c.env.STORAGE.get(key.name)));
    projects = (
      await Promise.all(
        metas.map(async (val) => {
          if (!val) return null;
          const meta = JSON.parse(val);
          return withMediaStats(c.env, meta);
        })
      )
    ).filter((p): p is any => p !== null);
    // Urutan sidebar mengikuti tanggal dibuat, terbaru dulu. Sebelumnya hanya
    // `reverse()` atas urutan leksikografis KV, jadi urutannya Z->A berdasarkan
    // slug dan sama sekali tidak mencerminkan tanggal. `sort` di JS stabil,
    // sehingga aplikasi yang `created_at`-nya sama tetap urutnya seperti biasa.
    projects.sort((a, b) => parseStamp(b.created_at) - parseStamp(a.created_at));
  }

  const appData: Record<string, any> = {};
  if (isAuth) {
    await Promise.all(
      projects.map(async (p) => {
        let preview = '';
        if (p.type === 'json') {
          preview = (await c.env.STORAGE.get(`quizsource:${p.slug}`)) || '';
        } else {
          const html = await c.env.STORAGE.get(`html:${p.slug}`);
          preview = html ? html.slice(0, 1500) : '';
        }
        appData[p.slug] = {
          title: p.title,
          type: p.type,
          slug: p.slug,
          date: relTime(p.created_at),
          size: p.size,
          mediaMissing: p.media_missing || 0,
          mediaTotal: p.media_slots || 0,
          preview,
        };
      })
    );
  }
  // Sidebar tidak lagi menampilkan tanggal secara permanen, jadi keterangan
  // kapan aplikasi dibuat dan kapan terakhir diubah ditampilkan lewat custom
  // tooltip saat baris di-hover (lihat #appTip). Kuis lama belum punya
  // `updated_at`, jadi bagian "Diubah ..." hanya ditulis kalau `relTime`
  // benar-benar menghasilkan teks.
  const modData = (p: { created_at?: unknown; updated_at?: unknown }): string => {
    const created = relTime(p.created_at);
    const mod = relTime(p.updated_at);
    const parts: string[] = [];
    if (created) parts.push(`Dibuat ${created}`);
    if (mod) parts.push(`Diubah ${mod}`);
    return escapeHtml(parts.join(' · '));
  };

  const appDataJson = JSON.stringify(appData).replace(/</g, '\\u003c');

  // Ajakan PPDB 2027/2028 di banner. Tombol "Daftar Sekarang" SELALU tampil.
  // Nomor WhatsApp panitia (env publik, bukan secret) membuatnya langsung
  // menuju chat admin; tanpa nomor tautannya tetap sah — WhatsApp terbuka
  // dengan pesan siap kirim dan guru memilih kontak panitia.
  const ppdbPhone = String(c.env.PPDB_WHATSAPP ?? '').replace(/[^\d]/g, '');
  const ppdbText = encodeURIComponent('Assalamualaikum, saya ingin mendaftar PPDB SMK Thibbil Qulub Assimbani 2027/2028. Mohon informasi pendaftarannya.');
  const ppdbUrl = `https://wa.me/${ppdbPhone}?text=${ppdbText}`;

return c.html(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Edge Deployer - SMK Thibbil Qulub Assimbani</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-text-size-adjust:100%}
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geistmono-variable.woff2') format('woff2')}
    :root{
      --bg:#ffffff;--surface:#f9f9f9;--surface-2:#f0f0f0;--sidebar-bg:#f9f9f9;
      --border:#e5e5e5;--text:#171717;--text-secondary:#737373;--text-faint:#a3a3a3;
      --accent:#7c3aed;--accent-hover:#6d28d9;--accent-soft:rgba(124,58,237,.08);
      --danger:#ef4444;--danger-soft:rgba(239,68,68,.08);--warn:#d97706;
      --radius:14px;--radius-sm:10px;--sidebar-width:260px;
      --shadow:0 2px 8px rgba(0,0,0,.06);--shadow-lg:0 8px 32px rgba(0,0,0,.1);
    }
    @media(prefers-color-scheme:dark){
      :root{
        --bg:#212121;--surface:#303030;--surface-2:#3a3a3a;--sidebar-bg:#171717;
        --border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--text-faint:#6b6b6b;
        --accent:#8b5cf6;--accent-hover:#a78bfa;--accent-soft:rgba(139,92,246,.12);
        --danger:#f87171;--danger-soft:rgba(248,113,113,.12);--warn:#fbbf24;
        --shadow:0 2px 8px rgba(0,0,0,.2);--shadow-lg:0 8px 32px rgba(0,0,0,.4);
      }
    }
    body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow:hidden;height:100vh;display:flex;flex-direction:column}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit}
    .app-layout{display:flex;flex:1;min-height:0;overflow:hidden}

    /* ========== SIDEBAR ========== */
    .sidebar{width:var(--sidebar-width);flex-shrink:0;background:var(--sidebar-bg);border-right:1px solid var(--border);display:flex;flex-direction:column;transition:width .15s ease;position:relative;z-index:50}
    .sidebar.collapsed{width:0;border-right-width:0;overflow:hidden}
    .sidebar.collapsed .sidebar-header>*,
    .sidebar.collapsed .sidebar-new,
    .sidebar.collapsed .sidebar-search,
    .sidebar.collapsed .sidebar-divider,
    .sidebar.collapsed .sidebar-label,
    .sidebar.collapsed .sidebar-list,
    .sidebar.collapsed .sidebar-footer{visibility:hidden}
    .sidebar-resizer{position:absolute;top:0;right:-3px;width:6px;height:100%;cursor:col-resize;z-index:60;touch-action:none}
    .sidebar-resizer:hover,.sidebar-resizer.dragging{background:var(--accent-soft)}
    .sidebar-resizer:hover::after,.sidebar-resizer.dragging::after{content:'';position:absolute;top:50%;left:50%;width:3px;height:32px;transform:translate(-50%,-50%);border-radius:2px;background:var(--accent)}
    .sidebar-header{padding:12px;display:flex;align-items:center;gap:8px}
    .sidebar-brand{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;transition:background .15s}
    .sidebar-brand:hover{background:var(--surface-2)}
    .sidebar-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px}
    .sidebar-title{font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media(max-width:480px){.topbar-actions .detail-chip{display:none!important}}

    .sidebar-new{padding:0 12px 8px}
    .btn-new-deploy{width:100%;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s}
    .btn-new-deploy:hover{background:var(--surface-2);border-color:var(--text-faint)}
    .btn-new-deploy svg{flex:none;color:var(--text-secondary)}

    .sidebar-search{padding:0 12px 10px}
    .search-box{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);transition:border-color .15s,box-shadow .15s}
    .search-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
    .search-box svg{flex:none;color:var(--text-faint);width:14px;height:14px}
    .search-box input{flex:1;border:none;outline:none;background:none;color:var(--text);font-size:13px;font-family:inherit;min-width:0}
    .search-box input::placeholder{color:var(--text-faint)}

    .sidebar-divider{height:1px;background:var(--border);margin:0 12px}
    .sidebar-label{font-size:11px;font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;padding:10px 22px 6px}

    .sidebar-list{flex:1;overflow-y:auto;padding:0 8px}
    .sidebar-list::-webkit-scrollbar{width:4px}
    .sidebar-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

    .sidebar-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:background .15s;position:relative}
    .sidebar-item:hover{background:var(--surface-2)}
    .sidebar-item.active{background:var(--accent-soft);color:var(--accent)}
    .sidebar-item-icon{color:var(--text-secondary);flex:none;display:flex}
    .sidebar-item.active .sidebar-item-icon{color:var(--accent)}
    .sidebar-item-text{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sidebar-item-time{font-size:11px;color:var(--text-faint);flex:none;white-space:nowrap;display:none}
    .sidebar-item-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:none;gap:2px}
    .sidebar-item:hover .sidebar-item-actions{display:flex}
    /* Tanggal dibuat disembunyikan permanen supaya daftar aplikasi tetap rapat,
       lalu muncul lagi saat hover. Nilai 62px menyisakan ruang untuk dua tombol
       aksi (26px + celah 2px) yang juga muncul saat hover, jadi tanggal tidak
       tertutup tombol. */
    .sidebar-item:hover .sidebar-item-time{display:inline;margin-right:62px}
    .sidebar-item-btn{width:26px;height:26px;border:none;background:var(--surface);color:var(--text-secondary);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
    .sidebar-item-btn:hover{background:var(--surface-2);color:var(--text)}
    .sidebar-item-btn.danger:hover{color:var(--danger)}

    .sidebar-footer{padding:12px;border-top:1px solid var(--border)}
    .sidebar-footer-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;background:none;color:var(--text-secondary);border-radius:var(--radius-sm);cursor:pointer;font-size:13px;font-family:inherit;transition:background .15s,color .15s}
    .sidebar-footer-btn:hover{background:var(--surface-2);color:var(--text)}

    .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:45}

    /* ========== MAIN ========== */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
    /* ========== BANNER SEKOLAH + AJAKAN PPDB ========== */
    /* Bar penuh di paling atas, membentang di atas sidebar dan konten. Body
       kolom flex, jadi .app-layout mengisi sisa tinggi setelah banner. Kiri:
       kop sekolah. Kanan: ajakan PPDB (chip berdenyut + tombol WhatsApp) dan
       tombol sembunyikan. Gradasi tipis dari aksen supaya terbaca sebagai kop
       sekolah, bukan judul mengambang. */
    .brand-banner{display:flex;align-items:center;gap:16px;padding:10px 14px;flex:none;width:100%;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--bg)),var(--bg))}
    .brand-banner-brand{display:flex;align-items:center;gap:12px;flex:1;min-width:0}
    .brand-banner-badge{width:32px;height:32px;flex:none;border-radius:9px;background:linear-gradient(135deg,var(--accent),#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center}
    .brand-banner-text{display:flex;flex-direction:column;min-width:0;line-height:1.3}
    .brand-banner-title{font-size:13.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .brand-banner-sub{font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* Ajakan PPDB: chip berdenyut + tombol WhatsApp hijau yang sedikit terangkat saat hover. */
    .ppdb-cta{display:flex;align-items:center;gap:8px;flex:none;text-decoration:none}
    .ppdb-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11.5px;font-weight:600;white-space:nowrap;border:1px solid color-mix(in srgb,var(--accent) 22%,transparent)}
    .ppdb-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:ppdbPulse 1.9s ease-out infinite}
    @keyframes ppdbPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
    .ppdb-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:9px;background:#25d366;color:#fff;font-size:12.5px;font-weight:600;white-space:nowrap;box-shadow:0 1px 2px rgba(37,211,102,.35);transition:transform .15s,box-shadow .15s,background .15s}
    .ppdb-cta:hover .ppdb-btn{background:#1ebe5a;transform:translateY(-1px);box-shadow:0 4px 12px rgba(37,211,102,.4)}
    .ppdb-btn svg{width:15px;height:15px;flex:none}
    .ppdb-btn-short{display:none}
    .brand-banner-hide{width:28px;height:28px;flex:none;border:none;background:none;color:var(--text-faint);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
    .brand-banner-hide:hover{background:var(--surface-2);color:var(--text)}
    body.banner-hidden .brand-banner{display:none}
    .banner-show{width:32px;height:32px;border:none;background:none;color:var(--text-secondary);border-radius:8px;cursor:pointer;display:none;align-items:center;justify-content:center;flex:none}
    .banner-show:hover{background:var(--surface-2);color:var(--text)}
    body.banner-hidden .banner-show{display:flex}
    /* Mobile: sembunyikan sub-judul & chip supaya kop + tombol tetap muat. */
    @media(max-width:720px){
      .brand-banner-sub{display:none}
      .ppdb-chip{display:none}
      .ppdb-btn-full{display:none}
      .ppdb-btn-short{display:inline}
    }

    /* Topbar 3 kolom: kiri (toggle + brand), tengah (tab switch home),
       kanan (aksi). Kolom tengah memastikan toggle Deploy/Prompt pas center.
       Borderless: warna sama dengan konten di bawahnya, tanpa garis pemisah. */
    .main-topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;background:var(--bg);flex:none;padding:10px 16px}
    .topbar-left{display:flex;align-items:center;gap:12px;min-width:0}
    .topbar-center{display:flex;justify-content:center;min-width:0}
    .topbar-center .seg{background:var(--surface-2);border-color:var(--border)}
    /* Toggle sidebar di topbar: selalu ada di desktop, ditaruh di kolom kiri
       topbar dengan lebar tetap supaya tombolnya diam di tempat saat brand
       muncul/hilang. */
    .topbar-toggle-slot{width:36px;display:flex;justify-content:center;flex:none}
    .topbar-toggle{width:32px;height:32px;border:none;background:none;color:var(--text-secondary);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
    .topbar-toggle:hover{background:var(--surface-2);color:var(--text)}
    .topbar-toggle .i-close{display:block}
    .topbar-toggle .i-open{display:none}
    body.sb-collapsed .topbar-toggle .i-close{display:none}
    body.sb-collapsed .topbar-toggle .i-open{display:block}
    @media(max-width:1023px){
      .topbar-toggle{display:none}
    }
    .hamburger{width:36px;height:36px;border:none;background:none;color:var(--text);border-radius:8px;cursor:pointer;display:none;align-items:center;justify-content:center}
    .hamburger:hover{background:var(--surface-2)}
    .topbar-brand{display:flex;align-items:center;gap:10px;min-width:0}
    /* Brand "Gemini Edge Deployer" di topbar disembunyikan di desktop dan baru
       muncul saat sidebar terlipat. Di mobile sidebar memang tersembunyi
       default, jadi brand selalu tampil sebagai penanda halaman. */
    @media(min-width:1024px){
      .topbar-brand{display:none}
      body.sb-collapsed .topbar-brand{display:flex}
    }
    .topbar-logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center;flex:none;font-size:15px;font-weight:700}
    .topbar-brand-text{display:flex;flex-direction:column;min-width:0}
    .topbar-title{font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-sub{font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .topbar-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
    .btn-ghost{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:500;padding:6px 12px;cursor:pointer;white-space:nowrap;font-family:inherit;background:var(--surface);color:var(--text);transition:background .15s,border-color .15s}
    .btn-ghost:hover{background:var(--surface-2);border-color:var(--text-faint)}
    .btn-primary{display:inline-flex;align-items:center;gap:7px;border:none;border-radius:8px;font-size:13px;font-weight:500;padding:6px 14px;cursor:pointer;white-space:nowrap;font-family:inherit;background:var(--accent);color:#fff;transition:background .15s}
    .btn-primary:hover{background:var(--accent-hover)}

    .main-content{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;overflow-y:auto}

    /* ========== HOME VIEW ========== */
    #viewHome{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .main-content.studio-host{align-items:stretch;padding:0;overflow:hidden}
    .studio-frame{flex:1;width:100%;border:none;background:var(--bg)}

    /* ========== EMPTY STATE ========== */
    .empty-state{text-align:center;max-width:680px;width:100%}
    .empty-greeting{font-size:28px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px;color:var(--text)}
    .empty-sub{font-size:14px;color:var(--text-secondary);margin-bottom:24px}

    /* ========== DEPLOY CHAT BOX (docked) ========== */
    .chat-box{text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px;transition:border-color .15s,box-shadow .15s}
    .chat-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
    .chat-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}
    .chat-head-icon{width:32px;height:32px;border-radius:9px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;flex:none}
    .chat-title{font-size:15px;font-weight:600;letter-spacing:-.01em}
    .chat-sub{font-size:12px;color:var(--text-secondary);margin-top:1px}

    .form-row{margin-bottom:14px}
    .form-row:last-child{margin-bottom:0}
    .form-label{display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px}
    .form-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;transition:border-color .15s}
    .form-input:focus{border-color:var(--accent)}
    .form-input.code{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;min-height:120px;resize:vertical}

    .form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    .btn-cancel{padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:inherit;transition:background .15s}
    .btn-cancel:hover{background:var(--surface-2)}
    .btn-deploy{padding:8px 20px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s}
    .btn-deploy:hover{background:var(--accent-hover)}

    /* ========== APP DETAIL VIEW ========== */
    .detail-view{display:none;width:100%;max-width:640px}
    .detail-view.active{display:block}
    .detail-header{margin-bottom:24px}
    .detail-title{font-size:24px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
    .detail-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-secondary);flex-wrap:wrap}
    .detail-meta-item{display:flex;align-items:center;gap:5px}
    .detail-meta-item svg{flex:none;color:var(--text-faint)}
    .detail-chip{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:2px 8px}
    .detail-warn{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.25);border-radius:var(--radius-sm);font-size:12px;color:var(--warn);margin-bottom:20px}
    .detail-warn svg{flex:none}
    .detail-actions{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:24px}
    .detail-action{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-secondary);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s,color .15s;text-decoration:none}
    .detail-action:hover{background:var(--surface-2);border-color:var(--text-faint);color:var(--text)}
    .detail-action-icon{width:40px;height:40px;border-radius:10px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);transition:background .15s,color .15s}
    .detail-action:hover .detail-action-icon{background:var(--accent-soft);color:var(--accent)}
    .detail-action.danger{color:var(--danger)}
    .detail-action.danger:hover{background:var(--danger-soft);border-color:rgba(239,68,68,.3);color:var(--danger)}
    .detail-action.danger:hover .detail-action-icon{background:var(--danger-soft);color:var(--danger)}
    .detail-actions form{margin:0;display:contents}

    .detail-section-label{font-size:11px;font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
    .detail-preview{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
    .detail-preview-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)}
    .detail-preview-title{font-size:12px;font-weight:600;color:var(--text-secondary)}
    .detail-preview-toggle{font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;font-family:inherit;font-weight:500}
    .detail-preview-toggle:hover{text-decoration:underline}
    .detail-preview-code{padding:14px;overflow-x:auto;max-height:300px;overflow-y:auto;font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.65;color:var(--text-secondary);white-space:pre}
    .detail-preview-code::-webkit-scrollbar{width:4px;height:4px}
    .detail-preview-code::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

    .detail-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer;background:none;border:none;font-family:inherit;margin-bottom:16px;padding:6px 10px;border-radius:8px;transition:background .15s,color .15s}
    .detail-back:hover{background:var(--surface-2);color:var(--text)}

    /* ========== AUTH ========== */
    .auth-wrap{max-width:360px;width:100%;text-align:center}
    .auth-icon{width:42px;height:42px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
    .auth-title{font-size:17px;font-weight:600;letter-spacing:-.01em}
    .auth-sub{font-size:12.5px;color:var(--text-secondary);margin-top:4px;margin-bottom:18px}
    .auth-form{text-align:left}
    .auth-form .field{margin-bottom:14px}
    .auth-form .field>label{display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}
    .auth-form .btn-deploy{width:100%;padding:10px 14px;margin-top:4px}

    /* ========== CUSTOM TOOLTIP ========== */
    #appTip{position:fixed;z-index:120;max-width:280px;background:var(--text);color:var(--bg);border-radius:8px;padding:8px 11px;font-size:12px;line-height:1.5;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;box-shadow:var(--shadow-lg)}
    #appTip.show{opacity:1;transform:translateY(0)}
    #appTip .tip-title{font-weight:600;word-break:break-word}
    #appTip .tip-meta{font-size:11px;opacity:.75;margin-top:2px}

    /* ========== PRINT MODAL ========== */
    .modal{position:fixed;inset:0;z-index:100;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:16px}
    .modal-card{width:100%;max-width:400px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);padding:22px}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .modal-title{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--text)}
    .modal-close{background:none;border:none;color:var(--text-faint);cursor:pointer;padding:5px;border-radius:7px;display:flex}
    .modal-close:hover{color:var(--text);background:var(--surface-2)}
    .opt-group{margin-bottom:16px}
    .opt-cap{font-size:11.5px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}
    .opt-label{display:flex;align-items:center;gap:9px;font-size:13.5px;margin:9px 0;cursor:pointer;color:var(--text-secondary)}
    .opt-label input{width:15px;height:15px;margin:0;accent-color:var(--accent)}
    .modal-actions{display:flex;gap:10px;margin-top:20px}
    .modal-actions .btn{flex:1;justify-content:center}
    .seg{display:inline-flex;align-items:center;gap:2px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:3px}
    .seg-cols{background:transparent;border:none;border-radius:7px;padding:6px 14px;font-size:12.5px;font-weight:500;color:var(--text-secondary);cursor:pointer;font-family:inherit;transition:background .15s,color .15s}
    .seg-cols:hover{color:var(--text)}
    .seg-on{background:var(--bg);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.09)}
    .hidden{display:none!important}
    .flex{display:flex}

    /* ========== RESPONSIVE ========== */
    @media(max-width:1023px){
      .sidebar{position:fixed;top:0;left:0;height:100%;width:min(var(--sidebar-width),82vw);transform:translateX(-100%);transition:transform .25s ease}
      .sidebar.open{transform:translateX(0)}
      .sidebar.collapsed{width:min(var(--sidebar-width),82vw)}
      .sidebar.collapsed:not(.open){transform:translateX(-100%)}
      .sidebar-resizer{display:none}
      .sidebar-overlay.open{display:block}
      .app-layout{flex-direction:column}
      .hamburger{display:flex}
    }
    @media(max-width:480px){
      .empty-greeting{font-size:22px}
      .detail-actions{grid-template-columns:repeat(2,1fr)}
      .topbar-sub{display:none}
    }
    @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  </style>
  ${isAuth ? `<meta name="csrf-token" content="${authCsrf}">` : ''}
</head>
<body>
  ${!isAuth ? `
  <div class="app-layout">
    <div class="main" style="align-items:center;justify-content:center;padding:24px">
      <div class="auth-wrap">
        <div class="auth-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 class="auth-title">Login Diperlukan</h2>
        <p class="auth-sub">Masukkan master password untuk mengelola aplikasi.</p>
        <form method="POST" action="/api/login" class="auth-form">
          <input type="hidden" name="_csrf" value="${loginCsrf}">
          <div class="field">
            <label for="master-pw">Master Password</label>
            <input id="master-pw" class="form-input" type="password" name="password" required placeholder="••••••••" autocomplete="current-password">
          </div>
          <button type="submit" class="btn-deploy">Masuk</button>
        </form>
      </div>
    </div>
  </div>
  ` : `      <!-- Banner sekolah: bar penuh di atas semuanya, bisa disembunyikan -->
      <!-- Banner sekolah + ajakan PPDB 2027/2028; bisa disembunyikan -->
      <div class="brand-banner" id="brandBanner">
        <div class="brand-banner-brand">
          <span class="brand-banner-badge" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5"/></svg>
          </span>
          <div class="brand-banner-text">
            <span class="brand-banner-title">SMK Thibbil Qulub Assimbani</span>
            <span class="brand-banner-sub">Pengembangan Perangkat Lunak dan Gim</span>
          </div>
        </div>
        <a class="ppdb-cta" href="${ppdbUrl}" target="_blank" rel="noopener" title="Daftar PPDB 2027/2028 via WhatsApp">
          <span class="ppdb-chip"><span class="ppdb-dot"></span>PPDB 2027/2028</span>
          <span class="ppdb-btn"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg><span class="ppdb-btn-full">Daftar Sekarang</span><span class="ppdb-btn-short">Daftar</span></span>
        </a>
        <button type="button" class="brand-banner-hide" onclick="toggleBanner()" aria-label="Sembunyikan banner sekolah" title="Sembunyikan banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
      </div>

      <div class="app-layout">
    <!-- ===== SIDEBAR ===== -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a class="sidebar-brand" href="/">
          <span class="sidebar-logo">SQ</span>
          <span class="sidebar-title">Gemini Edge Deployer</span>
        </a>
      </div>

      <div class="sidebar-new">
        <button class="btn-new-deploy" onclick="showEmptyState();">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Deploy Baru
        </button>
      </div>

      <div class="sidebar-search">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Cari aplikasi..." oninput="filterApps(this.value)">
        </div>
      </div>

      <div class="sidebar-divider"></div>
      <div class="sidebar-label">Aplikasi</div>

      <div class="sidebar-list" id="appList">
        ${projects.map((p) => `
        <div class="sidebar-item" data-slug="${p.slug}" data-app-title="${escapeHtml(p.title)}" data-app-meta="${modData(p)}" onclick="showDetail(this,'${p.slug}')">
          <span class="sidebar-item-icon">
            ${p.type === 'json'
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'}
          </span>
          <span class="sidebar-item-text">${p.title}</span>
          <span class="sidebar-item-time">${relTime(p.created_at)}</span>
          <div class="sidebar-item-actions">
            <button class="sidebar-item-btn" title="Buka" onclick="event.stopPropagation(); window.open('/p/${p.slug}','_blank')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            <form method="POST" action="/api/delete" onsubmit="event.stopPropagation(); return confirm('Hapus aplikasi ini?')">
              <input type="hidden" name="_csrf" value="${authCsrf}">
              <input type="hidden" name="slug" value="${p.slug}">
              <button class="sidebar-item-btn danger" title="Hapus" onclick="event.stopPropagation()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </form>
          </div>
        </div>`).join('')}
      </div>

      <div class="sidebar-footer">
        <a href="${GEM_URL}" target="_blank" rel="noopener" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>
          Gem Gemini
        </a>
        <a href="/studio" class="sidebar-footer-btn" onclick="event.preventDefault(); showStudio();">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1z"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>
          Prompt Engine
        </a>
        <a href="/panduan" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>
          Panduan
        </a>
        <a href="/api/logout" class="sidebar-footer-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Keluar
        </a>
      </div>

      <div class="sidebar-resizer" id="sidebarResizer" title="Tarik untuk mengubah lebar"></div>
    </aside>

    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>

    <!-- ===== MAIN ===== -->
    <div class="main">
      <div class="main-topbar">
        <div class="topbar-left">
          <div class="topbar-toggle-slot">
            <!-- Desktop: toggle lipat/panggil sidebar, ikon berubah sesuai state -->
            <button type="button" class="topbar-toggle" onclick="toggleSidebar()" aria-label="Toggle sidebar" title="Toggle sidebar">
              <svg class="i-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><polyline points="14 9 17 12 14 15"/></svg>
              <svg class="i-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/><polyline points="10 9 7 12 10 15"/></svg>
            </button>
            <!-- Mobile: hamburger slide-in -->
            <button class="hamburger" onclick="toggleSidebar()" aria-label="Buka menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
          <div class="topbar-brand">
            <span class="topbar-logo">SQ</span>
            <span class="topbar-brand-text">
              <span class="topbar-title">Gemini Edge Deployer</span>
            </span>
          </div>
        </div>
        <!-- Tab switch home: taruh di kolom tengah topbar -->
        <div class="topbar-center">
          <div class="seg" id="homeTabs" role="tablist">
            <button type="button" class="seg-cols seg-on" data-hometab="deploy" onclick="setHomeTab('deploy')">Deploy Baru</button>
            <button type="button" class="seg-cols" data-hometab="studio" onclick="setHomeTab('studio')">Prompt Engine</button>
          </div>
        </div>
        <div class="topbar-actions">
          <button type="button" class="banner-show" onclick="toggleBanner()" aria-label="Tampilkan banner sekolah" title="Tampilkan banner sekolah">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <span class="detail-chip" style="display:${projects.length ? 'inline-block' : 'none'}">${projects.length} Aplikasi</span>
        </div>
      </div>

      <!-- VIEW: Home (tab Deploy Baru / Prompt Engine) -->
      <div id="viewHome">

      <!-- VIEW: Empty State -->
      <div class="main-content" id="viewEmpty">
        <div class="empty-state" style="margin:auto">
          <h1 class="empty-greeting">Dari mana kita harus mulai?</h1>
          <p class="empty-sub">Tempel output Gemini, lalu publikan ke URL langsung.</p>

          <!-- Chat input box (docked, bukan popup) -->
          <div class="chat-box" id="deployBox" style="text-align:left">
            <div class="chat-head">
              <span class="chat-head-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              </span>
              <div>
                <div class="chat-title" id="deployTitle">Deploy JSON Soal</div>
                <div class="chat-sub" id="deploySub">Tempel daftar soal dalam format JSON.</div>
              </div>
            </div>
            <form method="POST" action="/api/deploy">
              <input type="hidden" name="_csrf" value="${authCsrf}">
              <div class="form-row">
                <label class="form-label" for="deployTitleInput">Judul Aplikasi <span style="color:var(--text-faint);font-weight:400">(jadi alamat /p/...)</span></label>
                <input class="form-input" id="deployTitleInput" type="text" name="title" placeholder="Contoh: Kuis Akidah Akhlak Kelas 1">
              </div>
              <div class="form-row">
                <label class="form-label" for="deployCode">JSON Soal</label>
                <textarea class="form-input code" id="deployCode" name="code_content" rows="7" placeholder="Tempel JSON soal dari Gem di sini..." required></textarea>
              </div>
              <div class="form-actions">
                <button type="button" class="btn-cancel" onclick="resetForm()">Batal</button>
                <button type="submit" class="btn-deploy" id="deployBtn">Publikasikan ke URL</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- VIEW: Prompt Engine (tab, dimuat lazy via iframe) -->
      <div class="main-content studio-host" id="viewStudio" style="display:none">
        <iframe id="studioFrame" class="studio-frame" title="TKA Prompt Engine"></iframe>
      </div>
      </div>

      <!-- VIEW: App Detail -->
      <div class="main-content" id="viewDetail" style="justify-content:flex-start;padding-top:32px;display:none">
        <div class="detail-view active">
          <button class="detail-back" onclick="showDetailClose()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Kembali
          </button>

          <div class="detail-header">
            <h2 class="detail-title" id="detailTitle"></h2>
            <div class="detail-meta">
              <span class="detail-chip" id="detailType"></span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span id="detailSlug"></span>
              </span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span id="detailDate"></span>
              </span>
              <span class="detail-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span id="detailSize"></span>
              </span>
            </div>
          </div>

          <div class="detail-warn" id="detailWarn" style="display:none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span id="detailWarnText"></span>
          </div>

          <div class="detail-actions" id="detailActions"></div>

          <div class="detail-section-label">Pratinjau</div>
          <div class="detail-preview">
            <div class="detail-preview-header">
              <span class="detail-preview-title" id="previewFileName"></span>
              <button type="button" class="detail-preview-toggle" onclick="togglePreviewCode(this)">Sembunyikan</button>
            </div>
            <div class="detail-preview-code" id="previewCode"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `}

  ${isAuth ? `
  <!-- Custom tooltip untuk daftar aplikasi di sidebar -->
  <div id="appTip" role="tooltip" aria-hidden="true">
    <div class="tip-title"></div>
    <div class="tip-meta"></div>
  </div>

  <!-- Popup Ubah Judul & Alamat -->
  <div id="edit-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-head">
        <h3 class="modal-title">
          <span class="form-head-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>
          </span>
          Ubah Judul &amp; Alamat
        </h3>
        <button type="button" data-edit-close class="modal-close" aria-label="Tutup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form method="POST" action="/api/app/update" id="edit-form">
        <input type="hidden" name="_csrf" value="${authCsrf}">
        <input type="hidden" name="slug" id="edit-old-slug">
        <div class="opt-group">
          <label class="opt-cap" for="edit-title">Judul aplikasi</label>
          <input class="form-input" type="text" id="edit-title" name="title" placeholder="Judul aplikasi">
          <p class="opt-cap" style="margin-top:7px">Untuk kuis JSON Soal, judul ini juga mengganti judul di halaman siswa.</p>
        </div>
        <div class="opt-group">
          <label class="opt-cap" for="edit-new-slug">Alamat /p/...</label>
          <input class="form-input" type="text" id="edit-new-slug" name="new_slug" placeholder="slug-baru" style="font-family:'Geist Mono',ui-monospace,monospace">
          <p class="opt-cap" id="edit-note-legacy" style="display:none;margin-top:7px;color:var(--warn)">Aplikasi lama (HTML): judul yang diganti hanya mengubah label di dashboard, bukan judul di halaman siswa.</p>
          <p class="opt-cap" style="display:block;margin-top:7px;color:var(--warn)">Alamat lama langsung mati (tanpa redirect) setelah disimpan; media dan riwayat nilai ikut pindah ke alamat baru.</p>
        </div>
        <div class="modal-actions">
          <button type="button" data-edit-close class="btn btn-ghost">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Popup Cetak / Simpan PDF -->
  <div id="print-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-head">
        <h3 class="modal-title">
          <span class="form-head-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </span>
          Cetak / Simpan PDF
        </h3>
        <button type="button" data-modal-close class="modal-close" aria-label="Tutup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="opt-group">
        <p class="opt-cap">Isi dokumen</p>
        <label class="opt-label"><input type="radio" name="print-mode" value="soal" checked>Naskah soal</label>
        <label class="opt-label"><input type="radio" name="print-mode" value="kunci">Soal + kunci &amp; pembahasan</label>
      </div>
      <div class="opt-group">
        <p class="opt-cap">Tata letak</p>
        <div class="seg">
          <button type="button" data-layout="1col" class="seg-cols seg-on">1 Kolom</button>
          <button type="button" data-layout="2col" class="seg-cols">2 Kolom</button>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" data-modal-close class="btn btn-ghost">Batal</button>
        <button type="button" id="print-modal-go" class="btn btn-primary">Cetak / Simpan PDF</button>
      </div>
    </div>
  </div>
  <script>
  var APPDATA = ${appDataJson};
  var CSRF = ${JSON.stringify(authCsrf).replace(/</g, '\\u003c')};

  function toggleSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    var desktop = window.innerWidth >= 1024;
    if (desktop) {
      // Desktop: toggle = lipat sidebar (lebar jadi 0), overlay tidak dipakai.
      // Kelas sb-collapsed di <body> memunculkan hamburger di topbar supaya
      // sidebar selalu bisa dipanggil kembali.
      var collapsed = false;
      if (s) collapsed = s.classList.toggle('collapsed');
      document.body.classList.toggle('sb-collapsed', collapsed);
      try {
        localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
      } catch (e) {}
    } else {
      // Mobile/tablet: sidebar fixed, slide masuk/keluar + overlay.
      if (s) s.classList.toggle('open');
      if (o) o.classList.toggle('open');
    }
  }

  // ===== Banner sekolah: sembunyikan/tampilkan, state tersimpan. =====
  // Pilihan sembunyikan disimpan di localStorage supaya bertahan antar reload
  // DAN antar sesi. Banner baru tampil lagi setelah login berikutnya: login
  // sukses mengarahkan ke /?welcome=1, dan initBanner menghapus pilihan itu.
  function toggleBanner() {
    var hidden = document.body.classList.toggle('banner-hidden');
    try { localStorage.setItem('brand_banner_hidden', hidden ? '1' : '0'); } catch (e) {}
  }
  (function initBanner() {
    var params = null;
    var welcome = false;
    try {
      params = new URLSearchParams(window.location.search);
      welcome = params.has('welcome');
    } catch (e) {}
    try {
      if (welcome) {
        // Sesi login baru: mulai lagi dengan banner tampil.
        localStorage.removeItem('brand_banner_hidden');
      } else if (localStorage.getItem('brand_banner_hidden') === '1') {
        document.body.classList.add('banner-hidden');
      }
    } catch (e) {}
    if (welcome && params) {
      // Buang penanda dari URL supaya refresh tidak mengembalikan banner terus.
      params.delete('welcome');
      var rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
    }
  })();

  function setHomeTab(tab) {
    var deploy = document.getElementById('viewEmpty');
    var studio = document.getElementById('viewStudio');
    var frame = document.getElementById('studioFrame');
    var isDeploy = tab !== 'studio';
    if (deploy) deploy.style.display = isDeploy ? 'flex' : 'none';
    if (studio) studio.style.display = isDeploy ? 'none' : 'flex';
    if (frame && !isDeploy && !frame.getAttribute('src')) {
      // Lazy-load: /studio baru diambil saat tab Prompt Engine dibuka pertama kali.
      frame.setAttribute('src', '/studio');
    }
    document.querySelectorAll('#homeTabs [data-hometab]').forEach(function (b) {
      b.classList.toggle('seg-on', b.getAttribute('data-hometab') === tab);
    });
    try { localStorage.setItem('dashboard_home_tab', isDeploy ? 'deploy' : 'studio'); } catch (e) {}
  }

  function getSavedHomeTab() {
    try { return localStorage.getItem('dashboard_home_tab'); } catch (e) { return null; }
  }

  function showEmptyState() {
    var e = document.getElementById('viewEmpty');
    var d = document.getElementById('viewDetail');
    if (e) e.style.display = 'flex';
    if (d) d.style.display = 'none';
    setHomeTab('deploy');
    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
  }

  function showStudio() {
    var home = document.getElementById('viewHome');
    var detail = document.getElementById('viewDetail');
    if (home) home.style.display = 'flex';
    if (detail) detail.style.display = 'none';
    setHomeTab('studio');
    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
    if (window.innerWidth < 1024) toggleSidebar();
  }

  function showDetailClose() {
    var home = document.getElementById('viewHome');
    var detail = document.getElementById('viewDetail');
    if (home) home.style.display = 'flex';
    if (detail) detail.style.display = 'none';
    setHomeTab('deploy');
  }

  function showDetail(el, slug) {
    var home = document.getElementById('viewHome');
    var d = document.getElementById('viewDetail');
    if (home) home.style.display = 'none';
    if (d) d.style.display = 'flex';
    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
    if (el) el.classList.add('active');

    var app = APPDATA[slug];
    if (!app) return;

    document.getElementById('detailTitle').textContent = app.title;
    document.getElementById('detailType').textContent = app.type;
    document.getElementById('detailSlug').textContent = '/p/' + app.slug;
    document.getElementById('detailDate').textContent = app.date;
    document.getElementById('detailSize').textContent = app.size;

    var warn = document.getElementById('detailWarn');
    if (app.mediaMissing > 0) {
      warn.style.display = 'flex';
      document.getElementById('detailWarnText').textContent = app.mediaMissing + ' dari ' + app.mediaTotal + ' gambar soal belum diunggah';
    } else {
      warn.style.display = 'none';
    }

    document.getElementById('previewFileName').textContent = app.slug + '.' + app.type;
    document.getElementById('previewCode').textContent = app.preview;
    document.getElementById('previewCode').style.display = 'block';
    var toggler = document.querySelector('.detail-preview-toggle');
    if (toggler) toggler.textContent = 'Sembunyikan';

    var act = document.getElementById('detailActions');
    var icons = {
      open: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      tag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>',
      img: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      log: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      print: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
      del: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
    };
    function cell(inner) {
      return '<div class="detail-action-icon">' + inner + '</div>';
    }
    var html = '';
    html += '<a class="detail-action" href="/p/' + app.slug + '" target="_blank">' + cell(icons.open) + 'Buka App</a>';
    if (app.type === 'json') html += '<a class="detail-action" href="/p/' + app.slug + '/edit">' + cell(icons.edit) + 'Edit Soal</a>';
    html += '<a class="detail-action" href="/p/' + app.slug + '/media">' + cell(icons.img) + 'Atur Gambar</a>';
    html += '<a class="detail-action" href="/p/' + app.slug + '/data">' + cell(icons.log) + 'Log Data</a>';
    html += '<button type="button" class="detail-action" data-edit-btn="' + app.slug + '">' + cell(icons.tag) + 'Judul &amp; Slug</button>';
    if (app.type === 'json') html += '<button type="button" class="detail-action" data-print-btn="' + app.slug + '">' + cell(icons.print) + 'Cetak PDF</button>';
    html += '<form method="POST" action="/api/delete" onsubmit="return confirm(&quot;Hapus aplikasi ini?&quot;)"><input type="hidden" name="_csrf" value="' + CSRF + '"><input type="hidden" name="slug" value="' + app.slug + '"><button type="submit" class="detail-action danger">' + cell(icons.del) + 'Hapus</button></form>';
    act.innerHTML = html;

    if (window.innerWidth < 1024) toggleSidebar();
  }

  function togglePreviewCode(btn) {
    var code = document.getElementById('previewCode');
    if (code.style.display === 'none') {
      code.style.display = 'block';
      btn.textContent = 'Sembunyikan';
    } else {
      code.style.display = 'none';
      btn.textContent = 'Tampilkan';
    }
  }

  function filterApps(q) {
    var query = q.toLowerCase();
    document.querySelectorAll('.sidebar-item').forEach(function (item) {
      var text = item.querySelector('.sidebar-item-text').textContent.toLowerCase();
      item.style.display = text.indexOf(query) !== -1 ? '' : 'none';
    });
  }

  function resetForm() {
    var form = document.querySelector('#deployBox form');
    if (form) form.reset();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var sb = document.getElementById('sidebar');
      var ov = document.getElementById('sidebarOverlay');
      if (sb && sb.classList.contains('open') && window.innerWidth < 1024) toggleSidebar();
      else if (ov && ov.classList.contains('open')) toggleSidebar();
      hideAppTip();
    }
  });

  // ===== Resize sidebar (desktop): tarik tepi kanan sidebar, lebar tersimpan. =====
  (function initSidebarResize() {
    var sb = document.getElementById('sidebar');
    var handle = document.getElementById('sidebarResizer');
    if (!sb || !handle) return;
    var MIN = 200, MAX = 420;
    var startX = 0, startW = 0, dragging = false;
    function applyWidth(w) {
      w = Math.max(MIN, Math.min(MAX, Math.round(w)));
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
      return w;
    }
    handle.addEventListener('pointerdown', function (e) {
      if (window.innerWidth < 1024 || sb.classList.contains('collapsed')) return;
      dragging = true;
      startX = e.clientX;
      startW = sb.getBoundingClientRect().width;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      applyWidth(startW + (e.clientX - startX));
    });
    function stopDrag(e) {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
        if (w) localStorage.setItem('sidebar_width', String(w));
      } catch (err) {}
    }
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);

    // Pulihkan lebar & state collapsed tersimpan saat load (desktop saja).
    if (window.innerWidth >= 1024) {
      try {
        var w = parseInt(localStorage.getItem('sidebar_width'), 10);
        if (w) applyWidth(w);
        if (localStorage.getItem('sidebar_collapsed') === '1') {
          sb.classList.add('collapsed');
          document.body.classList.add('sb-collapsed');
        }
      } catch (err) {}
    }
  })();

  // ===== Custom tooltip daftar aplikasi (pengganti title native). =====
  var appTip = document.getElementById('appTip');
  var appTipTimer = null;
  function hideAppTip() {
    if (appTipTimer) { clearTimeout(appTipTimer); appTipTimer = null; }
    if (appTip) appTip.classList.remove('show');
  }
  function showAppTipFor(item) {
    if (!appTip) return;
    var title = item.getAttribute('data-app-title') || '';
    var meta = item.getAttribute('data-app-meta') || '';
    if (!title && !meta) return;
    appTip.querySelector('.tip-title').textContent = title;
    var metaEl = appTip.querySelector('.tip-meta');
    metaEl.textContent = meta;
    metaEl.style.display = meta ? '' : 'none';
    appTip.classList.add('show');
    appTip.setAttribute('aria-hidden', 'false');
    // Posisi dihitung setelah muncul supaya ukurannya sudah final.
    var r = item.getBoundingClientRect();
    var tw = appTip.offsetWidth, th = appTip.offsetHeight;
    var left = Math.min(r.right + 10, window.innerWidth - tw - 8);
    var top = r.top + r.height / 2 - th / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
    appTip.style.left = left + 'px';
    appTip.style.top = top + 'px';
  }
  (function initAppTooltip() {
    var list = document.getElementById('appList');
    if (!list || !appTip) return;
    list.addEventListener('mouseover', function (e) {
      var item = e.target.closest('.sidebar-item');
      if (!item || item === appTip.dataset.current) return;
      appTip.dataset.current = item;
      if (appTipTimer) clearTimeout(appTipTimer);
      appTipTimer = setTimeout(function () { showAppTipFor(item); }, 250);
    });
    list.addEventListener('mouseout', function (e) {
      var item = e.target.closest('.sidebar-item');
      if (!item) return;
      var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.sidebar-item') : null;
      if (to === item) return;
      appTip.dataset.current = '';
      hideAppTip();
    });
    list.addEventListener('click', hideAppTip);
    window.addEventListener('scroll', hideAppTip, true);
  })();

  // Print modal (delegated, works with dynamically-added buttons)
  var printModal = document.getElementById('print-modal');
  function setPrintOpen(open) {
    printModal.classList.add('hidden');
    printModal.classList.remove('flex');
    if (open) {
      printModal.classList.remove('hidden');
      printModal.classList.add('flex');
    }
  }
  if (printModal) {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-print-btn]');
      if (b) {
        printModal.dataset.slug = b.getAttribute('data-print-btn');
        setPrintOpen(true);
      }
    });
    printModal.querySelectorAll('[data-layout]').forEach(function (b) {
      b.addEventListener('click', function () {
        printModal.querySelectorAll('[data-layout]').forEach(function (x) { x.classList.toggle('seg-on', x === b); });
      });
    });
    printModal.addEventListener('click', function (e) { if (e.target === printModal) setPrintOpen(false); });
    document.querySelectorAll('[data-modal-close]').forEach(function (b) { b.addEventListener('click', function () { setPrintOpen(false); }); });
    document.getElementById('print-modal-go').addEventListener('click', function () {
      if (!printModal.dataset.slug) return;
      var mode = printModal.querySelector('input[name="print-mode"]:checked').value;
      var layout = (printModal.querySelector('[data-layout].seg-on') || {
        getAttribute: function () { return '1col'; }
      }).getAttribute('data-layout');
      var q = '/p/' + printModal.dataset.slug + '?print=1' + (mode === 'kunci' ? '&kunci=1' : '');
      if (layout === '2col') q += '&layout=2col';
      q += '&auto=1';
      window.open(q, '_blank');
    });
  }

  // Modal Ubah Judul & Alamat (delegated, works with dynamically-added buttons)
  var editModal = document.getElementById('edit-modal');
  if (editModal) {
    function setEditOpen(open) {
      editModal.classList.add('hidden');
      editModal.classList.remove('flex');
      if (open) {
        editModal.classList.remove('hidden');
        editModal.classList.add('flex');
      }
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit-btn]');
      if (b) {
        var slug = b.getAttribute('data-edit-btn');
        var app = APPDATA[slug];
        if (!app) return;
        document.getElementById('edit-old-slug').value = slug;
        document.getElementById('edit-title').value = app.title || '';
        document.getElementById('edit-new-slug').value = app.slug || '';
        var legacyNote = document.getElementById('edit-note-legacy');
        if (legacyNote) legacyNote.style.display = app.type === 'json' ? 'none' : 'block';
        setEditOpen(true);
      }
    });
    editModal.querySelectorAll('[data-edit-close]').forEach(function (b) {
      b.addEventListener('click', function () { setEditOpen(false); });
    });
    editModal.addEventListener('click', function (e) { if (e.target === editModal) setEditOpen(false); });
    var editForm = document.getElementById('edit-form');
    if (editForm) {
      editForm.addEventListener('submit', function () {
        var slugged = editForm.querySelector('input[name="new_slug"]');
        if (slugged) slugged.value = slugged.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      });
    }
  }

  // Deep-link: /?app=<slug> langsung membuka panel detail aplikasi itu.
  // Dipakai /api/deploy setelah publish supaya guru langsung melihat alamat
  // publik yang baru dan tidak salah share alamat lamanya ke siswa. Query-nya
  // lalu dibuang supaya refresh tidak memaksa panel yang sama terbuka lagi.
  // Tanpa deep-link, tab home yang terakhir aktif dipulihkan dari localStorage
  // supaya reload tetap di tab yang sama (mis. Prompt Engine beserta state-nya).
  (function openAppFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var want = params.get('app');
    if (want && APPDATA[want]) {
      var item = null;
      document.querySelectorAll('.sidebar-item').forEach(function (el) {
        if (!item && el.getAttribute('data-slug') === want) item = el;
      });
      showDetail(item, want);
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    var saved = getSavedHomeTab();
    if (saved === 'studio') setHomeTab('studio');
  })();
  </script>` : ''}
</body>
</html>`);
});
}
