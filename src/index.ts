import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { registerMediaRoutes } from './media-routes';
import { registerQuizEditorRoutes } from './quiz-editor';
import { registerEssayGradingRoutes } from './quiz-essay';
import { registerGuideRoute } from './guide';
import { registerTkaStudioRoutes } from './tka-studio';
import { registerPublicAppRoute } from './public-app';
import { registerRecordRoutes } from './records';
import { registerAuthRoutes } from './auth-routes';
import { registerDashboardRoutes } from './dashboard';
import { registerActionRoutes } from './actions';

type Bindings = {
  STORAGE: KVNamespace;
  DB: D1Database;
  // Opsional: bucket R2 untuk gambar hasil unggahan guru. Kalau binding ini
  // tidak dipasang, gambarnya otomatis disimpan di KV (STORAGE) — tetap jalan.
  MEDIA?: R2Bucket;
  // Opsional: API generate gambar AI (proxy free-image-generation-api di atas
  // Cloudflare Workers AI). Kalau keduanya diisi, panel Gambar dapat tombol
  // "Generate AI" untuk membuat gambar slot langsung dari prompt.
  IMGGEN_API_URL?: string;
  IMGGEN_API_KEY?: string;
  // Opsional (publik, bukan secret): nomor WhatsApp panitia PPDB, format
  // internasional tanpa "+" (mis. 6281234567890). Kalau diisi, banner
  // dashboard menampilkan tombol "Daftar Sekarang" untuk PPDB 2027/2028.
  PPDB_WHATSAPP?: string;
  // Wajib sejak hardening auth: kalau kosong, login admin menolak boot dengan
  // halaman instruksi (503), BUKAN memakai password bawaan.
  APP_PASSWORD?: string;
  // Wajib: kunci HMAC untuk cookie sesi admin dan token CSRF. Kalau kosong,
  // semua sesi tidak bisa diverifikasi dan login ditolak (503).
  SESSION_SECRET?: string;
  // Opsional: allowlist origin (dipisah koma) untuk CORS endpoint admin.
  // Kosong = tidak ada header Access-Control-Allow-Origin sama sekali.
  ALLOWED_ORIGINS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

/* --------------------------------------------------------------------------
 * CORS dua lapis (T5):
 *  - Endpoint publik siswa (/api/save, /api/submit, /media) tetap origin '*'
 *    tanpa kredensial — halaman kuis tidak memakai cookie.
 *  - Endpoint admin: allowlist dari ALLOWED_ORIGINS (dipisah koma). Default
 *    kosong berarti TANPA header Access-Control-Allow-Origin sama sekali.
 *    Header X-CSRF-Token wajib ada di Allow-Headers supaya jalur fetch tidak
 *    gagal saat preflight.
 * ------------------------------------------------------------------------ */
app.use('/api/save/*', cors({ origin: '*', credentials: false }));
app.use('/api/submit/*', cors({ origin: '*', credentials: false }));
app.use('/media/*', cors({ origin: '*', credentials: false }));
app.use('/studio/*', adminCors); // halaman HTML — hanya OPTIONS/prefetch lintas domain yang perlu ditolak
app.use('/api/*', adminCors);

async function adminCors(c: Context<{ Bindings: Bindings }>, next: () => Promise<void>): Promise<Response | void> {
  if (c.req.method === 'OPTIONS') {
    const origin = c.req.header('Origin');
    const allowed = adminOriginAllowed(c.env.ALLOWED_ORIGINS, origin);
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin as string);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      c.header('Access-Control-Max-Age', '600');
    }
    return c.body(null, 204);
  }
  await next();
  // Header hanya dipasang untuk origin yang terdaftar; selain itu tidak ada
  // Access-Control-Allow-Origin sama sekali, jadi browser menolak membacanya.
  const origin = c.req.header('Origin');
  if (origin && adminOriginAllowed(c.env.ALLOWED_ORIGINS, origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
}

function adminOriginAllowed(allowlist: string | undefined, origin: string | undefined): boolean {
  if (!origin || !allowlist) return false;
  return allowlist
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin);
}

// Unggah/sajikan gambar soal + panel guru di /p/:slug/media
registerMediaRoutes(app);

// Editor soal guru di /p/:slug/edit (khusus aplikasi mode "JSON Soal")
registerQuizEditorRoutes(app);

// Koreksi jawaban esai di /p/:slug/essay
registerEssayGradingRoutes(app);

// Panduan penggunaan di /panduan
registerGuideRoute(app);

// TKA Prompt Engine di /studio (generator prompt asesmen/TKA + kelola mapel)
registerTkaStudioRoutes(app);

// Halaman publik aplikasi siswa di /p/:slug (termasuk mode cetak)
registerPublicAppRoute(app);

// Simpan kiriman siswa + halaman rekap admin di /p/:slug/data
registerRecordRoutes(app);

// Login/logout admin (rate limit fail-closed)
registerAuthRoutes(app);

// Dashboard admin di /
registerDashboardRoutes(app);

// Aksi admin: publish, hapus, ubah judul/slug
registerActionRoutes(app);

export default app;
