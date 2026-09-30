/* ==========================================================================
   record-detail.js - popup detail jawaban di halaman rekap (/p/<slug>/data).
   Tabel hanya membawa id kiriman; isi lengkap diambil dari
   /p/<slug>/data/record?id=... saat tombol diklik, supaya halaman rekap tidak
   memuat JSON semua rekaman sekaligus.
   ========================================================================== */
(function () {
  var dialog = document.getElementById('rd-dialog');
  var body = document.getElementById('rd-body');
  var closeButton = document.getElementById('rd-close');
  var keyToggle = document.getElementById('rd-keys');
  var script = document.querySelector('script[data-slug]');
  if (!dialog || !body || !closeButton || !keyToggle || !script) return;

  var slug = script.getAttribute('data-slug') || '';
  var loadedAssets = false;

  /* Kunci jawaban disembunyikan sampai guru menyalakan toggle. Ini kenyamanan
     saja, bukan kontrol akses: payload admin memang sudah memuat `kunci`. */
  keyToggle.addEventListener('change', function () {
    dialog.classList.toggle('show-keys', keyToggle.checked);
  });

  function setStatus(message, tone) {
    body.innerHTML = '<p class="rd-note' + (tone ? ' ' + tone : '') + '">' + message + '</p>';
  }

  function loadAssets() {
    if (loadedAssets) return Promise.resolve();
    loadedAssets = true;
    var holder = document.getElementById('rd-assets');
    if (!holder) return Promise.resolve();
    var assets;
    try {
      assets = JSON.parse(holder.textContent || '{}');
    } catch (e) {
      return Promise.resolve();
    }
    if (!assets.mathCss) return Promise.resolve();

    return new Promise(function (done) {
      var pending = 0;
      function settle() { pending -= 1; if (pending <= 0) done(); }
      // Kalau tag-nya sudah ada, tidak perlu diunduh ulang.
      function tag(node, check) {
        if (check && document.querySelector(check)) return;
        pending += 1;
        node.onload = settle;
        node.onerror = settle;
        document.head.appendChild(node);
      }

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = assets.mathCss;
      tag(link, 'link[href="' + assets.mathCss + '"]');

      if (assets.mathJs) {
        var math = document.createElement('script');
        math.src = assets.mathJs;
        tag(math, 'script[src="' + assets.mathJs + '"]');
      }
      if (assets.mathRender) {
        var render = document.createElement('script');
        render.src = assets.mathRender;
        // auto-render harus ikut setelah katex.min.js selesai dimuat.
        render.onload = function () {
          try {
            if (window.renderMathInElement) {
              window.renderMathInElement(body, {
                delimiters: [
                  { left: '$$', right: '$$', display: true },
                  { left: '\\[', right: '\\]', display: true },
                  { left: '$', right: '$', display: false },
                  { left: '\\(', right: '\\)', display: false }
                ],
                throwOnError: false
              });
            }
          } catch (e) { /* matematika rusak tidak boleh menutup popup */ }
          settle();
        };
        render.onerror = settle;
        document.head.appendChild(render);
      }
      if (assets.codeCss) {
        var codeLink = document.createElement('link');
        codeLink.rel = 'stylesheet';
        codeLink.href = assets.codeCss;
        tag(codeLink, 'link[href="' + assets.codeCss + '"]');
      }
      if (assets.codeJs) {
        var code = document.createElement('script');
        code.src = assets.codeJs;
        tag(code, 'script[src="' + assets.codeJs + '"]');
      }
      if (pending === 0) done();
    });
  }

  function highlightCode() {
    if (!window.hljs) return;
    var blocks = body.querySelectorAll('pre code');
    for (var i = 0; i < blocks.length; i++) {
      try { window.hljs.highlightElement(blocks[i]); } catch (e) { /* biarkan apa adanya */ }
    }
  }

  function show() {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
  }

  function hide() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function open(id) {
    if (!id) return;
    keyToggle.checked = false;
    dialog.classList.remove('show-keys');
    show();
    setStatus('Memuat jawaban...');
    body.scrollTop = 0;

    fetch('/p/' + encodeURIComponent(slug) + '/data/record?id=' + encodeURIComponent(id), {
      headers: { 'X-Requested-With': 'fetch' }
    })
      .then(function (res) {
        return res.text().then(function (text) {
          if (!res.ok) throw new Error(text || res.statusText);
          return text;
        });
      })
      .then(function (html) {
        body.innerHTML = html;
        return loadAssets();
      })
      .then(function () {
        highlightCode();
      })
      .catch(function (err) {
        var message = (err && err.message) ? err.message : 'Gagal memuat';
        setStatus('Tidak bisa memuat jawaban: ' + message, 'tone-bad');
      });
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest('[data-record]') : null;
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute('data-record'));
  });

  closeButton.addEventListener('click', hide);
  // Klik di area luar panel (dialog native men-delegate backdrop ke dialog
  // itu sendiri, jadi penargetannya `dialog`, bukan isi dialog).
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) hide();
  });
  // Esc sudah ditangani dialog native, tapi hanya saat showModal terpakai.
  if (typeof dialog.showModal !== 'function') {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && dialog.hasAttribute('open')) hide();
    });
  }
})();
