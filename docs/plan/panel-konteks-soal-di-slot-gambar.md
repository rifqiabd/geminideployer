# Panel Konteks Soal di Slot Gambar

Status: DITUNDA — belum dikerjakan. Disimpan sebagai rencana saja.

## Latar belakang
Di halaman `/p/<slug>/media`, konteks soal sebuah slot gambar (soal apa,
stimulus apa) Cuma terlihat setelah klik tombol AI (lewat textarea prompt).
Guru tidak bisa tahu gambar ini untuk soal yang mana tanpa membuka form AI.

## Keputusan UX (rekomendasi)
Floating panel "Konteks soal" per kartu slot:
- Desktop: hover = intip (muncul), mouse keluar = sembunyi.
- Klik kartu = pin (panel tetap terbuka) sampai ditutup.
- Tombol ikon mata (.js-ctx-pin) di baris tombol kartu = fallback untuk
  touch/tablet (tanpa hover) + discoverability.
- Panel anchored per-kartu (absolute di dalam kartu relative), muncul ke
  bawah dari kartu, z-20, max-height + scroll, dark style.
- Isi = stimulus + soal penuh (pakai slotGeminiContexts yang sudah ada),
  whitespace-pre-wrap. Kalau konteks kosong, tombol + panel disembunyikan.

Alternatif yang ditolak: accordion inline di dalam kartu — lebih aman dari
overlap tapi tidak "floating"; tetap disimpan sebagai fallback kalau floating
terasa mengganggu.

## Perubahan file
Hanya src/media-routes.ts (markup slot card + inline JS):

1. Markup kartu slot (~baris 360):
   - div kartu -> tambah `relative` + `data-name`.
   - Render panel server-side: `<div class="js-ctx hidden absolute ...">
     Konteks soal + isi slotGeminiContexts.get(name) ?? context
     (via escapeHtml) + tombol x tutup.
   - Tombol kecil ikon mata `.js-ctx-pin` di baris tombol (rendered hanya
     kalau konteks ada).

2. JS klien (setelah blok .js-gen-toggle, ~baris 655):
   - mouseenter kartu -> tampil (peek); mouseleave -> sembunyi kecuali pinned.
   - click kartu -> toggle pin; abaikan klik di elemen interaktif
     (a, button, label, input, textarea, select).
   - .js-ctx-pin -> toggle pin; .js-ctx-close -> tutup + unpin.

## Tidak diubah
- Logika konteks (quiz-media.ts) — sudah diuji.
- Tanpa test baru (murni klien). Cukup npm test + npm run typecheck ada.

## Verifikasi
- npm test + npm run typecheck
- (opsional) npx wrangler deploy

## Lampiran pertanyaan yang belum dijawab
- Arah panel: muncul ke bawah dari kartu (dipilih, paling aman).