/* ==========================================================================
 * TKA Prompt Engine (/studio) — port dari tka-studio-prompt.php ke Worker.
 * --------------------------------------------------------------------------
 * Menyusun prompt asesmen (Sumatif / TKA-AKM / Spesifik) dari template + matriks
 * mata pelajaran, plus kelola template dan mapel. Dulu berbasis PHP + SQLite;
 * di sini datanya disimpan di KV melalui binding STORAGE supaya tidak perlu
 * server PHP terpisah.
 *
 * Tampilan memakai design system yang sama dengan halaman guru lain (Geist,
 * variabel warna --bg/--surface/--accent, dan dark mode lewat
 * prefers-color-scheme) supaya serasa satu aplikasi.
 *
 * Kunci KV:
 *   tka:templates  -> array Template
 *   tka:subjects   -> array Mapel
 * Template bawaan di-seed otomatis saat pertama kali halaman dibuka.
 * ========================================================================== */

import type { Hono } from 'hono';
// Impor memakai ekstensi .ts supaya modul ini juga bisa dijalankan langsung
// oleh Node (mis. smoke test), seperti di media-gen.ts.
import { csrfFor, getSession, verifyCsrfFromRequest } from './auth.ts';
import { GEM_URL } from './guide';
import { FAVICON_TAGS } from './favicon.ts';
import type { Context } from 'hono';

type TkaBindings = { STORAGE: KVNamespace; SESSION_SECRET?: string };

export type TkaTemplate = { id: number; nama: string; tipe: string; template: string };

export type TkaSubject = {
  id: number;
  nama: string;
  jenjang: string;
  kelompok: string;
  muatan: string;
  kompetensi: string;
  /** Disimpan sebagai string JSON supaya klien bisa membaca/menulis seperti di PHP. */
  matriks_json: string;
};

const TEMPLATES_KEY = 'tka:templates';
const SUBJECTS_KEY = 'tka:subjects';

function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------------ */
/* Template bawaan (sama seperti seeder di versi PHP)                        */
/* ------------------------------------------------------------------------ */

const DEFAULT_TEMPLATES: Array<Omit<TkaTemplate, 'id'>> = [
  {
    nama: 'Asesmen Sumatif Lengkap (Kurikulum Merdeka)',
    tipe: 'sumatif',
    template: `Buatkan Paket Naskah Soal {JENIS_ASESMEN} ({SEMESTER}) Tahun Ajaran {TAHUN_AJARAN} mata pelajaran {MAPEL} untuk jenjang {JENJANG} Kelas {KELAS} (Fase {FASE}).
{INSTANSI}
{JURUSAN}
Jumlah: {TOTAL_SOAL} Soal.

Kriteria dan Standar Asesmen:
1. Mengukur ketercapaian Tujuan Pembelajaran (TP) pada Capaian Pembelajaran Kurikulum Merdeka Fase {FASE}.
2. Stimulus berbasis masalah kontekstual autentik terkini, memuat analisis literasi/numerasi sesuai tingkat kognitif siswa {JENJANG} Kelas {KELAS}, disertai stimulus visual (narasi stimulus/data/tabel/infografis/diagram).
3. Setiap butir soal wajib memuat:
   - Nomor Soal & Target Elemen / Indikator Ketercapaian TP
   - Level Kognitif & Bentuk Soal
   - Teks Stimulus Kontekstual
   - Pertanyaan dan Opsi Jawaban ({OPSI_PG})
   - Kunci Jawaban beserta Rubrik/Pembahasan Lengkap

Ketentuan Komposisi Bentuk Soal:
{DISTRIBUSI_BENTUK}

Ketentuan Komposisi Level Kognitif:
{DISTRIBUSI_KOGNITIF}

Acuan Materi dan Kisi-kisi:
Susun seluruh butir soal merata mengacu pada Matriks/Lingkup Materi resmi berikut:
{TABEL_MATRIKS}`,
  },
  {
    nama: 'Paket Lengkap TKA Terstandar Nasional (Full Matriks)',
    tipe: 'tka_full',
    template: `Buatkan Paket Soal Tes Kemampuan Akademik (TKA) Terstandar Tahun {TAHUN_AJARAN} mata pelajaran {MAPEL} untuk jenjang {JENJANG}.
{INSTANSI}
{JURUSAN}
Jumlah: {TOTAL_SOAL} Soal.

Kriteria dan Standar Soal:
1. Mengacu pada "Panduan Penulisan Soal Tes Terstandar berbasis AKM (Asesmen Kompetensi Minimum)".
2. Stimulus berbasis studi kasus terkini dan relevan dengan dunia nyata/kejuruan, memuat analisis literasi bacaan atau numerasi terapan, disertai deskripsi visual yang jelas.
3. Setiap butir soal wajib menyertakan:
   - Nomor Soal & Target Elemen Matriks
   - Level Kognitif & Bentuk Soal
   - Teks Stimulus Kontekstual
   - Pertanyaan dan Pilihan Jawaban ({OPSI_PG})
   - Kunci Jawaban beserta Penjelasan/Pembahasan Ilmiah

Ketentuan Komposisi Bentuk Soal:
{DISTRIBUSI_BENTUK}

Ketentuan Komposisi Level Kognitif:
{DISTRIBUSI_KOGNITIF}

Acuan Indikator Matriks TKA:
{TABEL_MATRIKS}`,
  },
  {
    nama: 'Pilihan Ganda Kompleks (Sesuai / Tidak Sesuai)',
    tipe: 'specific',
    template:
      'Berdasarkan referensi asesmen mata pelajaran {MAPEL} jenjang {JENJANG}. {INSTANSI} {JURUSAN} Buatkan {JUMLAH} butir soal yang memuat materi {MUATAN}. Soal bertujuan menguji kompetensi {KOMPETENSI} khususnya subkompetensi {SUB_KOMPETENSI}. Buatkan dalam bentuk soal pilihan ganda kompleks yang meliputi stimulus kontekstual, tabel pernyataan dengan opsi sesuai dan tidak sesuai, serta kunci jawaban dan pembahasannya.',
  },
  {
    nama: 'Pilihan Ganda Sederhana',
    tipe: 'specific',
    template:
      'Berdasarkan referensi asesmen mata pelajaran {MAPEL} jenjang {JENJANG}. {INSTANSI} {JURUSAN} Buatkan {JUMLAH} butir soal yang memuat materi {MUATAN}. Soal bertujuan menguji kompetensi {KOMPETENSI}, khususnya subkompetensi {SUB_KOMPETENSI}. Buatkan dalam bentuk pilihan ganda dengan format {OPSI_PG}, disertai stimulus masalah nyata, kunci jawaban, dan pembahasan.',
  },
];

/* ------------------------------------------------------------------------ */
/* Baca / simpan dari KV                                                     */
/* ------------------------------------------------------------------------ */

function parseArray<T>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

async function loadTemplates(kv: KVNamespace): Promise<TkaTemplate[]> {
  const stored = parseArray<TkaTemplate>(await kv.get(TEMPLATES_KEY));
  if (stored) return stored;
  const seeded = DEFAULT_TEMPLATES.map((t, i) => ({ id: i + 1, ...t }));
  await kv.put(TEMPLATES_KEY, JSON.stringify(seeded));
  return seeded;
}

async function loadSubjects(kv: KVNamespace): Promise<TkaSubject[]> {
  const stored = parseArray<TkaSubject>(await kv.get(SUBJECTS_KEY));
  if (stored) return stored;
  await kv.put(SUBJECTS_KEY, JSON.stringify([]));
  return [];
}

function nextId(list: Array<{ id: number }>): number {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

/** Tebak jenjang dari nama mapel saat impor tidak menyertakan jenjang eksplisit. */
function guessJenjang(nama: string): string {
  const upper = nama.toUpperCase();
  if (upper.includes('SMK')) return 'SMK';
  if (upper.includes('SMA')) return 'SMA';
  if (upper.includes('SMP')) return 'SMP';
  if (upper.includes('SD')) return 'SD';
  return 'SEMUA';
}

/**
 * Rangkum elemen/muatan dan kompetensi dari tabel matriks sebagai cadangan saat
 * field deskriptif mapel kosong (mis. halaman SMP/SD yang memuat teksnya di
 * "definisi" dan hanya berisi tabel matriks). Sama aturan pemetaan kolomnya
 * dengan tka-studio.js (elemen vs subkompetensi), biar hasilnya konsisten.
 */
function deriveSubjectSummary(matriks: unknown): { muatan: string; kompetensi: string } {
  const rows = (matriks as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) return { muatan: '', kompetensi: '' };

  const seenElemen = new Set<string>();
  const seenKompetensi = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    let elemen = '';
    let subElemen = '';
    let kompetensi = '';
    let subKompetensi = '';
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      const clean = key
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      const val = String(value ?? '').trim();
      if (clean.includes('subkompetensi')) subKompetensi = val;
      else if (clean.includes('kompetensi')) kompetensi = val;
      else if (clean.includes('subelemen') || clean.includes('submateri')) subElemen = val;
      else if (clean.includes('elemen') || clean.includes('materi')) elemen = val;
    }
    const elemenName = (elemen || subElemen).split(';')[0].trim();
    if (elemenName) seenElemen.add(elemenName);
    const kompetensiName = (kompetensi || subKompetensi).split(';')[0].trim();
    if (kompetensiName) seenKompetensi.add(kompetensiName);
  }
  return { muatan: [...seenElemen].join('; '), kompetensi: [...seenKompetensi].join('; ') };
}

/* ------------------------------------------------------------------------ */
/* Halaman                                                                   */
/* ------------------------------------------------------------------------ */

type StudioData = {
  templates: TkaTemplate[];
  subjects: TkaSubject[];
  tab: string;
  message: string;
  ok: boolean;
  // Token CSRF sesi admin — dipasang ke <meta> dan ke kelima form POST (T4).
  csrf: string;
};

function renderStudioPage(data: StudioData): string {
  const { templates, subjects, tab, message, ok, csrf } = data;

  const templateOptions = templates
    .map((t) => `<option value="${t.id}" data-type="${escapeHtml(t.tipe)}">${escapeHtml(t.nama)}</option>`)
    .join('');

  const templateRows = templates
    .map(
      (t) => `
        <tr>
          <td><b>${escapeHtml(t.nama)}</b></td>
          <td><span class="pill ${t.tipe === 'sumatif' ? 'ok' : t.tipe === 'tka_full' ? 'accent' : 'muted'}">${escapeHtml(t.tipe.toUpperCase())}</span></td>
          <td class="mono ellip" title="${escapeHtml(t.template)}">${escapeHtml(t.template)}</td>
          <td class="ta-right nowrap">
            <button type="button" class="btn btn-sm" onclick="editModalById(${t.id})"><i class="fa-solid fa-pen"></i>Edit</button>
            <form method="POST" action="/studio/template" class="inline" onsubmit="return confirm('Hapus template ini?')">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="action" value="delete_template">
              <input type="hidden" name="template_id" value="${t.id}">
              <button type="submit" class="btn btn-sm btn-danger"><i class="fa-solid fa-trash"></i>Hapus</button>
            </form>
          </td>
        </tr>`
    )
    .join('');

  const subjectRows = subjects
    .map(
      (s) => `
        <tr class="subject-row" data-name="${escapeHtml(s.nama.toLowerCase())}">
          <td><b>${escapeHtml(s.nama)}</b></td>
          <td><span class="pill muted">${escapeHtml(s.jenjang)}</span></td>
          <td class="ellip" title="${escapeHtml(s.muatan)}">${escapeHtml(s.muatan.slice(0, 60))}</td>
          <td class="ellip" title="${escapeHtml(s.kompetensi)}">${escapeHtml(s.kompetensi.slice(0, 60))}</td>
          <td class="ta-right nowrap">
            <button type="button" class="btn btn-sm" onclick="editSubjectModalById(${s.id})"><i class="fa-solid fa-pen"></i>Edit</button>
            <form method="POST" action="/studio/subject" class="inline" onsubmit="return confirm('Yakin ingin menghapus mapel ini?')">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="action" value="delete_subject">
              <input type="hidden" name="subject_id" value="${s.id}">
              <button type="submit" class="btn btn-sm btn-danger"><i class="fa-solid fa-trash"></i>Hapus</button>
            </form>
          </td>
        </tr>`
    )
    .join('');

  const embedded = JSON.stringify({ templates, subjects, tab }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="${csrf}">
  <title>TKA Prompt Engine - Gemini Edge Deployer</title>
  ${FAVICON_TAGS}
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geist-variable.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url('/vendor/fonts/geistmono-variable.woff2') format('woff2')}
    :root{
      --bg:#ffffff;--surface:#f9f9f9;--surface-2:#f0f0f0;
      --border:#e5e5e5;--text:#171717;--text-secondary:#737373;--text-faint:#a3a3a3;
      --accent:#7c3aed;--accent-hover:#6d28d9;--accent-soft:rgba(124,58,237,.08);
      --danger:#ef4444;--danger-soft:rgba(239,68,68,.08);--ok:#16a34a;--ok-soft:rgba(22,163,74,.1);--warn:#d97706;--warn-soft:rgba(217,119,6,.1);
      --radius:14px;--radius-sm:10px;--shadow:0 1px 3px rgba(0,0,0,.06);--shadow-lg:0 8px 32px rgba(0,0,0,.1);
    }
    @media(prefers-color-scheme:dark){
      :root{
        --bg:#212121;--surface:#303030;--surface-2:#3a3a3a;
        --border:#424242;--text:#ececec;--text-secondary:#9e9e9e;--text-faint:#6b6b6b;
        --accent:#8b5cf6;--accent-hover:#a78bfa;--accent-soft:rgba(139,92,246,.12);
        --danger:#f87171;--danger-soft:rgba(248,113,113,.12);--ok:#4ade80;--ok-soft:rgba(74,222,128,.12);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.12);
        --shadow:0 1px 3px rgba(0,0,0,.25);--shadow-lg:0 8px 32px rgba(0,0,0,.4);
      }
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;padding-bottom:32px}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit;cursor:pointer}
    input,textarea,select,button{font-family:inherit;color:var(--text)}
    .hidden{display:none!important}
    .mono{font-family:'Geist Mono',ui-monospace,monospace}
    .ta-right{text-align:right}
    .nowrap{white-space:nowrap}

    .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;white-space:nowrap}
    .btn:hover{background:var(--surface-2)}
    .btn-accent{background:var(--accent);border-color:transparent;color:#fff}
    .btn-accent:hover{background:var(--accent-hover)}
    .btn-sm{padding:5px 10px;font-size:11.5px}
    .btn-danger{color:var(--danger);background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
    .btn-danger:hover{background:var(--danger);color:#fff}

    /* Halaman ini selalu hidup di iframe dashboard yang punya topbar kaca
       melayang (tinggi 52px) di atasnya. Konten diturunkan melewatinya; saat
       scroll, konten melewati belakang kaca itu. Bar tab sendiri dibuat
       sticky translucent supaya tab tetap terlihat dan konten melewatinya
       juga — nuansa "layered glass" dua lapis. Di luar iframe (buka langsung
       /studio) padding-top kecil cukup karena tidak ada topbar melayang. */
    main{max-width:1400px;margin:0 auto;padding:72px 20px 20px;display:flex;flex-direction:column;gap:16px}
    body.embedded main{padding-top:72px}

    .tabs{position:sticky;top:8px;z-index:20;display:flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--surface-2) 72%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);border:1px solid color-mix(in srgb,var(--border) 60%,transparent);border-radius:12px;padding:4px;width:fit-content;max-width:100%;flex-wrap:wrap;box-shadow:0 4px 18px -8px rgba(0,0,0,.35),inset 0 1px 0 color-mix(in srgb,#fff 12%,transparent)}
    .tab{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--text-secondary);border-radius:7px;padding:6px 12px;font-size:12.5px;font-weight:500;white-space:nowrap;transition:background .15s,color .15s}
    .tab:hover{color:var(--text)}
    .tab.active{background:var(--bg);color:var(--text);box-shadow:var(--shadow)}
    .tab.active i{color:var(--accent)}

    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;box-shadow:var(--shadow)}
    .card-label{font-size:13px;font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:8px}
    .card-label .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}
    .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    .card-actions{display:flex;align-items:center;gap:8px;flex:none}
    .card-title{font-size:14px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}
    .card-title i{color:var(--accent)}
    .card-text{font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin:0}
    .card-text code{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;color:var(--accent);background:var(--accent-soft);padding:1px 5px;border-radius:5px}

    .studio-grid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
    @media(min-width:1000px){.studio-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}}
    .stack{display:flex;flex-direction:column;gap:14px}
    .stack-sm{display:flex;flex-direction:column;gap:10px}
    .row{display:grid;grid-template-columns:1fr;gap:12px}
    @media(min-width:560px){.row.two{grid-template-columns:1fr 1fr}.row.three{grid-template-columns:repeat(3,1fr)}.row.four{grid-template-columns:repeat(4,1fr)}}
    .row .field{margin-bottom:0}

    .field{margin-bottom:14px}
    .field:last-child{margin-bottom:0}
    .field label{display:block;font-size:12px;font-weight:500;margin-bottom:6px;color:var(--text-secondary)}
    .field .note{font-size:11px;color:var(--text-faint);margin:5px 0 0}
    .input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);outline:none;transition:border-color .15s}
    .input:focus{border-color:var(--accent)}
    textarea.input{resize:vertical;line-height:1.6}
    input.input-mono,textarea.input-mono{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px}

    .seg{display:flex;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:4px}
    .seg-btn{flex:1;min-width:0;border:none;background:transparent;color:var(--text-secondary);border-radius:7px;padding:7px 8px;font-size:12px;font-weight:600;white-space:nowrap;transition:background .15s,color .15s}
    .seg-btn:hover{color:var(--text)}
    .seg-btn.active{background:var(--bg);color:var(--accent);box-shadow:var(--shadow)}
    .seg.tiny{flex:none}
    .seg.tiny .seg-btn{flex:none;font-size:11px;padding:5px 10px}

    .box{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:12px}
    .box.accent{border-color:color-mix(in srgb,var(--accent) 28%,transparent);background:var(--accent-soft)}
    .box-label{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary)}
    .stat-badge{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);white-space:nowrap}
    .stat-badge.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
    .stat-badge.bad{color:var(--danger);background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}

    .checklist{max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px}
    .check-row{display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;padding:3px 4px;border-radius:6px;line-height:1.5}
    .check-row:hover{background:var(--surface-2)}
    .check-row input{accent-color:var(--accent);margin-top:3px;flex:none}
    .preview-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-secondary)}
    .preview-list b{color:var(--text)}

    #output-text{width:100%;flex:1;min-height:340px;resize:none;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;line-height:1.65;color:var(--text-secondary);outline:none;transition:border-color .15s}
    #output-text:focus{border-color:var(--accent)}
    .output-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--text-faint)}
    .toast{color:var(--ok);font-weight:600;opacity:0;transition:opacity .2s}
    .toast.show{opacity:1}

    .table-wrap{overflow-x:auto;max-height:560px}
    .table{width:100%;border-collapse:collapse;font-size:12.5px}
    .table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:1}
    .table td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
    .table tr:last-child td{border-bottom:none}
    .table .ellip{max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .table td.mono{font-size:11px;color:var(--text-secondary)}
    .empty-row td{text-align:center;color:var(--text-faint);padding:32px 10px!important}

    .pill{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid transparent}
    .pill.accent{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 30%,transparent)}
    .pill.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
    .pill.muted{color:var(--text-secondary);background:var(--surface-2);border-color:var(--border)}

    .flash{display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:var(--radius-sm);padding:12px 14px;font-size:12.5px;font-weight:500;border:1px solid}
    .flash.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}
    .flash.err{color:var(--danger);background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
    .flash button{border:none;background:transparent;color:inherit;font-size:13px;opacity:.7;padding:0 4px}

    .chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
    .chip{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;font-weight:600;padding:3px 7px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary);cursor:pointer;transition:border-color .15s,color .15s}
    .chip:hover{border-color:var(--accent);color:var(--accent)}

    .help-card{background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:var(--radius-sm);padding:12px 14px;font-size:12px;color:var(--text-secondary);line-height:1.6}
    .help-card b{color:var(--text)}

    .modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px}
    .modal-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column}
    .modal-card.wide{max-width:720px}
    .modal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}
    .modal-head h3{margin:0;font-size:13.5px;font-weight:600}
    .modal-body{padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
    .modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}
    .x-btn{border:none;background:transparent;color:var(--text-faint);font-size:14px;padding:4px 8px;border-radius:6px}
    .x-btn:hover{background:var(--surface-2);color:var(--text)}
  </style>
</head>
<body>

  <!-- Topbar (SQ, judul, tombol Panduan) dihapus total: halaman ini selalu
       dibuka di dalam iframe dashboard yang sudah punya topbar sendiri, jadi
       nav-nya cuma dobel dan memakan tinggi layar. Konten naik langsung ke
       <main> yang tetap max-width 1400px dan terpusat. -->

  <main>
    <div class="tabs" role="tablist">
      <button type="button" class="tab active" id="btn-tab-generator" onclick="switchTab('generator')"><i class="fa-solid fa-bolt"></i>Generator</button>
      <button type="button" class="tab" id="btn-tab-mapel" onclick="switchTab('mapel')"><i class="fa-solid fa-book-open"></i>Kelola Mapel (${subjects.length})</button>
      <button type="button" class="tab" id="btn-tab-admin" onclick="switchTab('admin')"><i class="fa-solid fa-sliders"></i>Admin Template</button>
      <button type="button" class="tab" id="btn-tab-data" onclick="switchTab('data')"><i class="fa-solid fa-right-left"></i>Import / Export</button>
    </div>

    ${
      message
        ? `<div class="flash ${ok ? 'ok' : 'err'}">
      <span>${escapeHtml(message)}</span>
      <button type="button" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
    </div>`
        : ''
    }

    <!-- ============================ TAB 1: GENERATOR ============================ -->
    <div id="tab-generator" class="studio-grid">
      <div class="card stack">
        <h2 class="card-label"><span class="dot"></span>Parameter Asesmen</h2>

        <div class="seg">
          <button type="button" class="seg-btn active" id="btn-mode-sumatif" onclick="setGenerationMode('sumatif')">Asesmen Sumatif</button>
          <button type="button" class="seg-btn" id="btn-mode-tka" onclick="setGenerationMode('tka')">Mode TKA (AKM)</button>
          <button type="button" class="seg-btn" id="btn-mode-specific" onclick="setGenerationMode('specific')">Mode Spesifik</button>
        </div>

        <div class="field">
          <label for="gen-template">Template prompt</label>
          <select id="gen-template" class="input" onchange="onTemplateChange()">${templateOptions}</select>
        </div>

        <div class="row two">
          <div class="field">
            <label for="gen-instansi">Nama instansi / sekolah</label>
            <input type="text" id="gen-instansi" class="input" value="SMK Thibbil Qulub Assimbani" placeholder="Contoh: SMA Negeri 1" oninput="onInstansiChange()">
          </div>
          <div class="field">
            <label for="gen-tahun-ajaran">Tahun ajaran / ujian</label>
            <input type="text" id="gen-tahun-ajaran" class="input" value="2025/2026" placeholder="Contoh: 2025/2026" oninput="compilePrompt()">
          </div>
        </div>

        <div class="row two">
          <div class="field">
            <label for="gen-jenjang">Jenjang</label>
            <select id="gen-jenjang" class="input" onchange="onJenjangChange()">
              <option value="SD">SD</option>
              <option value="SMP">SMP</option>
              <option value="SMA">SMA</option>
              <option value="SMK" selected>SMK</option>
            </select>
          </div>
          <div class="field">
            <label for="gen-jumlah">Total butir soal</label>
            <input type="number" id="gen-jumlah" class="input" value="25" min="1" max="100" oninput="onTotalSoalChange()">
          </div>
        </div>

        <div id="wrapper-param-sumatif" class="box">
          <div class="box-label">
            <span>Parameter Kurikulum Merdeka</span>
            <span id="badge-jenjang-info" class="stat-badge">SMK - Kelas X (Fase E)</span>
          </div>
          <div class="row four">
            <div class="field">
              <label for="gen-kelas-select">Kelas</label>
              <select id="gen-kelas-select" class="input" onchange="onKelasChange()"></select>
            </div>
            <div class="field">
              <label for="gen-fase">Fase</label>
              <input type="text" id="gen-fase" class="input" readonly>
            </div>
            <div class="field">
              <label for="gen-semester">Semester</label>
              <select id="gen-semester" class="input" onchange="compilePrompt()">
                <option value="Semester Ganjil" selected>Ganjil</option>
                <option value="Semester Genap">Genap</option>
              </select>
            </div>
            <div class="field">
              <label for="gen-jenis-asesmen">Jenis asesmen</label>
              <select id="gen-jenis-asesmen" class="input" onchange="compilePrompt()">
                <option value="Asesmen Sumatif Akhir Semester (SAS)" selected>Sumatif Akhir Semester (SAS)</option>
                <option value="Asesmen Sumatif Tengah Semester (STS)">Sumatif Tengah Semester (STS)</option>
                <option value="Asesmen Sumatif Akhir Tahun (ASAT)">Sumatif Akhir Tahun (ASAT)</option>
                <option value="Asesmen Sumatif Lingkup Materi">Sumatif Lingkup Materi (Harian)</option>
              </select>
            </div>
          </div>
        </div>

        <div id="wrapper-jurusan" class="field">
          <label for="gen-jurusan" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>Konsentrasi jurusan (khusus SMK)</span>
            <button type="button" class="btn btn-sm" onclick="openAddJurusanModal()"><i class="fa-solid fa-plus"></i>Tambah jurusan</button>
          </label>
          <select id="gen-jurusan" class="input" onchange="onJurusanChange()">
            <optgroup label="Jurusan Utama">
              <option value="Pengembangan Perangkat Lunak dan Gim (PPLG)" selected>Pengembangan Perangkat Lunak dan Gim (PPLG)</option>
            </optgroup>
            <option value="Umum">Umum / Lintas Bidang Keahlian</option>
            <optgroup id="optgroup-custom-jurusan" label="Jurusan Kustom (Tersimpan)" class="hidden"></optgroup>
            <optgroup label="Teknologi Informasi &amp; Komunikasi">
              <option value="Teknik Komputer dan Jaringan (TKJ)">Teknik Komputer dan Jaringan (TKJ)</option>
              <option value="Rekayasa Perangkat Lunak (RPL)">Rekayasa Perangkat Lunak (RPL)</option>
              <option value="Sistem Informatika, Jaringan, dan Aplikasi (SIJA)">SIJA (4 Tahun)</option>
            </optgroup>
            <optgroup label="Teknik Otomotif &amp; Manufaktur">
              <option value="Teknik Kendaraan Ringan (TKR)">Teknik Kendaraan Ringan (TKR)</option>
              <option value="Teknik Sepeda Motor (TSM)">Teknik Sepeda Motor (TSM)</option>
              <option value="Teknik Pemesinan">Teknik Pemesinan (TPm)</option>
            </optgroup>
            <optgroup label="Bisnis, Manajemen &amp; Pariwisata">
              <option value="Akuntansi dan Keuangan Lembaga (AKL)">Akuntansi dan Keuangan Lembaga (AKL)</option>
              <option value="Manajemen Perkantoran dan Layanan Bisnis (MPLB)">Manajemen Perkantoran (MPLB)</option>
              <option value="Desain Komunikasi Visual (DKV)">Desain Komunikasi Visual (DKV)</option>
              <option value="Kuliner / Tata Boga">Kuliner / Tata Boga</option>
            </optgroup>
          </select>
        </div>

        <div class="field">
          <label for="gen-mapel" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>Mata pelajaran</span>
            <span id="label-jenjang-filter" style="font-size:11px;color:var(--accent);font-weight:500"></span>
          </label>
          <select id="gen-mapel" class="input" onchange="onMapelChange()"></select>
        </div>

        <div id="wrapper-mode-specific" class="stack-sm hidden">
          <div class="box">
            <div class="box-label">
              <span>Target spesifik</span>
              <span style="text-transform:none;letter-spacing:0">Mode Spesifik</span>
            </div>
            <div class="field">
              <label for="gen-muatan" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span>Muatan / elemen</span>
                <button type="button" class="btn btn-sm" onclick="toggleCustom('muatan')">Edit manual</button>
              </label>
              <select id="gen-muatan" class="input" onchange="onMuatanChange()"></select>
              <textarea id="gen-muatan-custom" class="input hidden" rows="2" placeholder="Isi muatan kustom..." oninput="compilePrompt()"></textarea>
            </div>
            <div class="field">
              <label for="gen-kompetensi" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span>Target kompetensi</span>
                <button type="button" class="btn btn-sm" onclick="toggleCustom('kompetensi')">Edit manual</button>
              </label>
              <select id="gen-kompetensi" class="input" onchange="onKompetensiChange()"></select>
              <textarea id="gen-kompetensi-custom" class="input hidden" rows="2" placeholder="Isi kompetensi kustom..." oninput="compilePrompt()"></textarea>
            </div>
            <div class="field">
              <label>Sub kompetensi <span style="font-weight:400;color:var(--text-faint)">(centang satu atau lebih)</span></label>
              <div id="gen-subkomp-container" class="checklist"></div>
            </div>
          </div>
        </div>

        <div id="wrapper-distribusi" class="box accent">
          <div class="box-label">
            <span>Distribusi bentuk &amp; level kognitif</span>
            <div class="seg tiny">
              <button type="button" class="seg-btn active" id="btn-dist-manual" onclick="setDistMode('manual')">Kustom manual</button>
              <button type="button" class="seg-btn" id="btn-dist-auto" onclick="setDistMode('auto')">Hitung otomatis</button>
            </div>
          </div>

          <div id="wrapper-dist-manual" class="stack-sm">
            <div class="box">
              <div class="box-label">
                <span>Komposisi bentuk soal</span>
                <span id="badge-total-bentuk" class="stat-badge">Total: 25</span>
              </div>
              <div class="row three">
                <div class="field">
                  <label id="lbl-pg-sederhana" for="manual-pg">PG Biasa</label>
                  <input type="number" id="manual-pg" class="input input-mono" value="17" min="0" oninput="onManualDistChange()">
                </div>
                <div class="field">
                  <label for="manual-pgk-mcma">PGK MCMA</label>
                  <input type="number" id="manual-pgk-mcma" class="input input-mono" value="4" min="0" oninput="onManualDistChange()">
                </div>
                <div class="field">
                  <label for="manual-pgk-kat">PGK Kategori</label>
                  <input type="number" id="manual-pgk-kat" class="input input-mono" value="4" min="0" oninput="onManualDistChange()">
                </div>
              </div>
            </div>

            <div class="box">
              <div class="box-label">
                <span>Komposisi level kognitif</span>
                <span id="badge-total-kognitif" class="stat-badge">Total: 25</span>
              </div>
              <div class="row three">
                <div class="field">
                  <label for="manual-l1">Pengetahuan (L1)</label>
                  <input type="number" id="manual-l1" class="input input-mono" value="7" min="0" oninput="onManualDistChange()">
                </div>
                <div class="field">
                  <label for="manual-l2">Penerapan (L2)</label>
                  <input type="number" id="manual-l2" class="input input-mono" value="11" min="0" oninput="onManualDistChange()">
                </div>
                <div class="field">
                  <label for="manual-l3">Penalaran (L3)</label>
                  <input type="number" id="manual-l3" class="input input-mono" value="7" min="0" oninput="onManualDistChange()">
                </div>
              </div>
            </div>
          </div>

          <div id="wrapper-dist-auto" class="stack-sm hidden">
            <div class="row two">
              <div class="box">
                <span class="card-label" style="margin:0;font-size:12px">Bentuk soal</span>
                <ul class="preview-list" id="preview-bentuk-list"></ul>
              </div>
              <div class="box">
                <span class="card-label" style="margin:0;font-size:12px">Level kognitif</span>
                <ul class="preview-list" id="preview-kognitif-list"></ul>
              </div>
            </div>
            <p class="card-text" style="font-size:11px;font-style:italic">*Kalkulasi butir soal otomatis disesuaikan secara matematis terhadap total soal.</p>
          </div>
        </div>
      </div>

      <div class="card stack" style="position:sticky;top:12px">
        <div class="card-head" style="margin-bottom:0">
          <h2 class="card-title"><i class="fa-solid fa-wand-magic-sparkles"></i>Hasil prompt</h2>
          <div class="card-actions">
            <a class="btn" href="${GEM_URL}" target="_blank" rel="noopener" title="Buka Gem Gemini di tab baru"><i class="fa-solid fa-gem"></i>Gem Gemini</a>
            <button type="button" class="btn btn-accent" onclick="copyToClipboard()"><i class="fa-solid fa-copy"></i>Salin prompt</button>
          </div>
        </div>
        <textarea id="output-text" readonly placeholder="Prompt tersusun otomatis dari pilihan di sebelah kiri..."></textarea>
        <div class="output-foot">
          <span id="stat-counter">0 Karakter</span>
          <span id="copy-toast" class="toast">Tersalin ke clipboard</span>
        </div>
      </div>
    </div>

    <!-- ============================ TAB 2: KELOLA MAPEL ============================ -->
    <div id="tab-mapel" class="hidden">
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title"><i class="fa-solid fa-book-open"></i>Daftar mata pelajaran</h2>
            <p class="card-text" style="margin-top:4px">Mendukung jenjang SD, SMP, SMA, SMK, atau SEMUA (lintas jenjang).</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <input type="text" id="filter-mapel-input" class="input" style="width:200px" placeholder="Cari mapel..." oninput="filterMapelTable()">
            <button type="button" class="btn btn-accent" onclick="openSubjectModal()"><i class="fa-solid fa-plus"></i>Tambah mapel</button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Nama mapel</th>
                <th>Jenjang</th>
                <th>Muatan ringkas</th>
                <th>Kompetensi ringkas</th>
                <th style="text-align:right">Aksi</th>
              </tr>
            </thead>
            <tbody>${subjectRows || '<tr class="empty-row"><td colspan="5">Belum ada mata pelajaran. Klik "Tambah mapel" atau impor JSON di tab Import / Export.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================ TAB 3: ADMIN TEMPLATE ============================ -->
    <div id="tab-admin" class="hidden">
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title"><i class="fa-solid fa-sliders"></i>Manajemen template prompt</h2>
            <p class="card-text" style="margin-top:4px">Sesuaikan struktur prompt asesmen atau buat formula instruksi baru.</p>
          </div>
          <button type="button" class="btn btn-accent" onclick="openModal()"><i class="fa-solid fa-plus"></i>Tambah template</button>
        </div>

        <div class="table-wrap" style="max-height:none">
          <table class="table">
            <thead>
              <tr>
                <th>Nama template</th>
                <th>Tipe</th>
                <th>Struktur formula</th>
                <th style="text-align:right">Aksi</th>
              </tr>
            </thead>
            <tbody>${templateRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================ TAB 4: IMPORT / EXPORT ============================ -->
    <div id="tab-data" class="hidden">
      <div class="row two">
        <div class="card stack-sm">
          <h2 class="card-title"><i class="fa-solid fa-file-import"></i>Import matriks JSON</h2>
          <p class="card-text">
            Unggah file JSON. Mapel tanpa jenjang eksplisit otomatis berstatus
            <code>SEMUA</code> agar bisa dipakai bersama.
          </p>
          <form method="POST" action="/studio/import" enctype="multipart/form-data" class="stack-sm">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="file" name="json_file" accept=".json" required class="input">
            <button type="submit" class="btn btn-accent"><i class="fa-solid fa-upload"></i>Proses impor JSON</button>
          </form>
        </div>

        <div class="card stack-sm">
          <h2 class="card-title"><i class="fa-solid fa-file-export"></i>Ekspor data matriks</h2>
          <p class="card-text">Unduh seluruh mata pelajaran dan tabel matriks yang tersimpan dalam format JSON.</p>
          <a href="/studio/export" class="btn"><i class="fa-solid fa-download"></i>Unduh matriks_asesmen.json</a>
        </div>
      </div>
    </div>
  </main>

  <!-- MODAL TAMBAH JURUSAN -->
  <div id="modal-add-jurusan" class="modal hidden">
    <div class="modal-card">
      <div class="modal-head">
        <h3>Tambah jurusan / konsentrasi baru</h3>
        <button type="button" class="x-btn" onclick="closeAddJurusanModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="input-new-jurusan">Nama jurusan / konsentrasi</label>
          <input type="text" id="input-new-jurusan" class="input" placeholder="Contoh: Teknik Otomasi Industri">
        </div>
        <p class="card-text">Jurusan ini tersimpan di peramban Anda dan langsung dipakai untuk menyusun konteks soal kejuruan.</p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" onclick="closeAddJurusanModal()">Batal</button>
        <button type="button" class="btn btn-accent" onclick="saveNewJurusan()">Simpan jurusan</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAPEL -->
  <div id="modal-subject" class="modal hidden">
    <div class="modal-card wide">
      <form method="POST" action="/studio/subject" style="display:contents">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="action" value="save_subject">
        <input type="hidden" id="modal-sub-id" name="subject_id">
        <div class="modal-head">
          <h3 id="modal-sub-title">Tambah mata pelajaran</h3>
          <button type="button" class="x-btn" onclick="closeSubjectModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="row three">
            <div class="field" style="grid-column:span 2">
              <label for="modal-sub-nama">Nama mata pelajaran</label>
              <input type="text" id="modal-sub-nama" name="subject_nama" class="input" required>
            </div>
            <div class="field">
              <label for="modal-sub-jenjang">Jenjang target</label>
              <select id="modal-sub-jenjang" name="subject_jenjang" class="input">
                <option value="SD">SD</option>
                <option value="SMP">SMP</option>
                <option value="SMA">SMA</option>
                <option value="SMK">SMK</option>
                <option value="SMA/SMK">SMA / SMK (Umum)</option>
                <option value="SEMUA">SEMUA (SD, SMP, SMA, SMK)</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="modal-sub-muatan">Muatan / elemen materi</label>
            <textarea id="modal-sub-muatan" name="subject_muatan" class="input" rows="3" placeholder="Deskripsi umum muatan atau materi..."></textarea>
          </div>
          <div class="field">
            <label for="modal-sub-kompetensi">Target kompetensi utama</label>
            <textarea id="modal-sub-kompetensi" name="subject_kompetensi" class="input" rows="3" placeholder="Deskripsi umum kompetensi..."></textarea>
          </div>
          <div class="field">
            <label for="modal-sub-matriks">Struktur matriks (JSON)</label>
            <textarea id="modal-sub-matriks" name="subject_matriks_json" class="input input-mono" rows="7" placeholder='{"rows": [{"Elemen": "...", "Kompetensi": "...", "Subkompetensi": "..."}]}'></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onclick="closeSubjectModal()">Batal</button>
          <button type="submit" class="btn btn-accent">Simpan mapel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL TEMPLATE -->
  <div id="modal-tpl" class="modal hidden">
    <div class="modal-card wide">
      <form method="POST" action="/studio/template" style="display:contents">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="action" value="save_template">
        <input type="hidden" id="modal-tpl-id" name="template_id">
        <div class="modal-head">
          <h3 id="modal-tpl-title">Tambah template baru</h3>
          <button type="button" class="x-btn" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="modal-tpl-name">Nama template</label>
            <input type="text" id="modal-tpl-name" name="template_name" class="input" required>
          </div>
          <div class="field">
            <label for="modal-tpl-type">Kategori tipe</label>
            <select id="modal-tpl-type" name="template_type" class="input">
              <option value="sumatif">Asesmen Sumatif (Fase/Semester)</option>
              <option value="tka_full">TKA / AKM (Full Matriks Nasional)</option>
              <option value="specific">Spesifik (Per Target Kompetensi)</option>
            </select>
          </div>
          <div class="field">
            <label>Placeholder variabel</label>
            <div class="chips">
              ${[
                '{INSTANSI}',
                '{TAHUN_AJARAN}',
                '{JENIS_ASESMEN}',
                '{SEMESTER}',
                '{FASE}',
                '{OPSI_PG}',
                '{MAPEL}',
                '{JENJANG}',
                '{JURUSAN}',
                '{TOTAL_SOAL}',
                '{DISTRIBUSI_BENTUK}',
                '{DISTRIBUSI_KOGNITIF}',
                '{TABEL_MATRIKS}',
                '{MUATAN}',
                '{KOMPETENSI}',
                '{SUB_KOMPETENSI}',
                '{KELAS}',
              ]
                .map((v) => `<button type="button" class="chip" onclick="insertVar('${v}')">${v}</button>`)
                .join('')}
            </div>
            <textarea id="modal-tpl-text" name="template_text" class="input input-mono" rows="7" required></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onclick="closeModal()">Batal</button>
          <button type="submit" class="btn btn-accent">Simpan template</button>
        </div>
      </form>
    </div>
  </div>

  <script>window.TKA_DATA = ${embedded};</script>
  <script src="/vendor/tka-studio.js"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------------ */
/* Rute                                                                      */
/* ------------------------------------------------------------------------ */

function flashRedirect(tab: string, message: string, ok: boolean): string {
  return `/studio?tab=${encodeURIComponent(tab)}&ok=${ok ? '1' : '0'}&msg=${encodeURIComponent(message)}`;
}

/**
 * Guard admin untuk semua POST /studio/* (T4): sesi valid + token CSRF cocok.
 * Gagal sesi -> redirect login; gagal CSRF -> flash peringatan di tab admin.
 */
async function denyStudioRequest<E extends { Bindings: TkaBindings }>(c: Context<E>): Promise<Response | null> {
  const session = await getSession(c);
  if (!session) return c.redirect('/');
  if (!(await verifyCsrfFromRequest(c, session, c.env.SESSION_SECRET ?? ''))) {
    return c.redirect(flashRedirect('admin', 'Token keamanan tidak valid. Muat ulang halaman, lalu ulangi aksinya.', false));
  }
  return null;
}

export function registerTkaStudioRoutes<E extends { Bindings: TkaBindings }>(app: Hono<E>): void {
  /* --------- Halaman utama --------- */
  app.get('/studio', async (c) => {
    const session = await getSession(c);
    if (!session) return c.redirect('/');
    const [templates, subjects] = await Promise.all([loadTemplates(c.env.STORAGE), loadSubjects(c.env.STORAGE)]);
    const tab = c.req.query('tab') || 'generator';
    return c.html(
      renderStudioPage({
        templates,
        subjects,
        tab,
        message: c.req.query('msg') || '',
        ok: c.req.query('ok') !== '0',
        csrf: await csrfFor(session.npc, c.env.SESSION_SECRET ?? ''),
      })
    );
  });

  /* --------- Template CRUD --------- */
  app.post('/studio/template', async (c) => {
    const denied = await denyStudioRequest(c);
    if (denied) return denied;
    const body = await c.req.parseBody();
    const action = String(body.action ?? '');
    const templates = await loadTemplates(c.env.STORAGE);

    if (action === 'save_template') {
      const id = String(body.template_id ?? '').trim();
      const nama = String(body.template_name ?? '').trim();
      const tipe = String(body.template_type ?? 'sumatif');
      const template = String(body.template_text ?? '').trim();

      if (!nama || !template) {
        return c.redirect(flashRedirect('admin', 'Nama dan isi template tidak boleh kosong.', false));
      }

      if (id) {
        const found = templates.find((t) => String(t.id) === id);
        if (found) {
          found.nama = nama;
          found.tipe = tipe;
          found.template = template;
        }
      } else {
        templates.push({ id: nextId(templates), nama, tipe, template });
      }
      await c.env.STORAGE.put(TEMPLATES_KEY, JSON.stringify(templates));
      return c.redirect(flashRedirect('admin', id ? 'Template berhasil diperbarui!' : 'Template baru berhasil ditambahkan!', true));
    }

    if (action === 'delete_template') {
      const id = String(body.template_id ?? '').trim();
      if (id) {
        const kept = templates.filter((t) => String(t.id) !== id);
        await c.env.STORAGE.put(TEMPLATES_KEY, JSON.stringify(kept));
        return c.redirect(flashRedirect('admin', 'Template berhasil dihapus.', true));
      }
    }

    return c.redirect(flashRedirect('admin', 'Aksi tidak dikenal.', false));
  });

  /* --------- Mapel CRUD --------- */
  app.post('/studio/subject', async (c) => {
    const denied = await denyStudioRequest(c);
    if (denied) return denied;
    const body = await c.req.parseBody();
    const action = String(body.action ?? '');
    const subjects = await loadSubjects(c.env.STORAGE);

    if (action === 'save_subject') {
      const id = String(body.subject_id ?? '').trim();
      const nama = String(body.subject_nama ?? '').trim();
      const jenjang = String(body.subject_jenjang ?? 'SEMUA');
      const kelompok = String(body.subject_kelompok ?? 'wajib').trim() || 'wajib';
      const muatan = String(body.subject_muatan ?? '').trim();
      const kompetensi = String(body.subject_kompetensi ?? '').trim();
      const matriksRaw = String(body.subject_matriks_json ?? '').trim();

      let matriksJson = '{"rows": []}';
      if (matriksRaw) {
        try {
          matriksJson = JSON.stringify(JSON.parse(matriksRaw));
        } catch {
          matriksJson = '{"rows": []}';
        }
      }

      if (!nama) return c.redirect(flashRedirect('mapel', 'Nama mata pelajaran tidak boleh kosong.', false));

      if (id) {
        const found = subjects.find((s) => String(s.id) === id);
        if (found) {
          Object.assign(found, { nama, jenjang, kelompok, muatan, kompetensi, matriks_json: matriksJson });
        }
      } else {
        subjects.push({ id: nextId(subjects), nama, jenjang, kelompok, muatan, kompetensi, matriks_json: matriksJson });
      }
      await c.env.STORAGE.put(SUBJECTS_KEY, JSON.stringify(subjects));
      return c.redirect(flashRedirect('mapel', id ? `Data mata pelajaran '${nama}' berhasil diperbarui!` : `Mata pelajaran '${nama}' berhasil ditambahkan!`, true));
    }

    if (action === 'delete_subject') {
      const id = String(body.subject_id ?? '').trim();
      if (id) {
        const kept = subjects.filter((s) => String(s.id) !== id);
        await c.env.STORAGE.put(SUBJECTS_KEY, JSON.stringify(kept));
        return c.redirect(flashRedirect('mapel', 'Mata pelajaran berhasil dihapus.', true));
      }
    }

    return c.redirect(flashRedirect('mapel', 'Aksi tidak dikenal.', false));
  });

  /* --------- Import matriks JSON --------- */
  app.post('/studio/import', async (c) => {
    const denied = await denyStudioRequest(c);
    if (denied) return denied;
    const body = await c.req.parseBody();
    const file = body.json_file;

    if (!(file instanceof File)) {
      return c.redirect(flashRedirect('data', 'Tidak ada file JSON yang diunggah.', false));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return c.redirect(flashRedirect('data', 'Format JSON tidak valid.', false));
    }

    const list = Array.isArray((parsed as { mata_pelajaran?: unknown })?.mata_pelajaran)
      ? (parsed as { mata_pelajaran: Array<Record<string, unknown>> }).mata_pelajaran
      : Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : null;

    if (!list) return c.redirect(flashRedirect('data', 'Format JSON tidak valid.', false));

    const subjects = await loadSubjects(c.env.STORAGE);
    let count = 0;

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const nama = String(item.nama ?? '').trim();
      if (!nama) continue;

      const jenjang = item.jenjang ? String(item.jenjang).trim().toUpperCase() : guessJenjang(nama);
      const kelompok = String(item.kelompok ?? 'umum');
      // Halaman SMP/SD kerap menaruh paragrafnya di "definisi" sementara
      // "muatan"/"kompetensi" kosong; jangan buang — pakai sebagai cadangan,
      // lalu deretkan dari isi tabel matriks kalau masih kosong.
      const summary = deriveSubjectSummary(item.matriks);
      const muatan =
        String(item.muatan ?? '').trim() ||
        String(item.definisi ?? '').trim() ||
        summary.muatan;
      const kompetensi = String(item.kompetensi ?? '').trim() || summary.kompetensi;
      const matriksJson = JSON.stringify(item.matriks ?? []);

      const existing = subjects.find((s) => s.nama === nama);
      if (existing) {
        Object.assign(existing, { nama, jenjang, kelompok, muatan, kompetensi, matriks_json: matriksJson });
      } else {
        subjects.push({ id: nextId(subjects), nama, jenjang, kelompok, muatan, kompetensi, matriks_json: matriksJson });
      }
      count++;
    }

    await c.env.STORAGE.put(SUBJECTS_KEY, JSON.stringify(subjects));
    return c.redirect(flashRedirect('data', `Sukses mengimpor ${count} mapel ke database!`, true));
  });

  /* --------- Export matriks JSON --------- */
  app.get('/studio/export', async (c) => {
    if (!(await getSession(c))) return c.redirect('/');
    const subjects = await loadSubjects(c.env.STORAGE);
    const payload = {
      metadata: {
        sumber: 'Gemini Edge Deployer - TKA Prompt Engine (KV)',
        waktu_ekspor: new Date().toISOString(),
        total_mapel: subjects.length,
      },
      mata_pelajaran: subjects.map((s) => ({
        nama: s.nama,
        jenjang: s.jenjang,
        kelompok: s.kelompok,
        muatan: s.muatan,
        kompetensi: s.kompetensi,
        matriks: JSON.parse(s.matriks_json || '[]'),
      })),
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    return c.body(JSON.stringify(payload, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="matriks_asesmen_export_${stamp}.json"`,
    });
  });
}
