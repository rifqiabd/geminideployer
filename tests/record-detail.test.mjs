/* Regression untuk popup detail kiriman di halaman rekap (/p/:slug/data).
   Fokus: escaping XSS, perlakuan esai (benar null), dan aturan "kunci
   tersembunyi sampai toggle dinyalakan". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  RECORD_DIALOG_ASSETS,
  RECORD_DIALOG_CSS,
  renderRecordAssetsScript,
  renderRecordDetail,
  renderRecordDialog,
  renderSummaryCell,
  summaryLine
} from '../src/record-detail.ts';

const row = {
  id: 'rec-1',
  userId: 'Siswa-01',
  createdAt: '2026-03-01 08:00:00',
  payload: {
    score: 80,
    final_score: 90,
    lulus: true,
    student_class: 'XI-A',
    summary: { score: 80, total: 20 }
  }
};

test('escaping: teks siswa tidak pernah jadi markup', () => {
  const html = renderRecordDetail({
    ...row,
    payload: {
      detail: [{
        no: 1,
        type: 'objective',
        question_html: '<p>Soal dari guru</p>',
        jawaban: '<img src=x onerror=alert(1)>',
        kunci: 'B',
        benar: true,
        poin: 2,
        poin_maks: 2
      }]
    }
  });
  assert.ok(!html.includes('<img src=x'), 'jawaban siswa harus di-escape');
  assert.ok(html.includes('&lt;img src=x'));
  // question_html adalah konten guru, boleh tetap HTML.
  assert.ok(html.includes('<p>Soal dari guru</p>'));
});

test('escaping: identitas dan kelas tetap aman', () => {
  const html = renderRecordDetail({
    ...row,
    userId: '<b>admin</b>',
    payload: { student_class: '"><script>alert(1)</script>' }
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<b>admin</b>'));
});

test('esai: benar null berarti menunggu koreksi, bukan salah', () => {
  const html = renderRecordDetail({
    ...row,
    payload: {
      essay_pending: 1,
      detail: [{
        no: 1,
        type: 'essay',
        question_html: '<p>Uraikan</p>',
        jawaban: 'Jawaban esai siswa',
        kunci: null,
        benar: null,
        poin: null,
        poin_maks: 10,
        pembahasan: ''
      }]
    }
  });
  assert.ok(html.includes('Menunggu koreksi'));
  assert.ok(!html.includes('Benar'), 'benar null tidak boleh dirender sebagai benar');
});

test('kunci disembunyikan secara default di CSS dan baru tampil saat toggle', () => {
  assert.ok(/\.rd-key\{display:none\}/.test(RECORD_DIALOG_CSS));
  assert.ok(/show-keys[^{]*\.rd-key\{display:flex\}/.test(RECORD_DIALOG_CSS));
  assert.ok(RECORD_DIALOG_CSS.includes('.rd-dialog.show-keys'));
  // Aturan harus menimpa aturan display:none yang lebih umum.
  const hideAt = RECORD_DIALOG_CSS.indexOf('.rd-key{display:none}');
  const showAt = RECORD_DIALOG_CSS.indexOf('show-keys');
  assert.ok(hideAt < showAt, 'aturan tampil harus datang setelah aturan sembunyi');
});

test('tombol toggle dan targetnya ada di shell dialog', () => {
  const dialog = renderRecordDialog();
  assert.ok(dialog.includes('id="rd-dialog"'));
  assert.ok(dialog.includes('id="rd-keys"'));
  assert.ok(dialog.includes('id="rd-body"'));
  assert.ok(dialog.includes('id="rd-close"'));
  assert.ok(dialog.includes('<dialog'), 'harus pakai elemen dialog native');
});

test('blob aset aman: tidak bisa menutup tag script', () => {
  const blob = renderRecordAssetsScript();
  assert.ok(blob.includes('id="rd-assets"'));
  assert.ok(!blob.includes('<script src'), 'isi blob bukan script executable');
  assert.ok(blob.includes(RECORD_DIALOG_ASSETS.mathCss));
  // Kalau ada "<", harus di-escape supaya penutup tag tidak terbentuk.
  const inner = blob.slice(blob.indexOf('>') + 1, blob.lastIndexOf('<'));
  assert.ok(!inner.includes('<'));
});

test('payload rusak tetap dapat dibuka sebagai pesan', () => {
  const html = renderRecordDetail({ ...row, payload: null });
  assert.ok(html.includes('tidak bisa dibaca'));
});

test('app non-kuis jatuh ke daftar key-value', () => {
  const html = renderRecordDetail({
    ...row,
    payload: { answers: null, mood: 'Baikan', catatan: '<b>tebal</b>' }
  });
  assert.ok(html.includes('Baikan'));
  assert.ok(html.includes('&lt;b&gt;tebal&lt;/b&gt;'));
  assert.ok(!html.includes('<b>tebal</b>'));
});

test('ringkasan di sel: angka tampil, status esai ikut', () => {
  assert.ok(renderSummaryCell({ score: 80 }).includes('80'));
  // Esai yang belum dikoreksi harus terlihat dari daftar, bukan menunggu popup.
  const pending = renderSummaryCell({ score: 80, final_score: null, essay_pending: 2 });
  assert.ok(pending.includes('Tunggu esai'));
  assert.ok(!pending.includes('90'), 'nilai akhir null tidak boleh tampil sebagai angka');
  // Status lulus mengalahkan chip "tunggu esai".
  assert.ok(renderSummaryCell({ score: 80, essay_pending: 2, lulus: true }).includes('Lulus'));
  assert.ok(renderSummaryCell({ summary: { benar: 3, salah: 1 } }).includes('3'));
  // Ringkasan harus selalu bisa di-escape walau isinya string bebas.
  assert.ok(!renderSummaryCell({ summary: '<script>' }).includes('<script>'));
  // App tanpa nilai sama sekali tetap punya sel yang sah.
  assert.ok(renderSummaryCell({}).includes('-'));
});

test('summaryLine tetap sama dipakai halaman esai dan rekap', () => {
  const line = summaryLine({ score: 70, final_score: 88, essay_total: 20, essay_earned: 18, lulus: true });
  assert.ok(line.includes('Nilai objektif: 70'));
  assert.ok(line.includes('Nilai akhir: 88'));
  assert.ok(line.includes('Poin esai: 18/20'));
  assert.ok(line.includes('LULUS'));
});

test('vendor JS: sintaks valid dan tetap ES5 (dijalankan browser lawas)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'public', 'vendor', 'record-detail.js');
  // Kalau ini gagal parse, popup rusak total tapi tidak ada yang mengetahuinya
  // sampai guru benar-benar membuka satu kiriman.
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  const src = readFileSync(file, 'utf8');
  // Backtick di dalam komentar tidak masalah; yang dilarang adalah template
  // literal di kode yang dijalankan.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/=>/.test(code), 'tidak boleh pakai arrow function');
  assert.ok(!/`/.test(code), 'tidak boleh pakai template literal');
  assert.ok(!/\b(const|let)\s/.test(code), 'tidak boleh pakai const/let (pakai var)');
  assert.ok(src.includes("'data-record'"), 'harus delegate klik lewat data-record');
  // Kunci tidak boleh pernah dibuka tanpa persetujuan eksplisit.
  assert.ok(src.includes("'rd-keys'"));
  assert.ok(/classList\.toggle\('show-keys',\s*keyToggle\.checked\)/.test(src));
  // Fetch harus ke endpoint yang memang mengunci app_slug, bukan ke data mentah.
  assert.ok(src.includes("/data/record?id='"), 'harus ambil dari route detail admin');
});
