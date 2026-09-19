/* ==========================================================================
   quiz-report.js — tombol "Unduh CSV" pada bagian Analisis Butir Soal.
   Data sudah disuntik server lewat window.ITEM_ANALYSIS, jadi file ini cuma
   mengubahnya jadi CSV yang rapi dibuka di Excel/Google Sheets.
   ========================================================================== */
(function () {
  var data = window.ITEM_ANALYSIS;
  var button = document.getElementById('item-csv');
  if (!data || !button || !Array.isArray(data.items)) return;

  function cell(value) {
    if (typeof value === 'number') return String(value);
    var text = value === undefined || value === null ? '' : String(value);
    return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  }

  function choicesOf(item) {
    if (!item.options) return '';
    var parts = item.options.map(function (option) {
      return option.letter + ':' + option.count + (option.isKey ? '*' : '');
    });
    if (item.blank) parts.push('kosong:' + item.blank);
    return parts.join('; ');
  }

  function weakestOf(item) {
    if (!item.weakestRows || !item.weakestRows.length) return '';
    return item.weakestRows
      .map(function (row) {
        return row.text + ' (' + row.wrong + '/' + row.total + ' salah)';
      })
      .join('; ');
  }

  function build() {
    var header = [
      'No',
      'Tipe',
      'Soal',
      'Menjawab',
      'Benar',
      'Salah',
      'BelumDinilai',
      'PersenBenar',
      'TingkatKesukaran',
      'DayaBeda',
      'KategoriDayaBeda',
      'SebaranPilihan',
      'BagianTerseringKeliru',
      'Catatan'
    ];
    var rows = [header.map(cell).join(',')];
    data.items.forEach(function (item) {
      rows.push(
        [
          item.no,
          item.type,
          item.label,
          item.answered,
          item.correct,
          item.wrong,
          item.pending,
          item.answered ? item.percentCorrect : '',
          item.difficulty === '—' ? '' : item.difficulty,
          item.discrimination === null ? '' : Math.round(item.discrimination * 100) / 100,
          item.discriminationLabel === '—' ? '' : item.discriminationLabel,
          choicesOf(item),
          weakestOf(item),
          item.note
        ]
          .map(cell)
          .join(',')
      );
    });
    rows.push('');
    rows.push([cell('Jumlah peserta'), cell(data.participants), cell('Rata-rata nilai'), cell(data.average)].join(','));
    return rows.join('\r\n');
  }

  button.addEventListener('click', function () {
    var parts = window.location.pathname.split('/').filter(Boolean);
    var slug = parts.length > 1 ? parts[1] : 'kuis';
    // BOM di depan supaya Excel membaca huruf beraksen dan Arab dengan benar.
    var blob = new Blob(['\uFEFF' + build()], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'analisis-butir-soal-' + slug + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  });
})();
