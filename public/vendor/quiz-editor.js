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
    ['true_false', 'Benar / Salah'],
    ['short', 'Isian singkat'],
    ['essay', 'Esai (dikoreksi guru)']
  ];

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
        '<input type="' + (isMulti ? 'checkbox' : 'radio') + '" name="ans-' + index + '" value="' + j + '"' +
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

  function answerArea(q, index) {
    var type = typeOf(q);
    if (type === 'choice' || type === 'multi') return optionRows(q, index);

    if (type === 'true_false') {
      return '<div class="flex items-center gap-4 text-sm">' +
        '<span class="text-xs text-slate-400">Kunci:</span>' +
        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf-' + index + '" value="true"' + (q.answer === true ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500"> Benar</label>' +
        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf-' + index + '" value="false"' + (q.answer === false ? ' checked' : '') + ' class="w-4 h-4 accent-orange-500"> Salah</label>' +
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

    if (field === 'question') q.question = el.value;
    else if (field === 'points') q.points = Number(el.value) > 0 ? Number(el.value) : 1;
    else if (field === 'options') optionsOf(q)[Number(el.getAttribute('data-opt'))] = el.value;
    else if (field === 'short') q.answer = el.value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean);
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
      if (typeOf(q) !== 'choice' && typeOf(q) !== 'multi') return;
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

  render();
})();
