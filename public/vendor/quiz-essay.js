/* ==========================================================================
   quiz-essay.js — interaksi halaman koreksi esai (/p/<slug>/essay).
   Menyimpan poin per soal esai ke /api/quiz/<slug>/essay, lalu memperbarui
   kartu di tempat tanpa memuat ulang halaman.
   ========================================================================== */
(function () {
  function closest(element, selector) {
    return element && element.closest ? element.closest(selector) : null;
  }

  function summaryFromResponse(data) {
    return data.summary || '';
  }

  function saveCard(card) {
    if (!card) return;
    var slug = card.getAttribute('data-slug');
    var recordId = card.getAttribute('data-record');
    var button = card.querySelector('.js-save');
    var status = card.querySelector('.js-status');
    if (!slug || !recordId || !button) return;

    var scores = {};
    var boxes = card.querySelectorAll('[data-qid]');
    for (var i = 0; i < boxes.length; i++) {
      var input = boxes[i].querySelector('.js-score');
      if (!input) continue;
      var value = input.value.trim();
      if (value === '') continue;
      scores[boxes[i].getAttribute('data-qid')] = Number(value);
    }

    button.disabled = true;
    status.className = 'js-status text-[11px] text-slate-400';
    status.textContent = 'Menyimpan...';

    fetch('/api/quiz/' + encodeURIComponent(slug) + '/essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: recordId, scores: scores })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.status !== 'success') {
          throw new Error((result.data && result.data.message) || 'Gagal menyimpan koreksi.');
        }
        applyResult(card, result.data);
      })
      .catch(function (error) {
        status.className = 'js-status text-[11px] text-rose-400';
        status.textContent = 'Gagal: ' + error.message;
      })
      .then(function () {
        button.disabled = false;
      });
  }

  function applyResult(card, data) {
    var status = card.querySelector('.js-status');
    var badge = card.querySelector('.js-badge');
    var summary = card.querySelector('.js-summary');

    status.className = 'js-status text-[11px] text-emerald-400';
    status.textContent = 'Tersimpan.';
    if (summary) summary.textContent = summaryFromResponse(data);

    var boxes = card.querySelectorAll('[data-qid]');
    var stillEmpty = 0;
    for (var i = 0; i < boxes.length; i++) {
      var input = boxes[i].querySelector('.js-score');
      var label = boxes[i].querySelector('.js-qstatus');
      var filled = input && input.value.trim() !== '';
      if (!filled) stillEmpty += 1;
      if (label) {
        label.textContent = filled ? 'Sudah dinilai' : 'Belum dinilai';
        label.className = 'js-qstatus text-[11px] ' + (filled ? 'text-emerald-400' : 'text-slate-500');
      }
    }

    if (badge) {
      var pending = typeof data.essay_pending === 'number' ? data.essay_pending : stillEmpty;
      if (pending > 0) {
        badge.className = 'js-badge text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30';
        badge.textContent = pending + ' esai belum dinilai';
      } else {
        badge.className = 'js-badge text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
        badge.textContent = 'Sudah dikoreksi';
      }
    }
  }

  document.addEventListener('click', function (event) {
    var full = closest(event.target, '.js-full');
    if (full) {
      var box = closest(full, '[data-qid]');
      var input = box && box.querySelector('.js-score');
      if (input) {
        input.value = box.getAttribute('data-max');
        input.focus();
      }
      return;
    }
    var save = closest(event.target, '.js-save');
    if (save) saveCard(closest(save, '[data-record]'));
  });

  // Enter di kolom nilai = simpan kartu itu (mempercepat koreksi banyak siswa).
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    if (!event.target || !event.target.classList || !event.target.classList.contains('js-score')) return;
    event.preventDefault();
    saveCard(closest(event.target, '[data-record]'));
  });
})();
