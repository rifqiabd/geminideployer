/* ==========================================================================
 * Generator halaman kuis (vanilla JS, tanpa CDN kecuali math/code).
 * ========================================================================== */

import { escapeHtml, mediaBaseFor, optionLetter } from './quiz-util.ts';
import { inlineRich, renderRichText } from './quiz-rich.ts';
import { HLJS_BASE, KATEX_BASE } from './quiz-types.ts';
import type { Feature, QuizQuestion, QuizSpec, QuizStimulus } from './quiz-types.ts';


/* -------------------------------------------------------------------------- */
/* Generator halaman kuis                                                     */
/* -------------------------------------------------------------------------- */

/** Kartu bacaan/stimulus bersama, ditampilkan sekali di atas kelompok soalnya. */
export function renderStimulusCard(stimulus: QuizStimulus, features: Set<Feature>, mediaBase: string, order: number): string {
  return `
    <section class="q-stimulus" id="stim-${escapeHtml(stimulus.id)}">
      <div class="q-stimulus-head">
        <span class="q-stimulus-badge">Bacaan ${order}</span>
        <h2>${escapeHtml(stimulus.title)}</h2>
      </div>
      <div class="q-stimulus-body">${renderRichText(stimulus.content, features, mediaBase)}</div>
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
  const jumpHtml = question.stimulusId
    ? ` <a class="q-jump" href="#stim-${escapeHtml(question.stimulusId)}"><i class="q-jump-icon"></i>Lihat bacaan</a>`
    : '';

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
        <div class="q-text">${renderRichText(question.question, features, mediaBase)}${levelHtml}${tagHtml}${jumpHtml}</div>
        <button type="button" class="q-flag" data-flag aria-pressed="false" title="Tandai soal ini ragu-ragu">Ragu</button>
      </div>
      ${controls}
    </div>`;
}



export function renderQuizApp(quiz: QuizSpec, slug: string): string {
  const features = new Set(quiz.features);
  const mediaBase = mediaBaseFor(slug);

  // Soal dikelompokkan mengikuti bacaan bersamanya, supaya satu stimulus tampil
  // SEKALI di atas kelompok soalnya — bukan diulang di tiap soal (seperti naskah
  // TKA: "Stimulus 1 untuk soal 1-3").
  const groups: Array<{ stimulus: QuizStimulus | null; questions: QuizQuestion[] }> = [];
  const groupSlot = new Map<string, number>();
  for (const question of quiz.questions) {
    const slot = groupSlot.get(question.stimulusId);
    if (slot !== undefined) {
      groups[slot].questions.push(question);
      continue;
    }
    groupSlot.set(question.stimulusId, groups.length);
    groups.push({
      stimulus: question.stimulusId
        ? quiz.stimuli.find((stimulus) => stimulus.id === question.stimulusId) ?? null
        : null,
      questions: [question],
    });
  }

  let stimulusOrder = 0;
  const cards = groups
    .map((group) => {
      const body = group.questions.map((question) => renderQuestionCard(question, features, mediaBase)).join('');
      if (!group.stimulus) return `<div class="q-group">${body}</div>`;
      stimulusOrder += 1;
      // Bacaan ditaruh di kolom kiri saat layar lebar, jadi siswa bisa membaca
      // sambil menjawab tanpa menggulir bolak-balik (gaya aplikasi ujian).
      return `<div class="q-group q-group-split">
        <div class="q-group-side">${renderStimulusCard(group.stimulus, features, mediaBase, stimulusOrder)}</div>
        <div class="q-group-body">${body}</div>
      </div>`;
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

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(quiz.title || 'Kuis')}</title>
  <link rel="stylesheet" href="/vendor/quiz.css">
  ${headExtra}
</head>
<body>
  <header class="q-header">
    <div class="q-header-inner">
      <div class="q-logo">
        <svg viewBox="0 0 24 24"><path d="M9 11l2 2 4-4"></path><path d="M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"></path></svg>
      </div>
      <div>
        <h1>${escapeHtml(quiz.title || 'Kuis')}</h1>
        <p>${quiz.questions.length} soal • nilai minimal lulus ${quiz.passingScore}${levelLine}</p>
      </div>
    </div>
  </header>

  <main class="q-wrap">
    <div class="q-shell">
      <div class="q-main">
        <div id="quiz-view">
          <div class="q-card">
            <label class="q-idlabel" for="student-name">Nama siswa</label>
            <input class="q-input" id="student-name" type="text" autocomplete="off" placeholder="Tulis nama lengkap dan kelas...">
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

  try { if (localStorage.getItem(NAME_KEY)) nameInput.value = localStorage.getItem(NAME_KEY); } catch (err) {}

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
    if (name) store(ATTEMPT_KEY, { name: name, answers: readAnswers(), flags: flags });
  }

  form.addEventListener('input', function () {
    var name = nameInput.value.trim();
    if (name) store(NAME_KEY, name);
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
      } catch (err) {}
      flags = {};
      resumeBox.classList.add('q-hidden');
      refresh();
    });
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
    try { localStorage.setItem(KEY, name); } catch (err) {}

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
      body: JSON.stringify({ student_name: name, quiz_title: CFG.title, answers: answers })
    })
      .then(function (response) {
        return response.json().then(function (data) { return { ok: response.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Server menolak jawaban ini.');
        }
        showResult(result.data.grading, name);
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

