/* ==========================================================================
   quiz-editor.js — editor soal untuk aplikasi mode "JSON Soal".
   Dipakai oleh halaman /p/<slug>/edit. Data awal disuntik oleh server lewat
   window.QUIZ_EDITOR = { slug, source, synthesized }.

   Aturan penting: objek soal diedit DI TEMPAT (mutasi), jadi field yang belum
   dikenal (id, points, atau tambahan dari Gemini) tidak hilang saat disimpan.
   ========================================================================== */
(function () {
  var boot = window.QUIZ_EDITOR || {};
  var SLUG = boot.slug || '';
  var state = boot.source && typeof boot.source === 'object' ? boot.source : {};
  if (!Array.isArray(state.questions)) state.questions = [];

  var TYPES = [
    ['choice', 'Pilihan ganda'],
    ['multi', 'PG kompleks (banyak jawaban)'],
    ['category', 'PG kompleks kategori (tabel Benar/Salah)'],
    ['true_false', 'Benar / Salah'],
    ['matching', 'Menjodohkan'],
    ['ordering', 'Mengurutkan'],
    ['table_fill', 'Melengkapi tabel'],
    ['two_tier', 'Pernyataan + alasan'],
    ['highlight', 'Pilih kata di bacaan'],
    ['short', 'Isian singkat'],
    ['essay', 'Esai (dikoreksi guru)']
  ];

  // Soal mengurutkan boleh ditulis dengan `items` (daftar apa adanya) + `answer`
  // (urutan benarnya). Supaya guru cuma mengedit satu daftar, urutannya
  // dipindahkan ke `items` begitu dibuka — renderer tetap mengacaknya untuk siswa.
  state.questions.forEach(function (q) {
    if (typeOf(q) !== 'ordering') return;
    var items = Array.isArray(q.items) ? q.items : [];
    var raw = q.answer;
    var answer = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]);
    if (!items.length || !answer.length) return;
    var ordered = [];
    answer.forEach(function (entry) {
      var index = -1;
      for (var i = 0; i < items.length; i++) if (normText(items[i]) === normText(entry)) { index = i; break; }
      var text = String(entry).trim();
      if (index < 0 && /^[A-Za-z]$/.test(text)) index = text.toUpperCase().charCodeAt(0) - 65;
      if (index >= 0 && index < items.length && ordered.indexOf(items[index]) < 0) ordered.push(items[index]);
    });
    if (ordered.length === items.length) {
      q.items = ordered;
      delete q.answer;
    }
  });

  var listEl = document.getElementById('qe-questions');
  var banner = document.getElementById('qe-banner');
  var countEl = document.getElementById('qe-count');
  var saveBtn = document.getElementById('qe-save');
  var previewEl = document.getElementById('qe-preview');
  var dirty = false;

  /* ---------------------------------------------------------------- util */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function letter(index) { return String.fromCharCode(65 + index); }
  function normText(value) { return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function optionsOf(q) { if (!Array.isArray(q.options)) q.options = []; return q.options; }
  function typeOf(q) { return q.type || 'choice'; }

  /** Satu boolean dari kunci yang boleh ditulis sebagai `true`, `[true]`,
      `[false, true]`, `"false, true"`, atau `"benar/salah"`. Nilai pertama yang
      dikenal dipakai. Mengembalikan null kalau tidak mengandung boolean sama sekali. */
  function truthOf(value) {
    if (value === true) return true;
    if (value === false) return false;
    if (Array.isArray(value)) return value.length ? truthOf(value[0]) : null;
    if (value === undefined || value === null || value === '') return null;
    var parts = String(value).split(/[,/|;]/);
    for (var i = 0; i < parts.length; i++) {
      var text = normText(parts[i]);
      if (['true', 'benar', 'betul', 'b', 'ya', 'yes', 'y', '1'].indexOf(text) >= 0) return true;
      if (['false', 'salah', 's', 'tidak', 'no', 'n', '0'].indexOf(text) >= 0) return false;
    }
    return null;
  }

  /** Indeks pilihan yang dikunci. Menerima huruf, angka, atau teks pilihan. */
  function answerIndexes(q) {
    var opts = optionsOf(q);
    var raw = q.answer;
    var list = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var value = list[i];
      var index = -1;
      if (typeof value === 'number' && Number.isInteger(value)) {
        index = value;
      } else {
        var text = String(value).trim();
        for (var j = 0; j < opts.length; j++) {
          if (normText(opts[j]) === normText(text)) { index = j; break; }
        }
        if (index < 0 && /^[A-Za-z]$/.test(text)) index = text.toUpperCase().charCodeAt(0) - 65;
        if (index < 0 && /^[0-9]+$/.test(text)) index = Number(text);
      }
      if (index >= 0 && index < opts.length && out.indexOf(index) < 0) out.push(index);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function shortAnswers(q) {
    if (Array.isArray(q.answer)) return q.answer.map(String).filter(function (v) { return v.trim(); });
    if (q.answer === undefined || q.answer === null || q.answer === '') return [];
    return String(q.answer).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  }

  /** Tulisan di kolom gambar: `media:tumbuhan` ditampilkan sebagai `tumbuhan`. */
  function imageText(q) {
    var raw = q.image;
    if (raw && typeof raw === 'object') raw = raw.media || raw.src || raw.url || '';
    raw = String(raw || '').trim().replace(/^media:\s*/i, '');
    return raw;
  }

  function setPick(q, indexes) {
    if (typeOf(q) === 'multi') q.answer = indexes.map(letter);
    else if (indexes.length) q.answer = letter(indexes[0]);
    else delete q.answer;
  }

  /* -------------------------------------------------------------- render */
  function typeSelect(q, index) {
    var html = '<select data-index="' + index + '" data-field="type" class="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-medium">';
    for (var i = 0; i < TYPES.length; i++) {
      html += '<option value="' + TYPES[i][0] + '"' + (typeOf(q) === TYPES[i][0] ? ' selected' : '') + '>' + TYPES[i][1] + '</option>';
    }
    return html + '</select>';
  }

  function optionRows(q, index) {
    var opts = optionsOf(q);
    var picked = answerIndexes(q);
    var isMulti = typeOf(q) === 'multi';
    var html = '<div class="space-y-1.5">';
    for (var j = 0; j < opts.length; j++) {
      html += '<div class="flex items-center gap-2">' +
        '<input type="' + (isMulti ? 'checkbox' : 'radio') + '" name="ans-' + index + '" value="' + j + '" data-index="' + index + '"' +
        (picked.indexOf(j) >= 0 ? ' checked' : '') +
        ' class="w-4 h-4 accent-orange-500 flex-none" title="Tandai sebagai kunci jawaban">' +
        '<span class="w-6 h-6 flex-none grid place-items-center rounded-md bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-400">' + letter(j) + '</span>' +
        '<input data-index="' + index + '" data-opt="' + j + '" data-field="options" value="' + esc(opts[j]) + '" placeholder="Teks pilihan ' + letter(j) + '" class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        '<button type="button" data-action="remove-option" data-index="' + index + '" data-opt="' + j + '" title="Hapus pilihan" class="p-2 bg-slate-700/40 hover:bg-rose-600/30 text-slate-400 hover:text-rose-300 rounded-lg text-xs"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>';
    }
    html += '</div>';
    html += '<button type="button" data-action="add-option" data-index="' + index + '" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-plus mr-1"></i>Tambah pilihan</button>';
    return html;
  }

  /** Indeks alasan yang dikunci (khusus soal two_tier). */
  function reasonIndexes(q) {
    var list = Array.isArray(q.reasons) ? q.reasons : [];
    var raw = q.reason_answer;
    var values = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]);
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var text = String(values[i]).trim();
      var index = -1;
      for (var j = 0; j < list.length; j++) if (normText(list[j]) === normText(text)) { index = j; break; }
      if (index < 0 && /^[A-Za-z]$/.test(text)) index = text.toUpperCase().charCodeAt(0) - 65;
      if (index < 0 && /^[0-9]+$/.test(text)) index = Number(text);
      if (index >= 0 && index < list.length && out.indexOf(index) < 0) out.push(index);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * Daftar teks yang bisa ditambah/dihapus. Dipakai untuk item soal mengurutkan
   * dan pilihan alasan two_tier. `keyName` diisi kalau daftarnya punya kunci
   * tunggal (radio), jadi dua tipe bisa memakai editor yang sama.
   */
  function listEditor(q, index, field, placeholder, addLabel, keyName, picked, keyTitle) {
    var list = Array.isArray(q[field]) ? q[field] : (q[field] = []);
    var html = '<div class="space-y-1.5">';
    for (var j = 0; j < list.length; j++) {
      html += '<div class="flex items-center gap-2">';
      if (keyName) {
        html += '<input type="radio" name="' + keyName + '" value="' + j + '" data-index="' + index + '"' +
          (picked.indexOf(j) >= 0 ? ' checked' : '') +
          ' class="w-4 h-4 accent-orange-500 flex-none" title="' + esc(keyTitle || 'Kunci jawaban') + '">';
      }
      html += '<span class="w-6 h-6 flex-none grid place-items-center rounded-md bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-400">' +
          (keyName ? letter(j) : String(j + 1)) + '</span>' +
        '<input data-index="' + index + '" data-field="' + field + '" data-opt="' + j + '" value="' + esc(list[j]) +
          '" placeholder="' + esc(placeholder) + '" class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        '<button type="button" data-action="remove-list" data-field="' + field + '" data-opt="' + j +
          '" title="Hapus" class="p-2 bg-slate-700/40 hover:bg-rose-600/30 text-slate-400 hover:text-rose-300 rounded-lg text-xs"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>';
    }
    html += '</div>';
    html += '<button type="button" data-action="add-list" data-field="' + field +
      '" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-plus mr-1"></i>' + addLabel + '</button>';
    return html;
  }

  /** Tabel pernyataan Benar/Salah (tipe category). */
  function statementsEditor(q, index) {
    if (!Array.isArray(q.statements)) q.statements = [];
    var labels = Array.isArray(q.labels) && q.labels.length >= 2 ? q.labels : ['Benar', 'Salah'];
    var html = '<div class="space-y-1.5">';
    q.statements.forEach(function (statement, j) {
      var value = statement && typeof statement === 'object' ? statement : { text: statement, answer: true };
      var shown = truthOf(value.answer);
      html += '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="w-6 h-6 flex-none grid place-items-center rounded-md bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-400">' + (j + 1) + '</span>' +
        '<input data-index="' + index + '" data-field="statement-text" data-opt="' + j + '" value="' + esc(value.text) +
          '" placeholder="Tulis pernyataan..." class="flex-1 min-w-[180px] px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        '<label class="flex items-center gap-1 text-[11px] text-slate-400"><input type="radio" name="st-' + index + '" data-index="' + index + '" data-stmt="' + j + '" value="true"' +
          (shown === true ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500">' + esc(labels[0]) + '</label>' +
        '<label class="flex items-center gap-1 text-[11px] text-slate-400"><input type="radio" name="st-' + index + '" data-index="' + index + '" data-stmt="' + j + '" value="false"' +
          (shown === false ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500">' + esc(labels[1]) + '</label>' +
        '<button type="button" data-action="remove-list" data-field="statements" data-opt="' + j +
          '" title="Hapus pernyataan" class="p-2 bg-slate-700/40 hover:bg-rose-600/30 text-slate-400 hover:text-rose-300 rounded-lg text-xs"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="flex items-center gap-3 flex-wrap">' +
      '<button type="button" data-action="add-list" data-field="statements" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-plus mr-1"></i>Tambah pernyataan</button>' +
      '<span class="text-[11px] text-slate-500">Judul kolom:</span>' +
      '<input data-index="' + index + '" data-field="labels" value="' + esc(labels.join(' / ')) +
        '" placeholder="Benar / Salah" class="w-40 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs">' +
      '</div>';
    return html;
  }

  /** Pasangan kiri-kanan (tipe matching). */
  function pairsEditor(q, index) {
    if (!Array.isArray(q.pairs)) q.pairs = [];
    var html = '<div class="space-y-1.5">';
    q.pairs.forEach(function (pair, j) {
      var value = pair && typeof pair === 'object' ? pair : { left: '', right: '' };
      html += '<div class="flex items-center gap-2">' +
        '<span class="w-6 h-6 flex-none grid place-items-center rounded-md bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-400">' + (j + 1) + '</span>' +
        '<input data-index="' + index + '" data-field="pair-left" data-opt="' + j + '" value="' + esc(value.left) +
          '" placeholder="Pernyataan kiri" class="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        '<i class="fa-solid fa-arrow-right text-slate-500 text-xs flex-none"></i>' +
        '<input data-index="' + index + '" data-field="pair-right" data-opt="' + j + '" value="' + esc(value.right) +
          '" placeholder="Pasangannya" class="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        '<button type="button" data-action="remove-list" data-field="pairs" data-opt="' + j +
          '" title="Hapus pasangan" class="p-2 bg-slate-700/40 hover:bg-rose-600/30 text-slate-400 hover:text-rose-300 rounded-lg text-xs"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>';
    });
    html += '</div>';
    return html + '<div class="flex items-center justify-between gap-2">' +
      '<button type="button" data-action="add-list" data-field="pairs" class="text-xs text-blue-400 hover:underline"><i class="fa-solid fa-plus mr-1"></i>Tambah pasangan</button>' +
      '<span class="text-[11px] text-slate-500">Kolom kanan diacak otomatis saat siswa mengerjakan.</span></div>';
  }

  /** Tabel dengan sel rumpang (tipe table_fill). */
  function tableEditor(q, index) {
    if (!Array.isArray(q.rows)) q.rows = [];
    if (!Array.isArray(q.headers)) q.headers = [];
    return '<div class="space-y-2">' +
      '<input data-index="' + index + '" data-field="headers" value="' + esc(q.headers.join(' | ')) +
        '" placeholder="Judul kolom, pisahkan dengan |  mis: Bahan | Titik lebur" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs">' +
      '<textarea data-index="' + index + '" data-field="rows" rows="4" placeholder="Timah | {327}\nTembaga | {1085 / 1.085}" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono">' +
        esc(tableRowsText(q)) + '</textarea>' +
      '<p class="text-[11px] text-slate-500">Satu baris = satu baris tabel, kolom dipisah <span class="font-mono">|</span>. Sel yang harus diisi siswa ditulis di dalam kurawal, mis. <span class="font-mono">{327}</span>. Beberapa jawaban yang diterima dipisah <span class="font-mono">/</span>.</p>' +
      '</div>';
  }

  /** `rows` -> teks yang enak diedit; sel rumpang jadi {jawaban / alternatif}. */
  function tableRowsText(q) {
    var rows = Array.isArray(q.rows) ? q.rows : [];
    return rows
      .map(function (row) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          var answers = Array.isArray(row.answer) ? row.answer : (row.answer === undefined || row.answer === null ? [] : [row.answer]);
          return String(row.label || row.text || '') + ' | {' + answers.join(' / ') + '}';
        }
        if (!Array.isArray(row)) return String(row === undefined || row === null ? '' : row);
        return row
          .map(function (cell) {
            if (cell && typeof cell === 'object') {
              var list = Array.isArray(cell.answer) ? cell.answer : (cell.answer === undefined || cell.answer === null ? [] : [cell.answer]);
              return '{' + list.join(' / ') + '}';
            }
            return String(cell === undefined || cell === null ? '' : cell);
          })
          .join(' | ');
      })
      .join('\n');
  }

  /** Teks tabel -> `rows`, sel {a / b} jadi objek kunci. */
  function parseTableRows(text) {
    return String(text || '')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        return line
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(function (cell) {
            var value = cell.trim();
            var blank = /^\{(.*)\}$/.exec(value);
            if (!blank) return value;
            return {
              answer: blank[1].split('/').map(function (part) { return part.trim(); }).filter(Boolean),
            };
          });
      });
  }

  /** Pernyataan + alasan (tipe two_tier). */
  function twoTierEditor(q, index) {
    return '<div class="space-y-2">' +
      '<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">1. Pernyataan</p>' +
      optionRows(q, index) +
      '<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mt-2">2. Pilihan alasan</p>' +
      listEditor(q, index, 'reasons', 'Tulis pilihan alasan...', 'Tambah alasan', 'reason-' + index, reasonIndexes(q), 'Kunci alasan') +
      '</div>';
  }

  /** Pilih kata di dalam bacaan (tipe highlight). */
  function highlightEditor(q, index) {
    var answers = Array.isArray(q.answer) ? q.answer : (q.answer === undefined || q.answer === null || q.answer === '' ? [] : [q.answer]);
    return '<div class="space-y-2">' +
      '<textarea data-index="' + index + '" data-field="passage" rows="3" placeholder="Tulis bacaan. Apit kata yang boleh dipilih dengan kurawal, mis: Budi {mengembalikan} uang itu kepada {guru}." class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">' +
        esc(q.text || q.passage || '') + '</textarea>' +
      '<textarea data-index="' + index + '" data-field="highlight-answer" rows="2" placeholder="Kata yang benar, satu per baris" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono">' +
        esc(answers.join('\n')) + '</textarea>' +
      '<p class="text-[11px] text-slate-500">Hanya kata di dalam kurawal yang bisa diklik siswa. Kata yang benar ditulis satu per baris di kotak kedua.</p>' +
      '</div>';
  }

  function answerArea(q, index) {
    var type = typeOf(q);
    if (type === 'choice' || type === 'multi') return optionRows(q, index);
    if (type === 'category') return statementsEditor(q, index);
    if (type === 'matching') return pairsEditor(q, index);
    if (type === 'ordering') {
      return listEditor(q, index, 'items', 'Tulis langkah...', 'Tambah langkah') +
        '<p class="text-[11px] text-slate-500">Tulis langkah dalam URUTAN YANG BENAR. Urutannya diacak otomatis saat siswa mengerjakan.</p>';
    }
    if (type === 'table_fill') return tableEditor(q, index);
    if (type === 'two_tier') return twoTierEditor(q, index);
    if (type === 'highlight') return highlightEditor(q, index);

    if (type === 'true_false') {
      var tf = truthOf(q.answer);
      return '<div class="flex items-center gap-4 text-sm">' +
        '<span class="text-xs text-slate-400">Kunci:</span>' +
        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf-' + index + '" data-index="' + index + '" value="true"' + (tf === true ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500"> Benar</label>' +
        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf-' + index + '" data-index="' + index + '" value="false"' + (tf === false ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500"> Salah</label>' +
        '</div>';
    }

    if (type === 'short') {
      return '<textarea data-index="' + index + '" data-field="short" rows="2" placeholder="Satu jawaban per baris, mis:\nfotosintesis\nproses fotosintesis" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono">' +
        esc(shortAnswers(q).join('\n')) + '</textarea>' +
        '<p class="text-[11px] text-slate-500">Semua baris dianggap benar. Pemeriksaan mengabaikan huruf besar/kecil, tanda baca, harakat Arab, dan angka Arab.</p>';
    }

    return '<p class="text-[11px] text-slate-500"><i class="fa-solid fa-user-pen mr-1"></i>Jawaban esai tidak dinilai otomatis, tapi ikut tersimpan di rekap untuk dikoreksi guru.</p>';
  }

  function renderCard(q, index) {
    return '<div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3">' +
      '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="w-7 h-7 flex-none grid place-items-center rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-slate-300">' + (index + 1) + '</span>' +
        typeSelect(q, index) +
        '<label class="flex items-center gap-1.5 text-[11px] text-slate-400">Bobot<input type="number" min="1" step="0.5" value="' + (q.points || 1) + '" data-index="' + index + '" data-field="points" class="w-16 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"></label>' +
        '<div class="ml-auto flex items-center gap-1.5">' +
          '<button type="button" data-action="up" data-index="' + index + '" title="Naikkan" class="p-2 bg-slate-700/40 hover:bg-slate-600 text-slate-300 rounded-lg text-xs"><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button type="button" data-action="down" data-index="' + index + '" title="Turunkan" class="p-2 bg-slate-700/40 hover:bg-slate-600 text-slate-300 rounded-lg text-xs"><i class="fa-solid fa-arrow-down"></i></button>' +
          '<button type="button" data-action="copy" data-index="' + index + '" title="Duplikat" class="p-2 bg-slate-700/40 hover:bg-slate-600 text-slate-300 rounded-lg text-xs"><i class="fa-solid fa-clone"></i></button>' +
          '<button type="button" data-action="del" data-index="' + index + '" title="Hapus soal" class="p-2 bg-slate-700/40 hover:bg-rose-600/40 text-slate-300 hover:text-rose-200 rounded-lg text-xs"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      '<textarea data-index="' + index + '" data-field="question" rows="2" placeholder="Tulis pertanyaan di sini..." class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm">' + esc(q.question || '') + '</textarea>' +
      '<div class="flex items-center gap-2">' +
        '<i class="fa-solid fa-image text-slate-500 text-xs"></i>' +
        '<input data-index="' + index + '" data-field="image" value="' + esc(imageText(q)) + '" placeholder="nama slot gambar, mis: tumbuhan (boleh dikosongkan)" class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono">' +
      '</div>' +
      answerArea(q, index) +
      '</div>';
  }

  function render() {
    if (!state.questions.length) {
      listEl.innerHTML = '<div class="p-10 text-center text-slate-500 text-sm bg-slate-800/40 border border-slate-800 rounded-2xl">Belum ada soal. Klik "Tambah Soal" untuk mulai.</div>';
    } else {
      listEl.innerHTML = state.questions.map(renderCard).join('');
    }
    countEl.textContent = state.questions.length + ' soal';
  }

  /* ------------------------------------------------------------ interaksi */
  function markDirty() { dirty = true; }

  listEl.addEventListener('input', function (event) {
    var el = event.target;
    var index = Number(el.getAttribute('data-index'));
    var q = state.questions[index];
    if (!q) return;
    var field = el.getAttribute('data-field');
    markDirty();

    var opt = Number(el.getAttribute('data-opt'));
    if (field === 'question') q.question = el.value;
    else if (field === 'points') q.points = Number(el.value) > 0 ? Number(el.value) : 1;
    else if (field === 'options' || field === 'items' || field === 'reasons') {
      var list = Array.isArray(q[field]) ? q[field] : (q[field] = []);
      list[opt] = el.value;
    } else if (field === 'statement-text') {
      var statements = Array.isArray(q.statements) ? q.statements : (q.statements = []);
      if (!statements[opt] || typeof statements[opt] !== 'object') statements[opt] = { text: '', answer: true };
      statements[opt].text = el.value;
    } else if (field === 'pair-left' || field === 'pair-right') {
      var pairs = Array.isArray(q.pairs) ? q.pairs : (q.pairs = []);
      if (!pairs[opt] || typeof pairs[opt] !== 'object') pairs[opt] = { left: '', right: '' };
      pairs[opt][field === 'pair-left' ? 'left' : 'right'] = el.value;
    } else if (field === 'headers') {
      q.headers = el.value.split('|').map(function (v) { return v.trim(); }).filter(Boolean);
    } else if (field === 'rows') {
      q.rows = parseTableRows(el.value);
    } else if (field === 'labels') {
      var parts = el.value.split('/').map(function (v) { return v.trim(); });
      q.labels = [parts[0] || 'Benar', parts[1] || 'Salah'];
    } else if (field === 'passage') {
      q.text = el.value;
      delete q.passage;
    } else if (field === 'highlight-answer') {
      q.answer = el.value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean);
    } else if (field === 'short') q.answer = el.value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean);
    else if (field === 'image') {
      var value = el.value.trim();
      if (!value) delete q.image;
      else if (/^https?:\/\//i.test(value) || value.charAt(0) === '/') q.image = value;
      else q.image = 'media:' + value.replace(/^media:\s*/i, '');
    }
  });

  listEl.addEventListener('change', function (event) {
    var el = event.target;
    var index = Number(el.getAttribute('data-index'));
    var q = state.questions[index];
    if (!q) return;
    markDirty();

    if (el.getAttribute('data-field') === 'type') {
      q.type = el.value;
      delete q.answer;
      if (q.type === 'choice' || q.type === 'multi') {
        if (optionsOf(q).length < 2) q.options = ['', ''];
        setPick(q, [0]);
      } else if (q.type === 'true_false') {
        q.answer = true;
      } else if (q.type === 'category') {
        if (!Array.isArray(q.statements) || q.statements.length < 2) {
          q.statements = [{ text: '', answer: true }, { text: '', answer: false }];
        }
      } else if (q.type === 'matching') {
        if (!Array.isArray(q.pairs) || q.pairs.length < 2) q.pairs = [{ left: '', right: '' }, { left: '', right: '' }];
      } else if (q.type === 'ordering') {
        if (!Array.isArray(q.items) || q.items.length < 2) q.items = ['', '', ''];
      } else if (q.type === 'table_fill') {
        q.headers = Array.isArray(q.headers) ? q.headers : ['', ''];
        if (!Array.isArray(q.rows) || !q.rows.length) q.rows = [['', '']];
      } else if (q.type === 'two_tier') {
        q.options = ['', ''];
        q.answer = 'A';
        q.reasons = ['', ''];
        q.reason_answer = 'A';
      } else if (q.type === 'highlight') {
        q.text = '';
        q.answer = [];
      } else if (q.type === 'short') {
        q.answer = [];
      }
      render();
      return;
    }

    var name = el.name || '';
    if (name.indexOf('ans-') === 0) {
      var picked = [];
      var boxes = listEl.querySelectorAll('input[name="' + name + '"]');
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(Number(boxes[i].value));
      setPick(q, picked);
    } else if (name.indexOf('tf-') === 0) {
      q.answer = el.value === 'true';
    } else if (name.indexOf('st-') === 0) {
      var stmtIndex = Number(el.getAttribute('data-stmt'));
      var stmtList = Array.isArray(q.statements) ? q.statements : (q.statements = []);
      if (!stmtList[stmtIndex] || typeof stmtList[stmtIndex] !== 'object') stmtList[stmtIndex] = { text: '', answer: true };
      stmtList[stmtIndex].answer = el.value === 'true';
    } else if (name.indexOf('reason-') === 0) {
      var reasonPicked = [];
      var reasonBoxes = listEl.querySelectorAll('input[name="' + name + '"]');
      for (var r = 0; r < reasonBoxes.length; r++) if (reasonBoxes[r].checked) reasonPicked.push(Number(reasonBoxes[r].value));
      if (reasonPicked.length) q.reason_answer = letter(reasonPicked[0]);
      else delete q.reason_answer;
    }
  });

  listEl.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!button) return;
    event.preventDefault();
    var action = button.getAttribute('data-action');
    var index = Number(button.getAttribute('data-index'));
    var q = state.questions[index];
    if (!q) return;

    if (action === 'add-list' || action === 'remove-list') {
      var field = button.getAttribute('data-field');
      var list = Array.isArray(q[field]) ? q[field] : (q[field] = []);
      if (action === 'add-list') {
        list.push(field === 'statements' ? { text: '', answer: true } : field === 'pairs' ? { left: '', right: '' } : '');
      } else {
        var removed = Number(button.getAttribute('data-opt'));
        list.splice(removed, 1);
        // Kunci yang menunjuk baris setelah baris yang dihapus harus digeser,
        // kalau tidak kuncinya pindah ke baris sebelah.
        if (field === 'reasons') {
          var kept = reasonIndexes(q)
            .filter(function (i) { return i !== removed; })
            .map(function (i) { return i > removed ? i - 1 : i; });
          if (kept.length) q.reason_answer = letter(kept[0]);
          else delete q.reason_answer;
        }
      }
      render();
      markDirty();
      return;
    }

    if (action === 'del') {
      if (!window.confirm('Hapus soal nomor ' + (index + 1) + '?')) return;
      state.questions.splice(index, 1);
      render();
    } else if (action === 'up' && index > 0) {
      state.questions[index] = state.questions[index - 1];
      state.questions[index - 1] = q;
      render();
    } else if (action === 'down' && index < state.questions.length - 1) {
      state.questions[index] = state.questions[index + 1];
      state.questions[index + 1] = q;
      render();
    } else if (action === 'copy') {
      var duplicate = JSON.parse(JSON.stringify(q));
      delete duplicate.id;
      state.questions.splice(index + 1, 0, duplicate);
      render();
    } else if (action === 'add-option') {
      optionsOf(q).push('');
      render();
    } else if (action === 'remove-option') {
      var removed = Number(button.getAttribute('data-opt'));
      var picked = answerIndexes(q);
      optionsOf(q).splice(removed, 1);
      setPick(q, picked.filter(function (i) { return i !== removed; }).map(function (i) { return i > removed ? i - 1 : i; }));
      render();
    }
    markDirty();
  });

  /* ------------------------------------------------------------- simpan */
  function normalizeForSave() {
    state.questions.forEach(function (q) {
      var type = typeOf(q);

      if (type === 'ordering') {
        // `items` = urutan benar; kunci eksplisit tidak dipakai lagi.
        q.items = (Array.isArray(q.items) ? q.items : [])
          .map(function (value) { return String(value === undefined || value === null ? '' : value).trim(); })
          .filter(Boolean);
        delete q.answer;
        return;
      }
      if (type === 'matching') {
        q.pairs = (Array.isArray(q.pairs) ? q.pairs : []).map(function (pair) {
          var value = pair && typeof pair === 'object' ? pair : {};
          return { left: String(value.left || '').trim(), right: String(value.right || '').trim() };
        });
        return;
      }
      if (type === 'table_fill') {
        q.rows = (Array.isArray(q.rows) ? q.rows : [])
          .map(function (row) {
            if (!Array.isArray(row)) return row;
            return row.map(function (cell) { return typeof cell === 'string' ? cell.trim() : cell; });
          })
          .filter(function (row) {
            if (!Array.isArray(row)) return true;
            return row.some(function (cell) { return typeof cell === 'object' || String(cell || '').trim(); });
          });
        q.headers = (Array.isArray(q.headers) ? q.headers : []).map(function (value) { return String(value || '').trim(); });
        if (!q.headers.some(Boolean)) delete q.headers;
        return;
      }
if (type === 'true_false') {
        var tf = truthOf(q.answer);
        if (tf !== null) q.answer = tf;
        else delete q.answer;
        return;
      }
      if (type === 'category') {
        // Kunci tiap pernyataan dirapikan jadi SATU boolean. Gemini kadang
        // menulis dua nilai ("answer": [true, false]) — ambil nilai pertama;
        // yang tidak mengandung boolean dibiarkan kosong supaya tertangkap
        // validasi (problems) sebelum simpan.
        q.statements = (Array.isArray(q.statements) ? q.statements : []).map(function (statement) {
          var value = statement && typeof statement === 'object' ? statement : { text: statement, answer: true };
          var text = String(value.text || '').trim();
          var truth = truthOf(value.answer);
          var clean = { text: text };
          if (truth !== null) clean.answer = truth;
          return clean;
        });
        var labels = Array.isArray(q.labels) && q.labels.length >= 2 ? q.labels : ['Benar', 'Salah'];
        q.labels = [String(labels[0] || 'Benar').trim() || 'Benar', String(labels[1] || 'Salah').trim() || 'Salah'];
        return;
      }
      if (type === 'two_tier') {
        var optionKey = answerIndexes(q)[0];
        var reasonKey = reasonIndexes(q)[0];
        var keepOptions = [];
        var mapOptions = [];
        optionsOf(q).forEach(function (option, i) {
          if (String(option || '').trim()) { mapOptions[i] = keepOptions.length; keepOptions.push(String(option).trim()); }
          else mapOptions[i] = -1;
        });
        if (keepOptions.length >= 2) {
          q.options = keepOptions;
          if (typeof optionKey === 'number' && mapOptions[optionKey] >= 0) q.answer = letter(mapOptions[optionKey]);
          else delete q.answer;
        }
        var keepReasons = [];
        var mapReasons = [];
        (Array.isArray(q.reasons) ? q.reasons : []).forEach(function (reason, i) {
          if (String(reason || '').trim()) { mapReasons[i] = keepReasons.length; keepReasons.push(String(reason).trim()); }
          else mapReasons[i] = -1;
        });
        if (keepReasons.length >= 2) {
          q.reasons = keepReasons;
          if (typeof reasonKey === 'number' && mapReasons[reasonKey] >= 0) q.reason_answer = letter(mapReasons[reasonKey]);
          else delete q.reason_answer;
        }
        return;
      }

      if (type !== 'choice' && type !== 'multi') return;
      var picked = answerIndexes(q);
      var kept = [];
      var mapping = [];
      optionsOf(q).forEach(function (option, i) {
        if (String(option || '').trim()) { mapping[i] = kept.length; kept.push(String(option).trim()); }
        else mapping[i] = -1;
      });
      q.options = kept.length ? kept : ['', ''];
      var remapped = [];
      picked.forEach(function (i) { var m = mapping[i]; if (m >= 0 && m < q.options.length && remapped.indexOf(m) < 0) remapped.push(m); });
      setPick(q, remapped);
    });
  }

  function problems() {
    var found = [];
    if (!state.questions.length) found.push('Minimal harus ada satu soal.');
    state.questions.forEach(function (q, i) {
      var no = i + 1;
      var type = typeOf(q);
      if (!String(q.question || '').trim()) found.push('Soal ' + no + ': pertanyaannya masih kosong.');
      if (type === 'choice' || type === 'multi') {
        var filled = optionsOf(q).filter(function (o) { return String(o || '').trim(); });
        if (filled.length < 2) found.push('Soal ' + no + ': butuh minimal 2 pilihan yang terisi.');
        else if (!answerIndexes(q).length) found.push('Soal ' + no + ': kunci jawabannya belum ditandai.');
      } else if (type === 'true_false') {
        if (typeof q.answer !== 'boolean') found.push('Soal ' + no + ': pilih Benar atau Salah.');
      } else if (type === 'short') {
        if (!shortAnswers(q).length) found.push('Soal ' + no + ': tulis minimal satu jawaban yang diterima.');
      } else if (type === 'category') {
        var statements = Array.isArray(q.statements) ? q.statements : [];
        if (statements.length < 2) found.push('Soal ' + no + ': butuh minimal 2 pernyataan.');
        else if (statements.some(function (s) { return !String((s && s.text) || '').trim(); }))
          found.push('Soal ' + no + ': ada pernyataan yang teksnya masih kosong.');
        else if (statements.some(function (s) { return !s || typeof s.answer !== 'boolean'; }))
          found.push('Soal ' + no + ': setiap pernyataan harus ditandai kuncinya (kolom kanan).');
      } else if (type === 'matching') {
        var pairs = Array.isArray(q.pairs) ? q.pairs : [];
        if (pairs.length < 2) found.push('Soal ' + no + ': butuh minimal 2 pasangan.');
        else if (pairs.some(function (p) { return !p || !String(p.left || '').trim() || !String(p.right || '').trim(); }))
          found.push('Soal ' + no + ': ada pasangan yang belum lengkap — isi kolom kiri dan kanannya.');
      } else if (type === 'ordering') {
        var steps = (Array.isArray(q.items) ? q.items : []).filter(function (v) { return String(v || '').trim(); });
        if (steps.length < 2) found.push('Soal ' + no + ': butuh minimal 2 langkah yang terisi.');
      } else if (type === 'table_fill') {
        var blanks = 0;
        var emptyBlank = false;
        (Array.isArray(q.rows) ? q.rows : []).forEach(function (row) {
          if (!Array.isArray(row)) return;
          row.forEach(function (cell) {
            if (!cell || typeof cell !== 'object') return;
            var answers = (Array.isArray(cell.answer) ? cell.answer : []).map(String).filter(function (v) { return v.trim(); });
            blanks += 1;
            if (!answers.length) emptyBlank = true;
          });
        });
        if (!blanks) found.push('Soal ' + no + ': belum ada sel rumpang. Tulis jawabannya di dalam kurawal, mis. {327}.');
        else if (emptyBlank) found.push('Soal ' + no + ': ada sel rumpang yang belum diberi jawaban.');
      } else if (type === 'two_tier') {
        var tierOptions = optionsOf(q).filter(function (o) { return String(o || '').trim(); });
        if (tierOptions.length < 2) found.push('Soal ' + no + ': butuh minimal 2 pilihan pernyataan.');
        else if (!answerIndexes(q).length) found.push('Soal ' + no + ': kunci pernyataannya belum ditandai.');
        var tierReasons = (Array.isArray(q.reasons) ? q.reasons : []).filter(function (v) { return String(v || '').trim(); });
        if (tierReasons.length < 2) found.push('Soal ' + no + ': butuh minimal 2 pilihan alasan.');
        else if (!reasonIndexes(q).length) found.push('Soal ' + no + ': kunci alasannya belum ditandai.');
      } else if (type === 'highlight') {
        var passage = String(q.text || '').trim();
        if (!/\{[^{}]+\}/.test(passage)) {
          found.push('Soal ' + no + ': belum ada kata yang bisa diklik — apit kata dengan kurawal, mis. {mengembalikan}.');
        } else if (!shortAnswers(q).length) {
          found.push('Soal ' + no + ': tulis minimal satu kata yang benar.');
        }
      }
    });
    return found;
  }

  function showBanner(message, kind) {
    banner.textContent = message;
    banner.classList.remove('hidden');
    banner.className = kind === 'error'
      ? 'rounded-xl p-4 text-sm bg-rose-500/15 border border-rose-500/40 text-rose-200'
      : 'rounded-xl p-4 text-sm bg-emerald-500/15 border border-emerald-500/40 text-emerald-200';
    window.scrollTo(0, 0);
  }

  function save() {
    normalizeForSave();
    render();
    var found = problems();
    if (found.length) {
      showBanner(found.join(' '), 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';

    fetch('/api/quiz/' + encodeURIComponent(SLUG) + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: JSON.stringify(state) })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Gagal menyimpan.');
        }
        dirty = false;
        showBanner('Tersimpan. Halaman kuis di /p/' + SLUG + ' sudah diperbarui (' + result.data.questions + ' soal).', 'ok');
        reloadPreview();
      })
      .catch(function (error) {
        showBanner('Gagal menyimpan: ' + error.message, 'error');
      })
      .then(function () {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Simpan Perubahan';
      });
  }

  function reloadPreview() {
    previewEl.textContent = JSON.stringify(state, null, 2);
  }

  /* --------------------------------------------------------------- wiring */
  var titleInput = document.getElementById('qe-title');
  var descInput = document.getElementById('qe-description');
  var kkmInput = document.getElementById('qe-kkm');
  titleInput.value = state.title || '';
  descInput.value = state.description || '';
  kkmInput.value = state.passing_score === undefined ? 70 : state.passing_score;

  titleInput.addEventListener('input', function () { state.title = titleInput.value; markDirty(); });
  descInput.addEventListener('input', function () { state.description = descInput.value; markDirty(); });
  kkmInput.addEventListener('input', function () { state.passing_score = Number(kkmInput.value); markDirty(); });

  document.getElementById('qe-add').addEventListener('click', function () {
    state.questions.push({ type: 'choice', question: '', options: ['', ''], answer: 'A', points: 1 });
    markDirty();
    render();
    window.scrollTo(0, document.body.scrollHeight);
  });

  document.getElementById('qe-preview-toggle').addEventListener('click', function () {
    reloadPreview();
  });

  saveBtn.addEventListener('click', save);

  window.addEventListener('beforeunload', function (event) {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Pintu untuk tes Node (tests/quiz.test.mjs) supaya logika murni editor bisa
  // diuji tanpa browser. Tidak aktif di halaman asli karena flag-nya tidak diisi.
  if (boot.exposeHelpers) {
    window.QUIZ_EDITOR_HELPERS = {
      state: state,
      parseTableRows: parseTableRows,
      tableRowsText: tableRowsText,
      normalizeForSave: normalizeForSave,
      problems: problems
    };
  }

  render();
})();
