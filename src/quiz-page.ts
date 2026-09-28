/* ==========================================================================
 * Generator halaman kuis (vanilla JS, tanpa CDN kecuali math/code).
 * ========================================================================== */

import { escapeHtml, mediaBaseFor, optionLetter } from './quiz-util.ts';
import { inlineRich, renderRichText } from './quiz-rich.ts';
import { HLJS_BASE, KATEX_BASE } from './quiz-types.ts';
import { FAVICON_TAGS } from './favicon.ts';
import type { Feature, QuizQuestion, QuizSpec } from './quiz-types.ts';


/* -------------------------------------------------------------------------- */
/* Generator halaman kuis                                                     */
/* -------------------------------------------------------------------------- */

/** Kartu bacaan/stimulus milik satu soal, ditaruh tepat di atas kartu soalnya. */
export function renderStimulusCard(title: string, content: string, features: Set<Feature>, mediaBase: string, anchorId: string, order: number): string {
  return `
    <section class="q-stimulus" id="stim-${escapeHtml(anchorId)}">
      <div class="q-stimulus-head">
        <span class="q-stimulus-badge">Bacaan ${order}</span>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="q-stimulus-body">${renderRichText(content, features, mediaBase)}</div>
    </section>`;
}

/** Tabel pernyataan Benar/Salah untuk soal kategori. */


/** Tabel pernyataan Benar/Salah untuk soal kategori. */
export function renderCategoryTable(question: QuizQuestion, features: Set<Feature>, mediaBase: string): string {
  const rows = question.statements
    .map((statement, index) => {
      const name = `cat-${question.id}-${index}`;
      return `
        <tr data-statement="${index}">
          <td class="q-matrix-text"><span class="q-matrix-no">${index + 1}</span>${inlineRich(statement.text, features, mediaBase)}</td>
          <td class="q-matrix-pick"><label><input type="radio" name="${name}" value="true"><span>${escapeHtml(question.labels[0])}</span></label></td>
          <td class="q-matrix-pick"><label><input type="radio" name="${name}" value="false"><span>${escapeHtml(question.labels[1])}</span></label></td>
        </tr>`;
    })
    .join('');

  return `<div class="q-matrix-wrap">
      <table class="q-matrix">
        <thead>
          <tr><th>Pernyataan</th><th>${escapeHtml(question.labels[0])}</th><th>${escapeHtml(question.labels[1])}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/** Tabel soal melengkapi: sel statis dirender biasa, sel rumpang jadi kotak isian. */


/** Tabel soal melengkapi: sel statis dirender biasa, sel rumpang jadi kotak isian. */
export function renderTableFill(question: QuizQuestion, name: string, features: Set<Feature>, mediaBase: string): string {
  const width = Math.max(
    question.tableRows.reduce((max, row) => Math.max(max, row.length), 0),
    question.tableHeaders.length
  );
  const columns = Array.from({ length: width }, (_unused, index) => question.tableHeaders[index] ?? '');
  const hasHead = columns.some((column) => column.trim() !== '');
  const head = hasHead
    ? `<thead><tr>${columns.map((column) => `<th>${inlineRich(column, features, mediaBase)}</th>`).join('')}</tr></thead>`
    : '';

  const body = question.tableRows
    .map((row) => {
      const cells = columns
        .map((_column, index) => {
          const cell = row[index] ?? '';
          const blank = /^@@BLANK(\d+)@@$/.exec(cell);
          if (!blank) return `<td>${inlineRich(cell, features, mediaBase)}</td>`;
          const blankIndex = Number(blank[1]);
          return `<td class="q-fill-cell"><input class="q-input q-fill" type="text" name="${name}-b${blankIndex}" data-blank="${blankIndex}" autocomplete="off" aria-label="Isian ke-${blankIndex + 1}"></td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="q-table-wrap"><table class="q-table q-table-fill">${head}<tbody>${body}</tbody></table></div>`;
}



export function renderQuestionCard(question: QuizQuestion, features: Set<Feature>, mediaBase: string): string {
  const name = `ans-${question.id}`;
  const tags: string[] = [];
  if (question.points !== 1) tags.push(`Bobot ${question.points}`);
  if (question.type === 'multi') tags.push('Pilih semua yang benar');
  if (question.type === 'category') tags.push('Nilai tiap pernyataan');
  if (question.type === 'matching') tags.push('Jodohkan');
  if (question.type === 'ordering') tags.push('Susun urutan');
  if (question.type === 'table_fill') tags.push('Lengkapi tabel');
  if (question.type === 'two_tier') tags.push('Pilih alasan');
  if (question.type === 'highlight') tags.push('Klik kata pada teks');
  if (question.type === 'essay') tags.push('Dikoreksi guru');
  if (question.scoring === 'partial' && question.type !== 'choice' && question.type !== 'true_false' && question.type !== 'short' && question.type !== 'essay') {
    tags.push('Skor parsial');
  }
  const tagHtml = tags.length ? ` <span class="q-tag">${escapeHtml(tags.join(' • '))}</span>` : '';
  const levelHtml = question.level ? ` <span class="q-tag q-tag-level">${escapeHtml(question.level)}</span>` : '';

  let controls = '';
  if (question.type === 'choice' || question.type === 'multi') {
    const inputType = question.type === 'choice' ? 'radio' : 'checkbox';
    controls =
      '<div class="q-opts">' +
      question.options
        .map(
          (option, index) => `
        <label class="q-opt">
          <input type="${inputType}" name="${name}" value="${index}">
          <span class="q-opt-box">
            <span class="q-opt-key">${optionLetter(index)}</span>
            <span class="q-opt-text">${inlineRich(option, features, mediaBase)}</span>
          </span>
        </label>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'true_false') {
    const options: Array<[string, string]> = [
      ['true', 'Benar'],
      ['false', 'Salah'],
    ];
    controls =
      '<div class="q-opts">' +
      options
        .map(
          ([value, label], index) => `
        <label class="q-opt">
          <input type="radio" name="${name}" value="${value}">
          <span class="q-opt-box">
            <span class="q-opt-key">${optionLetter(index)}</span>
            <span class="q-opt-text">${label}</span>
          </span>
        </label>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'category') {
    controls = renderCategoryTable(question, features, mediaBase);
  } else if (question.type === 'matching') {
    controls =
      '<div class="q-match">' +
      '<div class="q-match-head"><span>Pernyataan</span><span>Pasangan</span></div>' +
      question.options
        .map(
          (left, index) => `
        <div class="q-match-row" data-left="${index}">
          <span class="q-match-left"><span class="q-match-no">${index + 1}</span><span class="q-opt-text">${inlineRich(left, features, mediaBase)}</span></span>
          <select class="q-match-select" name="${name}-m${index}" aria-label="Pasangan untuk pernyataan ${index + 1}">
            <option value="">\u2014 pilih \u2014</option>
            ${question.rights
              .map((right, rightIndex) => `<option value="${rightIndex}">${optionLetter(rightIndex)}. ${escapeHtml(right)}</option>`)
              .join('')}
          </select>
        </div>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'ordering') {
    controls =
      '<div class="q-ord" data-order>' +
      question.options
        .map(
          (option, index) => `
        <div class="q-ord-row" data-item="${index}">
          <span class="q-ord-pos"></span>
          <span class="q-ord-text">${inlineRich(option, features, mediaBase)}</span>
          <span class="q-ord-btns">
            <button type="button" class="q-ord-btn" data-move="-1" aria-label="Naikkan">\u25b2</button>
            <button type="button" class="q-ord-btn" data-move="1" aria-label="Turunkan">\u25bc</button>
          </span>
        </div>`
        )
        .join('') +
      '</div>';
  } else if (question.type === 'table_fill') {
    controls = renderTableFill(question, name, features, mediaBase);
  } else if (question.type === 'two_tier') {
    const group = (label: string, suffix: string, choices: string[]) =>
      `<div class="q-tier"><p class="q-tier-label">${label}</p><div class="q-opts">` +
      choices
        .map(
          (choice, index) => `
        <label class="q-opt">
          <input type="radio" name="${name}-${suffix}" value="${index}">
          <span class="q-opt-box">
            <span class="q-opt-key">${optionLetter(index)}</span>
            <span class="q-opt-text">${inlineRich(choice, features, mediaBase)}</span>
          </span>
        </label>`
        )
        .join('') +
      '</div></div>';
    controls =
      group('1. Pilih pernyataan', 't1', question.options) +
      group('2. Pilih alasan yang mendukung', 't2', question.reasons);
  } else if (question.type === 'highlight') {
    let selectableIndex = -1;
    const body = question.segments
      .map((segment) => {
        if (!segment.selectable) return escapeHtml(segment.text);
        selectableIndex += 1;
        return `<button type="button" class="q-hl" data-hl="${selectableIndex}">${escapeHtml(segment.text)}</button>`;
      })
      .join('');
    controls = `<div class="q-passage">${body}</div>`;
  } else if (question.type === 'short') {
    controls = `<input class="q-input" type="text" name="${name}" autocomplete="off" placeholder="Tulis jawaban singkat..." style="margin-top:12px">`;
  } else {
    controls = `<textarea class="q-textarea" name="${name}" placeholder="Tulis jawabanmu di sini..." style="margin-top:12px"></textarea>`;
  }

  return `
    <div class="q-card" data-qid="${escapeHtml(question.id)}" data-type="${question.type}">
      <div class="q-card-head">
        <span class="q-num">${question.no}</span>
        <div class="q-text">${renderRichText(question.question, features, mediaBase)}${levelHtml}${tagHtml}</div>
        <button type="button" class="q-flag" data-flag aria-pressed="false" title="Tandai soal ini ragu-ragu">Ragu</button>
      </div>
      ${controls}
    </div>`;
}



export function renderQuizApp(quiz: QuizSpec, slug: string): string {
  const features = new Set(quiz.features);
  const mediaBase = mediaBaseFor(slug);

  // Setiap soal memegang bacaannya sendiri (denormalisasi saat parse): stimulus
  // dirender langsung di atas kartu soalnya — satu stimulus untuk satu soal,
  // tanpa pengelompokan seperti naskah TKA yang berbagi satu bacaan.
  let stimulusOrder = 0;
  const cards = quiz.questions
    .map((question) => {
      const reading = question.stimulusContent
        ? renderStimulusCard(
            question.stimulusTitle || `Bacaan ${stimulusOrder + 1}`,
            question.stimulusContent,
            features,
            mediaBase,
            question.id,
            ++stimulusOrder
          )
        : '';
      const body = renderQuestionCard(question, features, mediaBase);
      return `<div class="q-group">${reading}${body}</div>`;
    })
    .join('');
  const objectivePoints = quiz.questions
    .filter((question) => question.type !== 'essay')
    .reduce((sum, question) => sum + question.points, 0);
  const essayCount = quiz.questions.filter((question) => question.type === 'essay').length;

  // Pemetaan ranah kognitif (L1/L2/L3 atau label bebas) untuk ditampilkan di kepala halaman.
  const levelCounts = new Map<string, number>();
  for (const question of quiz.questions) {
    if (!question.level) continue;
    levelCounts.set(question.level, (levelCounts.get(question.level) ?? 0) + 1);
  }
  const levelLine = levelCounts.size
    ? ` • <span class="q-levels">${[...levelCounts.entries()]
        .map(([level, count]) => `${escapeHtml(level)} ${count}`)
        .join(' • ')}</span>`
    : '';

  const config = JSON.stringify({
    slug,
    title: quiz.title,
    total: quiz.questions.length,
    objectivePoints,
    essayCount,
    kkm: quiz.passingScore,
    showExplanation: quiz.showExplanation,
    // Timer latihan (menit) — hanya pengingat klien, bukan pengawas ujian.
    durationMinutes: quiz.durationMinutes ?? null,
    // Bentuk identitas: 'name' (perilaku lama) atau 'name_class' (nama + kelas).
    identityFields: quiz.identityFields ?? 'name',
  }).replace(/</g, '\\u003c');

  const headExtra = [
    features.has('math') ? `<link rel="stylesheet" href="${KATEX_BASE}/katex.min.css">` : '',
    features.has('code') ? `<link rel="stylesheet" href="${HLJS_BASE}/styles/github-dark.min.css">` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  const scripts = [
    features.has('math') ? `<script src="${KATEX_BASE}/katex.min.js"></script>` : '',
    features.has('math') ? `<script src="${KATEX_BASE}/contrib/auto-render.min.js"></script>` : '',
    features.has('code') ? `<script src="${HLJS_BASE}/highlight.min.js"></script>` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  const description = quiz.description ? `<p class="q-hint">${renderRichText(quiz.description, features, mediaBase)}</p>` : '';

  // Petunjuk pengerjaan untuk modal gerbang mulai. Daftar ketentuan + baris
  // info soal (jumlah, bobot, KKM). Tanpa durasi, baris durasi tidak ditulis.
  const gateLines: string[] = [
    `<li>Isi <b>nama${(quiz.identityFields ?? 'name') === 'name_class' ? ' dan kelas' : ''}</b> dengan benar sebelum mulai.</li>`,
    `<li>Kerjakan <b>${quiz.questions.length} soal</b>${objectivePoints ? ` (bobot objektif ${objectivePoints} poin)` : ''}${essayCount ? ` • ${essayCount} soal esai dikoreksi guru` : ''}. Soal yang dijawab tersimpan otomatis di perangkat ini.</li>`,
    `<li>Nilai minimal lulus <b>${quiz.passingScore}</b>.</li>`,
  ];
  if (quiz.durationMinutes) {
    gateLines.splice(1, 0, `<li>Waktu pengerjaan <b>${quiz.durationMinutes} menit</b>. Timer baru berjalan setelah kamu menekan <b>Mulai Mengerjakan</b>, dan tidak ikut berhenti saat halaman di-refresh.</li>`);
  } else {
    gateLines.push('<li>Tidak ada batas waktu pengerjaan.</li>');
  }
  if (essayCount) {
    gateLines.push('<li>Jawaban esai akan dinilai dan dikoreksi oleh guru setelah dikirim.</li>');
  }
  gateLines.push('<li>Tekan tombol <b>Kirim Jawaban</b> di bawah halaman setelah selesai.</li>');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(quiz.title || 'Kuis')}</title>
  ${FAVICON_TAGS}
  <link rel="stylesheet" href="/vendor/quiz.css">
  ${headExtra}
</head>
<body>
  <header class="q-header">
    <div class="q-header-inner">
      <div class="q-logo">
        <svg viewBox="0 0 24 24"><path d="M9 11l2 2 4-4"></path><path d="M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"></path></svg>
      </div>
      <div class="q-header-title">
        <h1>${escapeHtml(quiz.title || 'Kuis')}</h1>
        <p>${quiz.questions.length} soal • nilai minimal lulus ${quiz.passingScore}${levelLine}</p>
      </div>
      <div class="q-header-tools q-no-print">
        ${
          quiz.durationMinutes
            ? `<div class="q-timer" id="quiz-timer" style="display:none">
                <svg class="q-timer-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>
                <span class="q-timer-label">Sisa waktu</span>
                <strong class="q-timer-clock" id="timer-clock">--:--</strong>
              </div>`
            : ''
        }
        <!-- Tombol cetak TIDAK dirender untuk siswa. public-app.ts menyuntik
             tombol Cetak ke placeholder ini hanya bila yang membuka login
             sebagai admin. -->
        <span class="q-admin-tools" id="admin-tools"></span>
        <div class="q-zoom" role="group" aria-label="Perbesar teks soal">
          <button type="button" id="zoom-out" aria-label="Perkecil teks" title="Perkecil teks (Ctrl −)">−</button>
          <span class="q-zoom-val" id="zoom-val" aria-live="polite">100%</span>
          <button type="button" id="zoom-in" aria-label="Perbesar teks" title="Perbesar teks (Ctrl +)">＋</button>
          <button type="button" id="zoom-reset" aria-label="Setel ulang ukuran teks" title="Setel ulang (Ctrl 0)">⟲</button>
        </div>
      </div>
    </div>
  </header>

  <main class="q-wrap">
    <div class="q-shell">
      <div class="q-main">
        <div id="quiz-view">
          <div class="q-card">
            ${
              (quiz.identityFields ?? 'name') === 'name_class'
                ? `
            <div class="q-id-row">
              <div class="q-id-cell">
                <label class="q-idlabel" for="student-name">Nama siswa</label>
                <input class="q-input" id="student-name" type="text" autocomplete="off" placeholder="Nama lengkap">
              </div>
              <div class="q-id-cell">
                <label class="q-idlabel" for="student-class">Kelas</label>
                <input class="q-input" id="student-class" type="text" autocomplete="off" placeholder="Contoh: 7A">
              </div>
            </div>`
                : `
            <label class="q-idlabel" for="student-name">Nama siswa</label>
            <input class="q-input" id="student-name" type="text" autocomplete="off" placeholder="Tulis nama lengkap dan kelas...">`
            }
            ${description}
          </div>

          <div class="q-alert q-alert-error q-hidden" id="alert-box"></div>

          <div class="q-alert q-alert-info q-hidden" id="resume-box">
            <span id="resume-text"></span>
            <span class="q-resume-actions">
              <button type="button" class="q-btn q-btn-mini" id="resume-yes">Lanjutkan</button>
              <button type="button" class="q-btn q-btn-mini q-btn-ghost" id="resume-no">Mulai baru</button>
            </span>
          </div>

          <form id="quiz-form">
            ${cards}
          </form>
        </div>

        <div id="result-view" class="q-hidden"></div>
      </div>

      <aside class="q-nav q-no-print" id="nav-panel" aria-label="Navigasi soal">
        <div class="q-nav-head">
          <span>Nomor soal</span>
          <button type="button" class="q-nav-close" id="nav-close" aria-label="Tutup navigasi">&times;</button>
        </div>
        <div class="q-nav-grid" id="nav-grid"></div>
        <p class="q-nav-count" id="nav-count">Terjawab <strong>0</strong> dari <strong>${quiz.questions.length}</strong></p>
        <div class="q-nav-legend">
          <span><i class="q-dot q-dot-done"></i>Terjawab</span>
          <span><i class="q-dot q-dot-empty"></i>Kosong</span>
          <span><i class="q-dot q-dot-flag"></i>Ragu</span>
        </div>
      </aside>
    </div>
  </main>

  <!-- Gerbang mulai: petunjuk pengerjaan + identitas. Timer baru jalan
       setelah tombol Mulai Mengerjakan ditekan. Siswa yang pernah mengerjakan
       (identitas tersimpan) langsung diteruskan tanpa modal oleh skrip bawah. -->
  <div class="q-gate q-no-print" id="start-gate" hidden aria-hidden="true">
    <div class="q-gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div class="q-gate-head">
        <span class="q-gate-badge">Petunjuk Pengerjaan</span>
        <h2 id="gate-title">${escapeHtml(quiz.title || 'Kuis')}</h2>
      </div>
      <ul class="q-gate-rules">
        ${gateLines.join('\n        ')}
      </ul>
      <div class="q-gate-id">
        ${
          (quiz.identityFields ?? 'name') === 'name_class'
            ? `
        <div class="q-id-row">
          <div class="q-id-cell">
            <label class="q-idlabel" for="gate-name">Nama siswa</label>
            <input class="q-input" id="gate-name" type="text" autocomplete="off" placeholder="Nama lengkap">
          </div>
          <div class="q-id-cell">
            <label class="q-idlabel" for="gate-class">Kelas</label>
            <input class="q-input" id="gate-class" type="text" autocomplete="off" placeholder="Contoh: 7A">
          </div>
        </div>`
            : `
        <label class="q-idlabel" for="gate-name">Nama siswa</label>
        <input class="q-input" id="gate-name" type="text" autocomplete="off" placeholder="Tulis nama lengkap dan kelas...">`
        }
      </div>
      <button type="button" class="q-btn q-btn-primary" id="gate-start">Mulai Mengerjakan</button>
    </div>
  </div>

  <button type="button" class="q-nav-fab q-no-print" id="nav-fab" aria-label="Buka daftar nomor soal">Soal</button>

  <div class="q-bar" id="action-bar">
    <div class="q-bar-inner">
      <div class="q-progress" id="progress">Terjawab <strong>0</strong> dari <strong>${quiz.questions.length}</strong> soal</div>
      <button class="q-btn" id="submit-btn" type="submit" form="quiz-form">Kirim Jawaban</button>
    </div>
  </div>

  ${scripts}
  <script>
(function () {
  var CFG = ${config};
  var NAME_KEY = 'quiz-student-name:' + CFG.slug;
  var CLASS_KEY = 'quiz-student-class:' + CFG.slug;
  var ATTEMPT_KEY = 'quiz-attempt:' + CFG.slug;
  var form = document.getElementById('quiz-form');
  var nameInput = document.getElementById('student-name');
  var progress = document.getElementById('progress');
  var submitBtn = document.getElementById('submit-btn');
  var quizView = document.getElementById('quiz-view');
  var resultView = document.getElementById('result-view');
  var alertBox = document.getElementById('alert-box');
  var actionBar = document.getElementById('action-bar');
  var navPanel = document.getElementById('nav-panel');
  var navGrid = document.getElementById('nav-grid');
  var navCount = document.getElementById('nav-count');
  var navFab = document.getElementById('nav-fab');
  var navClose = document.getElementById('nav-close');
  var resumeBox = document.getElementById('resume-box');
  var resumeText = document.getElementById('resume-text');

  var classInput = document.getElementById('student-class');

  try { if (localStorage.getItem(NAME_KEY)) nameInput.value = localStorage.getItem(NAME_KEY); } catch (err) {}
  try { if (classInput && localStorage.getItem(CLASS_KEY)) classInput.value = localStorage.getItem(CLASS_KEY); } catch (err) {}

  /* --- Zoom teks (aksesibilitas): 80–150%, tersimpan per perangkat ---------
     body.style.zoom dipakai karena stylesheet berbasis px; zoom menskalakan
     seluruh layout termasuk bar tetap di bawah. Firefox lama yang tidak
     mendukung cukup kehilangan efeknya tanpa merusak apa pun. */
  (function () {
    var KEY = 'quiz-text-zoom';
    var MIN = 80, MAX = 150, STEP = 10, DEFAULT = 100;
    var val = DEFAULT;
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (typeof saved === 'number' && saved >= MIN && saved <= MAX) val = saved;
    } catch (err) {}
    var outBtn = document.getElementById('zoom-out');
    var inBtn = document.getElementById('zoom-in');
    var resetBtn = document.getElementById('zoom-reset');
    var label = document.getElementById('zoom-val');
    function apply() {
      document.body.style.zoom = val === DEFAULT ? '' : String(val / 100);
      document.body.setAttribute('data-zoom', String(val));
      if (label) label.textContent = val + '%';
      if (outBtn) outBtn.disabled = val <= MIN;
      if (inBtn) inBtn.disabled = val >= MAX;
    }
    function set(next) {
      val = Math.min(MAX, Math.max(MIN, next));
      apply();
      try { localStorage.setItem(KEY, JSON.stringify(val)); } catch (err) {}
    }
    if (outBtn) outBtn.addEventListener('click', function () { set(val - STEP); });
    if (inBtn) inBtn.addEventListener('click', function () { set(val + STEP); });
    if (resetBtn) resetBtn.addEventListener('click', function () { set(DEFAULT); });
    document.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      var k = ev.key;
      if (k === '+' || k === '=') { set(val + STEP); ev.preventDefault(); }
      else if (k === '-' || k === '_') { set(val - STEP); ev.preventDefault(); }
      else if (k === '0') { set(DEFAULT); ev.preventDefault(); }
    });
    apply();
  })();

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; }
  }

  function cardList() { return Array.prototype.slice.call(document.querySelectorAll('[data-qid]')); }

  /* --- Membaca jawaban dari DOM (satu cabang per tipe soal) --------------- */
  function readOne(card) {
    var type = card.getAttribute('data-type');

    if (type === 'choice' || type === 'true_false') {
      var checked = card.querySelector('input[type=radio]:checked');
      if (!checked) return null;
      return type === 'true_false' ? (checked.value === 'true') : Number(checked.value);
    }
    if (type === 'multi') {
      return Array.prototype.slice.call(card.querySelectorAll('input[type=checkbox]:checked'))
        .map(function (el) { return Number(el.value); })
        .sort(function (a, b) { return a - b; });
    }
    if (type === 'category') {
      // Satu jawaban boolean per pernyataan; null = baris yang belum diisi.
      return Array.prototype.slice.call(card.querySelectorAll('[data-statement]')).map(function (row) {
        var chosen = row.querySelector('input[type=radio]:checked');
        return chosen ? chosen.value === 'true' : null;
      });
    }
    if (type === 'matching') {
      return Array.prototype.slice.call(card.querySelectorAll('.q-match-select')).map(function (select) {
        return select.value === '' ? null : Number(select.value);
      });
    }
    if (type === 'ordering') {
      // Urutan bacaan = urutan baris di DOM, jadi cukup dibaca berurutan.
      return Array.prototype.slice.call(card.querySelectorAll('.q-ord-row')).map(function (row) {
        return Number(row.getAttribute('data-item'));
      });
    }
    if (type === 'table_fill') {
      var cells = [];
      Array.prototype.slice.call(card.querySelectorAll('.q-fill')).forEach(function (input) {
        cells[Number(input.getAttribute('data-blank'))] = input.value.trim();
      });
      for (var i = 0; i < cells.length; i++) { if (cells[i] === undefined) cells[i] = ''; }
      return cells;
    }
    if (type === 'two_tier') {
      var first = card.querySelector('input[type=radio][name$="-t1"]:checked');
      var second = card.querySelector('input[type=radio][name$="-t2"]:checked');
      return [first ? Number(first.value) : null, second ? Number(second.value) : null];
    }
    if (type === 'highlight') {
      var words = [];
      Array.prototype.slice.call(card.querySelectorAll('.q-hl')).forEach(function (button, index) {
        if (button.classList.contains('q-hl-on')) words.push(index);
      });
      return words;
    }
    var field = card.querySelector('input[type=text], textarea');
    return field ? field.value.trim() : '';
  }

  function readAnswers() {
    return cardList().map(function (card) {
      return { id: card.getAttribute('data-qid'), value: readOne(card) };
    });
  }

  function isAnswered(type, value) {
    if (value === null || value === undefined) return false;
    if (type === 'choice') return typeof value === 'number' && value >= 0;
    if (type === 'true_false') return typeof value === 'boolean';
    if (type === 'multi') return Array.isArray(value) && value.length > 0;
    if (type === 'category') {
      return Array.isArray(value) && value.length > 0 && value.every(function (item) { return typeof item === 'boolean'; });
    }
    if (type === 'matching') {
      return Array.isArray(value) && value.length > 0 && value.every(function (item) { return typeof item === 'number'; });
    }
    // Soal mengurutkan selalu berisi seluruh item, jadi tidak pernah kosong.
    if (type === 'ordering') return true;
    if (type === 'table_fill') {
      return Array.isArray(value) && value.length > 0 && value.some(function (item) { return item !== ''; });
    }
    if (type === 'two_tier') {
      return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number';
    }
    if (type === 'highlight') return Array.isArray(value) && value.length > 0;
    return typeof value === 'string' && value.length > 0;
  }

  /* --- Mengembalikan jawaban tersimpan ke form ---------------------------- */
  function applyAnswers(list) {
    if (!list) return;
    var cards = cardList();
    list.forEach(function (entry, position) {
      var card = cards[position];
      if (!card || !entry) return;
      var type = card.getAttribute('data-type');
      var value = entry.value;
      if (value === null || value === undefined) return;
      var mark = function (selector, wanted, property) {
        var node = card.querySelector(selector.replace('%s', wanted));
        if (node) node[property] = true;
        return node;
      };

      if (type === 'choice' || type === 'true_false') {
        mark('input[type=radio][value="%s"]', value, 'checked');
      } else if (type === 'multi') {
        (value || []).forEach(function (index) {
          mark('input[type=checkbox][value="%s"]', index, 'checked');
        });
      } else if (type === 'category') {
        var rows = Array.prototype.slice.call(card.querySelectorAll('[data-statement]'));
        (value || []).forEach(function (item, rowIndex) {
          if (item === null || !rows[rowIndex]) return;
          var input = rows[rowIndex].querySelector('input[type=radio][value="' + item + '"]');
          if (input) input.checked = true;
        });
      } else if (type === 'matching') {
        var selects = Array.prototype.slice.call(card.querySelectorAll('.q-match-select'));
        (value || []).forEach(function (item, rowIndex) {
          if (item === null || !selects[rowIndex]) return;
          selects[rowIndex].value = String(item);
        });
      } else if (type === 'ordering') {
        var container = card.querySelector('[data-order]');
        if (!container) return;
        var byItem = {};
        Array.prototype.slice.call(container.querySelectorAll('.q-ord-row')).forEach(function (row) {
          byItem[row.getAttribute('data-item')] = row;
        });
        (value || []).forEach(function (item) {
          if (byItem[String(item)]) container.appendChild(byItem[String(item)]);
        });
        renumberOrder(container);
      } else if (type === 'table_fill') {
        Array.prototype.slice.call(card.querySelectorAll('.q-fill')).forEach(function (input) {
          var slot = Number(input.getAttribute('data-blank'));
          if (typeof value[slot] === 'string') input.value = value[slot];
        });
      } else if (type === 'two_tier') {
        if (typeof value[0] === 'number') mark('input[type=radio][name$="-t1"][value="%s"]', value[0], 'checked');
        if (typeof value[1] === 'number') mark('input[type=radio][name$="-t2"][value="%s"]', value[1], 'checked');
      } else if (type === 'highlight') {
        var buttons = Array.prototype.slice.call(card.querySelectorAll('.q-hl'));
        (value || []).forEach(function (index) {
          if (!buttons[index]) return;
          buttons[index].classList.add('q-hl-on');
          buttons[index].setAttribute('aria-pressed', 'true');
        });
      } else {
        var field = card.querySelector('input[type=text], textarea');
        if (field && typeof value === 'string') field.value = value;
      }
    });
  }

  function renumberOrder(container) {
    Array.prototype.slice.call(container.querySelectorAll('.q-ord-row')).forEach(function (row, index) {
      var badge = row.querySelector('.q-ord-pos');
      if (badge) badge.textContent = String(index + 1);
    });
  }

  /* --- Panel navigasi nomor soal ------------------------------------------ */
  var flags = {};
  var navButtons = [];

  function buildNav() {
    navGrid.innerHTML = '';
    navButtons = [];
    cardList().forEach(function (card, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'q-nav-item';
      button.textContent = String(index + 1);
      button.setAttribute('aria-label', 'Ke soal ' + (index + 1));
      button.addEventListener('click', function () {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('q-flash');
        window.setTimeout(function () { card.classList.remove('q-flash'); }, 1200);
        if (window.matchMedia('(max-width: 1100px)').matches) navPanel.classList.remove('q-nav-open');
      });
      navGrid.appendChild(button);
      navButtons.push(button);
    });
  }

  function refresh() {
    var cards = cardList();
    var answers = cards.map(readOne);
    var done = 0;

    answers.forEach(function (value, index) {
      var card = cards[index];
      var id = card.getAttribute('data-qid');
      var answered = isAnswered(card.getAttribute('data-type'), value);
      if (answered) done += 1;

      card.classList.toggle('q-is-answered', answered);
      var flagged = flags[id] === true;
      var flag = card.querySelector('[data-flag]');
      if (flag) {
        flag.classList.toggle('q-flag-on', flagged);
        flag.setAttribute('aria-pressed', flagged ? 'true' : 'false');
      }
      var button = navButtons[index];
      if (button) button.className = 'q-nav-item' + (answered ? ' q-done' : '') + (flagged ? ' q-flagged' : '');
    });

    var line = 'Terjawab <strong>' + done + '</strong> dari <strong>' + CFG.total + '</strong> soal';
    progress.innerHTML = line;
    if (navCount) navCount.innerHTML = line;
    if (navFab) navFab.textContent = 'Soal ' + done + '/' + CFG.total;

    // Jawaban disimpan tiap kali berubah, tapi hanya setelah nama diisi — supaya
    // komputer sekolah yang dipakai bergantian tidak mencampur jawaban siswa lain.
    var name = nameInput.value.trim();
    if (name) store(ATTEMPT_KEY, { name: name, student_class: classInput ? classInput.value.trim() : '', answers: readAnswers(), flags: flags });
  }

  form.addEventListener('input', function () {
    var name = nameInput.value.trim();
    if (name) store(NAME_KEY, name);
    if (classInput && classInput.value.trim()) store(CLASS_KEY, classInput.value.trim());
    refresh();
  });
  form.addEventListener('change', refresh);

  form.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var moveButton = target.closest('.q-ord-btn');
    if (moveButton) {
      event.preventDefault();
      var row = moveButton.closest('.q-ord-row');
      var container = moveButton.closest('[data-order]');
      if (row && container) {
        var direction = Number(moveButton.getAttribute('data-move'));
        if (direction < 0 && row.previousElementSibling) container.insertBefore(row, row.previousElementSibling);
        if (direction > 0 && row.nextElementSibling) container.insertBefore(row.nextElementSibling, row);
        renumberOrder(container);
        refresh();
      }
      return;
    }

    var word = target.closest('.q-hl');
    if (word) {
      event.preventDefault();
      word.classList.toggle('q-hl-on');
      word.setAttribute('aria-pressed', word.classList.contains('q-hl-on') ? 'true' : 'false');
      refresh();
      return;
    }

    var flagButton = target.closest('[data-flag]');
    if (flagButton) {
      event.preventDefault();
      var card = flagButton.closest('[data-qid]');
      if (!card) return;
      var id = card.getAttribute('data-qid');
      flags[id] = flags[id] !== true;
      refresh();
    }
  });

  if (navFab) {
    navFab.addEventListener('click', function () { navPanel.classList.toggle('q-nav-open'); });
  }
  if (navClose) {
    navClose.addEventListener('click', function () { navPanel.classList.remove('q-nav-open'); });
  }

  // Tawaran melanjutkan pengerjaan: muncul HANYA kalau ada jawaban tersimpan,
  // dan siswa yang memutuskan — bukan dipulihkan diam-diam.
  var attempt = load(ATTEMPT_KEY);
  if (attempt && attempt.answers && attempt.answers.some(function (entry) { return entry && entry.value !== null; })) {
    resumeBox.classList.remove('q-hidden');
    resumeText.textContent =
      'Ada jawaban yang belum dikirim' + (attempt.name ? ' atas nama ' + attempt.name : '') + '. Lanjutkan mengerjakan?';
    if (attempt.name && !nameInput.value) nameInput.value = attempt.name;
    if (attempt.flags) flags = attempt.flags;

    document.getElementById('resume-yes').addEventListener('click', function () {
      applyAnswers(attempt.answers);
      resumeBox.classList.add('q-hidden');
      refresh();
    });
    document.getElementById('resume-no').addEventListener('click', function () {
      try {
        localStorage.removeItem(ATTEMPT_KEY);
        localStorage.removeItem(NAME_KEY);
        localStorage.removeItem(CLASS_KEY);
      } catch (err) {}
      flags = {};
      resumeBox.classList.add('q-hidden');
      refresh();
    });
  }

  /* --- Gerbang mulai: petunjuk + identitas, lalu timer baru jalan ---------
   * Modal #start-gate selalu dirender server (CSS menyembunyikannya lewat
   * [hidden]) agar tidak berkedip; skrip di bawah menampilkan kembali hanya
   * bila belum ada identitas tersimpan. Timer hanya dimulai setelah tombol
   * Mulai Mengerjakan ditekan — bukan saat halaman dibuka. Siswa yang
   * melanjutkan attempt lama / sudah punya identitas langsung lewat.
   * ---------------------------------------------------------------------- */
  var gate = document.getElementById('start-gate');
  var gateName = document.getElementById('gate-name');
  var gateClass = document.getElementById('gate-class');
  var gateStart = document.getElementById('gate-start');
  var GATE_KEY = 'quiz-started:' + CFG.slug;

  function gateHasIdentity() {
    var has = Boolean(gateName && gateName.value.trim());
    if (has && CFG.identityFields === 'name_class') has = Boolean(gateClass && gateClass.value.trim());
    return has;
  }

  function startTimerNow() {
    try {
      timerDeadline = Number(localStorage.getItem(TIMER_KEY)) || 0;
      if (!timerDeadline || timerDeadline < Date.now()) {
        timerDeadline = Date.now() + CFG.durationMinutes * 60000;
        try { localStorage.setItem(TIMER_KEY, String(timerDeadline)); } catch (err) {}
      }
    } catch (err) {
      timerDeadline = Date.now() + CFG.durationMinutes * 60000;
    }
    if (timerBox) timerBox.style.display = '';
    tickTimer();
    if (!timerInterval) timerInterval = setInterval(tickTimer, 1000);
  }

  function closeGate() {
    if (!gate) return;
    gate.setAttribute('hidden', '');
    gate.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('q-gate-open');
  }

  function startQuizFromGate() {
    if (!gateHasIdentity()) {
      if (gateName && !gateName.value.trim()) { gateName.focus(); return; }
      if (gateClass && !gateClass.value.trim()) { gateClass.focus(); return; }
      return;
    }
    // Salin identitas dari modal ke form asli + simpan (aturan penulisan nama
    // yang sama dengan submit: setItem dengan kunci yang benar).
    nameInput.value = gateName.value.trim();
    try { localStorage.setItem(NAME_KEY, gateName.value.trim()); } catch (err) {}
    if (gateClass && classInput) {
      classInput.value = gateClass.value.trim();
      try { localStorage.setItem(CLASS_KEY, gateClass.value.trim()); } catch (err) {}
    }
    try { localStorage.setItem(GATE_KEY, '1'); } catch (err) {}
    try { store(ATTEMPT_KEY, { name: nameInput.value, student_class: classInput ? classInput.value.trim() : '', answers: readAnswers(), flags: flags }); } catch (err) {}
    closeGate();
    if (CFG.durationMinutes >= 1) startTimerNow();
    refresh();
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (gate) {
    var alreadyStarted = false;
    try { alreadyStarted = localStorage.getItem(GATE_KEY) === '1'; } catch (err) {}
    var savedIdentity = false;
    try { savedIdentity = Boolean(localStorage.getItem(NAME_KEY)); } catch (err) {}
    // Prefill dari localStorage supaya siswa yang berpindah halaman tidak
    // mengetik dua kali. Attempt lama menimpa prefill (sumber lebih akurat).
    if (gateName) {
      try { gateName.value = localStorage.getItem(NAME_KEY) || gateName.value; } catch (err) {}
    }
    if (gateClass) {
      try { gateClass.value = localStorage.getItem(CLASS_KEY) || gateClass.value; } catch (err) {}
    }
    if (resumeBox && !resumeBox.classList.contains('q-hidden')) {
      closeGate();
    } else if (alreadyStarted || savedIdentity) {
      closeGate();
      if (CFG.durationMinutes >= 1) startTimerNow();
    } else {
      // Tampilkan gerbang, blokir scroll di belakangnya.
      gate.removeAttribute('hidden');
      document.body.classList.add('q-gate-open');
    }
    if (gateStart) gateStart.addEventListener('click', startQuizFromGate);
    if (gateName) {
      gateName.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); (gateClass || gateStart).focus(); if (gateClass) return; startQuizFromGate(); }
      });
    }
    if (gateClass) {
      gateClass.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); startQuizFromGate(); }
      });
    }
  }

  /* --- Timer latihan (opsional, sisi klien) --------------------------------
   * Durasi dari spec (CFG.durationMinutes). Hanya pengingat: siswa yang paham
   * DevTools bisa melewatkannya. Pengawasan ujian sungguhan menunggu mode CBT
   * terdaftar (deadline server-side, plan-google-cbt Fase 3).
   * Dimulai lewat startTimerNow() dari gerbang mulai — BUKAN saat halaman
   * dibuka — jadi waktu tidak berjalan saat siswa masih membaca petunjuk.
   * ---------------------------------------------------------------------- */
  var timerBox = document.getElementById('quiz-timer');
  var timerClock = document.getElementById('timer-clock');
  var timerDeadline = 0;
  var timerFinished = false;
  var timerInterval = null;
  var TIMER_KEY = 'quiz-deadline:' + CFG.slug;

  function tickTimer() {
    if (!timerClock) return;
    var remain = Math.max(0, Math.floor((timerDeadline - Date.now()) / 1000));
    var mm = String(Math.floor(remain / 60)).padStart(2, '0');
    var ss = String(remain % 60).padStart(2, '0');
    timerClock.textContent = mm + ':' + ss;
    timerBox.classList.toggle('q-timer-danger', remain <= 60 && remain > 0);
    if (remain <= 0 && !timerFinished) {
      timerFinished = true;
      try { localStorage.removeItem(TIMER_KEY); } catch (err) {}
      if (form && form.requestSubmit) form.requestSubmit();
      else if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }

  buildNav();
  Array.prototype.slice.call(document.querySelectorAll('[data-order]')).forEach(renumberOrder);
  refresh();

  function renderMath(scope) {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(scope || document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } catch (err) {}
  }

  function highlightCode(scope) {
    if (!window.hljs) return;
    try {
      (scope || document).querySelectorAll('pre.q-code code').forEach(function (block) { hljs.highlightElement(block); });
    } catch (err) {}
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('q-hidden');
    window.scrollTo(0, 0);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    alertBox.classList.add('q-hidden');

    var name = nameInput.value.trim();
    if (!name) {
      showAlert('Isi nama dulu ya sebelum mengirim jawaban.');
      nameInput.focus();
      return;
    }
    var className = classInput ? classInput.value.trim() : '';
    if (CFG.identityFields === 'name_class' && !className) {
      showAlert('Isi kelas dulu ya sebelum mengirim jawaban.');
      classInput.focus();
      return;
    }
    // Bug lama (checklist bagian 2): setItem(KEY, ...) dengan KEY tak terdefinisi
    // melempar ReferenceError yang tertelan catch kosong, jadi nama tidak
    // pernah tersimpan saat submit. Simpan keduanya dengan kunci yang benar.
    try { localStorage.setItem(NAME_KEY, name); } catch (err) {}
    if (className) {
      try { localStorage.setItem(CLASS_KEY, className); } catch (err) {}
    }

    var cards = cardList();
    var answers = readAnswers();
    var blank = answers.filter(function (answer, index) {
      return !isAnswered(cards[index].getAttribute('data-type'), answer.value);
    }).length;
    if (blank > 0 && !window.confirm('Masih ada ' + blank + ' soal yang belum dijawab. Kirim sekarang?')) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengirim...';

    fetch('/api/submit/' + encodeURIComponent(CFG.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_name: name, student_class: className, quiz_title: CFG.title, answers: answers })
    })
      .then(function (response) {
        return response.json().then(function (data) { return { ok: response.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Server menolak jawaban ini.');
        }
        showResult(result.data.grading, className ? name + ' — ' + className : name);
      })
      .catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Jawaban';
        showAlert('Jawaban gagal dikirim (' + error.message + '). Coba klik kirim sekali lagi — jawabanmu masih ada di halaman ini.');
      });
  });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showResult(grading, name) {
    if (!grading) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Kirim Jawaban';
      showAlert('Jawaban tersimpan, tapi nilainya belum bisa dihitung. Beritahu gurumu ya.');
      return;
    }

    quizView.classList.add('q-hidden');
    actionBar.classList.add('q-hidden');
    navPanel.classList.add('q-hidden');
    if (navFab) navFab.classList.add('q-hidden');
    resultView.classList.remove('q-hidden');
    resultView.innerHTML = '';
    window.scrollTo(0, 0);

    var head = el('div', 'q-result-head');
    var circle = el('div', 'q-score');
    circle.appendChild(el('div', 'q-score-num', String(grading.points_total ? grading.score : '—')));
    circle.appendChild(el('div', 'q-score-label', 'Nilai'));
    head.appendChild(circle);
    head.appendChild(el('p', null, 'Nama: ' + name));

    var badge;
    if (grading.essay_pending > 0) badge = el('span', 'q-badge q-badge-wait', 'Menunggu koreksi esai');
    else if (grading.lulus) badge = el('span', 'q-badge q-badge-pass', 'LULUS (KKM ' + grading.passing_score + ')');
    else badge = el('span', 'q-badge q-badge-fail', 'BELUM LULUS (KKM ' + grading.passing_score + ')');
    head.appendChild(badge);

    var scoreLine = 'Poin soal objektif: ' + grading.points_earned + ' / ' + grading.points_total;
    if (grading.full_points > grading.points_total) scoreLine += '  •  total dengan esai: ' + grading.full_points;
    head.appendChild(el('p', 'q-result-line', scoreLine));

    if (grading.essay_pending > 0) {
      head.appendChild(el('p', 'q-result-line', grading.essay_pending + ' soal esai akan dikoreksi guru, jadi nilaimu masih bisa berubah.'));
    }
    resultView.appendChild(head);

    var list = el('ol', 'q-review');
    (grading.detail || []).forEach(function (item) {
      var points = Math.round((item.poin || 0) * 100) / 100;
      var partial = !item.benar && item.benar !== null && points > 0;
      var cls = item.benar === null ? 'q-pending' : (item.benar ? 'q-ok' : partial ? 'q-partial' : 'q-no');
      var status = item.benar === null
        ? 'Belum dinilai'
        : item.benar
          ? 'Benar (+' + points + ')'
          : partial
            ? 'Sebagian benar (+' + points + ')'
            : 'Salah';
      var row = el('li', 'q-review-item ' + cls);
      row.appendChild(el('span', 'q-review-status', status));

      var questionNode = el('div', 'q-review-q');
      questionNode.innerHTML = '<strong>Soal ' + item.no + '.</strong> ' + (item.question_html || '');
      row.appendChild(questionNode);

      row.appendChild(el('div', 'q-review-a', 'Jawabanmu: ' + (item.jawaban ? item.jawaban : '(kosong)')));
      if (item.kunci) row.appendChild(el('div', 'q-review-key', 'Kunci: ' + item.kunci));

      // Soal kategori: tandai pernyataan mana yang keliru.
      if (item.statements && item.statements.length) {
        var table = el('table', 'q-review-statements');
        var head = el('thead');
        // Judul kolom menyesuaikan tipe soal (pernyataan / langkah / sel / kata).
        var headRow = el('tr');
        headRow.appendChild(el('th', null, item.row_label || 'Pernyataan'));
        headRow.appendChild(el('th', null, 'Jawabanmu'));
        headRow.appendChild(el('th', null, 'Kunci'));
        head.appendChild(headRow);
        table.appendChild(head);
        var body = el('tbody');
        item.statements.forEach(function (statement) {
          var line = el('tr', statement.benar ? 'q-ok' : 'q-no');
          line.appendChild(el('td', null, statement.text));
          line.appendChild(el('td', null, statement.jawaban));
          line.appendChild(el('td', null, statement.kunci));
          body.appendChild(line);
        });
        table.appendChild(body);
        row.appendChild(table);
      }

      if (CFG.showExplanation !== false && item.pembahasan) {
        var expl = el('div', 'q-review-expl');
        expl.innerHTML = '<strong>Pembahasan</strong>' + item.pembahasan;
        row.appendChild(expl);
      }
      list.appendChild(row);
    });
    resultView.appendChild(list);

    var actions = el('div', 'q-no-print');
    actions.style.marginTop = '20px';
    actions.style.display = 'flex';
    actions.style.gap = '10px';

    var again = el('button', 'q-btn q-btn-ghost', 'Kerjakan Ulang');
    again.type = 'button';
    again.addEventListener('click', function () { window.location.reload(); });

    var printBtn = el('button', 'q-btn', 'Cetak / Simpan PDF');
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () { window.print(); });

    actions.appendChild(again);
    actions.appendChild(printBtn);
    resultView.appendChild(actions);

    renderMath(resultView);
  }

  renderMath(document.body);
  highlightCode(document);
})();
  </script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* Lembar cetak (Print to PDF)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Naskah soal versi cetak (A4) dari kuis JSON. Kartu soal dirender STATIS —
 * tanpa input/select/button — supaya bisa dikerjakan siswa di atas kertas. Urutan
 * opsi mengikuti urutan yang tampil di aplikasi (sudah diacak deterministik di
 * parser), jadi cetakannya konsisten dengan kunci tersimpan.
 * `showKunci` menambahkan blok "Kunci" (+ pembahasan) untuk pegangan guru.
 */
export function renderPrintSheet(
  quiz: QuizSpec,
  slug: string,
  options: { showKunci?: boolean; layout?: '1col' | '2col'; auto?: boolean } = {}
): string {
  const showKunci = !!options.showKunci;
  const twoColumns = options.layout === '2col';
  const autoPrint = !!options.auto;
  const features = new Set(quiz.features);
  const mediaBase = mediaBaseFor(slug);

  const levelCounts = new Map<string, number>();
  for (const question of quiz.questions) {
    if (!question.level) continue;
    levelCounts.set(question.level, (levelCounts.get(question.level) ?? 0) + 1);
  }
  const levelLine = levelCounts.size
    ? ` • ${[...levelCounts.entries()].map(([level, count]) => `${escapeHtml(level)} ${count}`).join(' • ')}`
    : '';

  const staticBody = (question: QuizQuestion): string => {
    const letter = (index: number) => `<span class="q-print-optkey">${escapeHtml(optionLetter(index))}.</span>`;

    if (question.type === 'choice' || question.type === 'multi' || question.type === 'true_false') {
      return `<ol class="q-print-opts">${question.options
        .map((option, index) => `<li>${letter(index)}<span>${inlineRich(option, features, mediaBase)}</span></li>`)
        .join('')}</ol>`;
    }

    if (question.type === 'category') {
      const rows = question.statements
        .map((statement, index) => {
          const mark = showKunci && statement.answer ? '✓' : '';
          return `<tr data-statement="${index}"><td class="q-matrix-text"><span class="q-matrix-no">${index + 1}</span>${inlineRich(statement.text, features, mediaBase)}</td><td class="q-print-mark">${mark}</td><td class="q-print-mark">${!mark && showKunci && !statement.answer ? '✓' : ''}</td></tr>`;
        })
        .join('');
      return `<div class="q-matrix-wrap"><table class="q-matrix">
        <thead><tr><th>Pernyataan</th><th>${escapeHtml(question.labels[0])}</th><th>${escapeHtml(question.labels[1])}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    }

    if (question.type === 'matching') {
      const cols = question.options
        .map(
          (left, index) =>
            `<div class="q-print-match-row"><span class="q-match-left"><span class="q-match-no">${index + 1}</span><span class="q-opt-text">${inlineRich(left, features, mediaBase)}</span></span><span class="q-print-gap"></span><span class="q-print-right">${optionLetter(index)}) ${escapeHtml(
              question.rights[index] ?? ''
            )}</span></div>`
        )
        .join('');

      const kunciNote =
        showKunci && question.keyLabel
          ? `<div class="q-print-line-note">${escapeHtml(question.keyLabel)}</div>`
          : '';
      return `<div class="q-print-match"><div class="q-match-head"><span>Pernyataan</span><span></span><span>Pasangan</span></div>${cols}</div>${kunciNote}`;
    }

    if (question.type === 'ordering') {
      return `<div class="q-ord">${question.options
        .map(
          (option, index) =>
            `<div class="q-ord-row"><span class="q-ord-pos"><span class="q-print-ord-box">&nbsp;</span></span><span class="q-ord-text">${inlineRich(option, features, mediaBase)}</span></div>`
        )
        .join('')}</div>`;
    }

    if (question.type === 'table_fill') {
      const width = Math.max(
        question.tableRows.reduce((max, row) => Math.max(max, row.length), 0),
        question.tableHeaders.length
      );
      const columns = Array.from({ length: width }, (_unused, index) => question.tableHeaders[index] ?? '');
      const hasHead = columns.some((column) => column.trim() !== '');
      const head = hasHead
        ? `<thead><tr>${columns.map((column) => `<th>${inlineRich(column, features, mediaBase)}</th>`).join('')}</tr></thead>`
        : '';
      const body = question.tableRows
        .map((row) => {
          const cells = columns
            .map((_column, index) => {
              const cell = row[index] ?? '';
              const blank = /^@@BLANK(\d+)@@$/.exec(cell);
              if (!blank) return `<td>${inlineRich(cell, features, mediaBase)}</td>`;
              const blankIndex = Number(blank[1]);
              return `<td><span class="q-print-blank">${showKunci ? escapeHtml(question.blanks[blankIndex]?.accepted[0] ?? '...') : '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'}</span></td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<div class="q-table-wrap"><table class="q-table q-table-fill">${head}<tbody>${body}</tbody></table></div>`;
    }

    if (question.type === 'two_tier') {
      const group = (label: string, choices: string[]) =>
        `<p class="q-tier-label">${label}</p><ol class="q-print-opts">${choices
          .map((choice, index) => `<li>${letter(index)}<span>${inlineRich(choice, features, mediaBase)}</span></li>`)
          .join('')}</ol>`;
      return `<div class="q-tier">${group('1. Pilih pernyataan', question.options)}</div><div class="q-tier">${group('2. Pilih alasan yang mendukung', question.reasons)}</div>`;
    }

    if (question.type === 'highlight') {
      const body = question.segments
        .map((segment) => {
          if (!segment.selectable) return escapeHtml(segment.text);
          if (showKunci && segment.answer) return `<strong>${escapeHtml(segment.text)}</strong>`;
          return `<span class="q-print-token">${escapeHtml(segment.text)}</span>`;
        })
        .join('');
      return `<div class="q-passage">${body}</div>`;
    }

    if (question.type === 'short') {
      return `<div class="q-print-line"></div>`;
    }

    return `<div class="q-print-essay"></div>`;
  };

  let order = 0;
  const sheets = quiz.questions
    .map((question) => {
      const reading = question.stimulusContent
        ? renderStimulusCard(
            question.stimulusTitle || `Bacaan ${order + 1}`,
            question.stimulusContent,
            features,
            mediaBase,
            question.id,
            ++order
          )
        : '';
      const kunci = showKunci
        ? `<div class="q-print-key"><strong>Kunci:</strong>${escapeHtml(question.keyLabel || '-')}</div>` +
          (question.explanation
            ? `<div class="q-print-key q-print-explain"><strong>Pembahasan:</strong>${renderRichText(question.explanation, features, mediaBase)}</div>`
            : '')
        : '';
      return `<div class="q-group">${reading}<div class="q-card"><div class="q-card-head"><span class="q-num">${question.no}</span><div class="q-text">${renderRichText(question.question, features, mediaBase)}${question.level ? ` <span class="q-tag q-tag-level">${escapeHtml(question.level)}</span>` : ''}</div></div>${staticBody(question)}${kunci}</div></div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cetak — ${escapeHtml(quiz.title || 'Kuis')}</title>
  ${FAVICON_TAGS}
  <link rel="stylesheet" href="/vendor/quiz.css">
  ${features.has('math') ? `<link rel="stylesheet" href="${KATEX_BASE}/katex.min.css">` : ''}
  <style>
    .q-print-body { padding: 24px 18px; }
    .q-print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
    .q-print-header h1 { margin: 0 0 4px; font-size: 19px; }
    .q-print-header p { margin: 0; font-size: 12px; color: #222; }
    .q-print-key { margin-top: 10px; padding: 8px 10px; border: 1px dashed #555; background: #f4f4f4; font-size: 12.5px; }
    .q-print-key strong { margin-right: 6px; }
    .q-print-explain { margin-top: 6px; }
    .q-print-biodata { display: flex; flex-wrap: wrap; column-gap: 28px; row-gap: 5px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #bbb; }
    .q-print-field { display: flex; align-items: baseline; min-width: 240px; font-size: 13px; }
    .q-print-field label { width: 128px; flex: none; font-weight: 600; }
    .q-print-field span { flex: 1; min-width: 150px; height: 18px; border-bottom: 1px solid #000; }
    .q-print-line { height: 26px; border-bottom: 1px solid #000; margin-top: 12px; }
    .q-print-essay { height: 130px; border: 1px solid #ccc; margin-top: 12px; }
    .q-print-blank { display: inline-block; min-width: 110px; border-bottom: 1px solid #000; }
    .q-print-token { border-bottom: 1px solid #000; }
    .q-print-ord-box { display: inline-block; width: 20px; height: 22px; border: 1px solid #000; }
    .q-print-mark { width: 44px; text-align: center; }
    .q-print-match { margin-top: 12px; }
    .q-print-match-row { display: grid; grid-template-columns: 1fr 34px 1fr; align-items: start; gap: 6px; padding: 4px 0; }
    .q-print-gap { border-bottom: 1px solid #bbb; height: 18px; }
    .q-print-right { padding-left: 8px; }
    .q-print-line-note { margin-top: 10px; font-size: 12px; color: #333; }
    ol.q-print-opts { margin: 8px 0 0; padding-left: 20px; }
    ol.q-print-opts li { margin: 4px 0; }
    .q-print-optkey { margin-right: 8px; }
    .q-print-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 16px; padding: 10px 12px; background: #0f172a; color: #e2e8f0; border-radius: 10px; font-size: 13px; }
    .q-print-bar-label { margin-right: auto; color: #94a3b8; }
    .q-print-seg { display: inline-flex; border: 1px solid #475569; border-radius: 8px; overflow: hidden; }
    .q-print-seg button { padding: 6px 14px; background: #1e293b; color: #94a3b8; border: none; cursor: pointer; font-size: 12.5px; }
    .q-print-seg button:hover { color: #fff; }
    .q-print-seg button.on { background: #7c3aed; color: #fff; }
    .q-print-run { padding: 6px 14px; background: #7c3aed; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 12.5px; font-weight: 600; }
    .q-print-cols { column-count: 1; column-gap: 28px; }
    .q-print-cols.is-2col { column-count: 2; }
    .q-print-cols .q-group, .q-print-cols .q-card, .q-print-cols .q-stimulus { break-inside: avoid; }
    .q-print-foot { margin-top: 26px; font-size: 11px; color: #555; text-align: center; }
    @page { size: A4; margin: 10mm; }
  </style>
</head>
<body>
  <header class="q-print-header">
    <h1>${escapeHtml(quiz.title || 'Kuis')}</h1>
    <p>${quiz.questions.length} soal${levelLine}</p>
    ${quiz.description && !showKunci ? `<p style="margin-top:6px">${renderRichText(quiz.description, features, mediaBase)}</p>` : ''}
  </header>

  <main class="q-print-body">
    ${showKunci ? '' : `
    <div class="q-print-biodata">
      <div class="q-print-field"><label>Nama</label><span></span></div>
      <div class="q-print-field"><label>Kelas</label><span></span></div>
      <div class="q-print-field"><label>Nomor Absen</label><span></span></div>
      <div class="q-print-field"><label>Tanggal</label><span></span></div>
    </div>`}
    ${
      autoPrint
        ? ''
        : `<div class="q-print-bar q-no-print" data-cols-bar>
      <span class="q-print-bar-label">Tata letak</span>
      <span class="q-print-seg">
        <button type="button" data-cols="1col" class="${twoColumns ? '' : 'on'}">1 Kolom</button>
        <button type="button" data-cols="2col" class="${twoColumns ? 'on' : ''}">2 Kolom</button>
      </span>
      <button type="button" id="print-run" class="q-print-run">Cetak / Simpan PDF</button>
    </div>`
    }
    <div class="q-print-cols${twoColumns ? ' is-2col' : ''}">
      ${sheets}
    </div>
    <p class="q-print-foot">Dicetak dari /p/${escapeHtml(slug)}</p>
  </main>

  ${features.has('math') ? `<script src="${KATEX_BASE}/katex.min.js"></script><script src="${KATEX_BASE}/contrib/auto-render.min.js"></script>` : ''}
  <script>
  (function () {
    ${features.has('math') ? `
    function renderMath(scope) {
      if (typeof renderMathInElement !== 'function') return;
      try {
        renderMathInElement(scope || document.body, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (err) {}
    }
    renderMath(document.body);` : ''}
    ${
      autoPrint
        ? `window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });`
        : `(function () {
      var cols = document.querySelector('.q-print-cols');
      var bar = document.querySelector('[data-cols-bar]');
      if (!cols || !bar) return;
      var seg = bar.querySelectorAll('[data-cols]');
      seg.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var isTwo = btn.getAttribute('data-cols') === '2col';
          cols.classList.toggle('is-2col', isTwo);
          seg.forEach(function (b) { b.classList.toggle('on', b === btn); });
        });
      });
      var run = document.getElementById('print-run');
      if (run) run.addEventListener('click', function () { window.print(); });
    })();`
    }
  })();
  </script>
</body>
</html>`;
}

