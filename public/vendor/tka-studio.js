/* ==========================================================================
   tka-studio.js — logika halaman "TKA Prompt Engine" (/studio).
   Port dari tka-studio-prompt.php: menyusun prompt asesmen/TKA dari template
   + matriks mapel, mengelola jurusan kustom, dan mengisi modal.

   Data awal disuntik server lewat window.TKA_DATA = { templates, subjects, tab }.
   Deklarasi sengaja di scope global (bukan IIFE) karena banyak kontrol memakai
   atribut inline onclick/oninput.
   ========================================================================== */

const TKA = window.TKA_DATA || {};
const DB_TEMPLATES = TKA.templates || [];
const DB_SUBJECTS = TKA.subjects || [];
const INITIAL_TAB = TKA.tab || 'generator';

let currentMode = 'sumatif'; // 'sumatif' | 'tka' | 'specific'
let distMode = 'manual';

const KELAS_MAP = {
  SD: [
    { val: '1', label: 'Kelas 1 (Fase A)', fase: 'A' },
    { val: '2', label: 'Kelas 2 (Fase A)', fase: 'A' },
    { val: '3', label: 'Kelas 3 (Fase B)', fase: 'B' },
    { val: '4', label: 'Kelas 4 (Fase B)', fase: 'B' },
    { val: '5', label: 'Kelas 5 (Fase C)', fase: 'C' },
    { val: '6', label: 'Kelas 6 (Fase C)', fase: 'C' }
  ],
  SMP: [
    { val: '7', label: 'Kelas 7 (Fase D)', fase: 'D' },
    { val: '8', label: 'Kelas 8 (Fase D)', fase: 'D' },
    { val: '9', label: 'Kelas 9 (Fase D)', fase: 'D' }
  ],
  SMA: [
    { val: 'X', label: 'Kelas X (Fase E)', fase: 'E' },
    { val: 'XI', label: 'Kelas XI (Fase F)', fase: 'F' },
    { val: 'XII', label: 'Kelas XII (Fase F)', fase: 'F' }
  ],
  SMK: [
    { val: 'X', label: 'Kelas X (Fase E)', fase: 'E' },
    { val: 'XI', label: 'Kelas XI (Fase F)', fase: 'F' },
    { val: 'XII', label: 'Kelas XII (Fase F)', fase: 'F' }
  ]
};

function normalizeKey(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

function extractRowFields(row) {
  let elemen = '', subElemen = '', kompetensi = '', subKompetensi = '';
  for (const [key, value] of Object.entries(row)) {
    const val = String(value || '').trim();
    const clean = normalizeKey(key);

    if (clean.includes('subkompetensi')) subKompetensi = val;
    else if (clean.includes('kompetensi')) kompetensi = val;
    else if (clean.includes('subelemen') || clean.includes('submateri')) subElemen = val;
    else if (clean.includes('elemen') || clean.includes('materi')) elemen = val;
  }
  return { elemen, subElemen, kompetensi, subKompetensi };
}

function getOpsiPgDescription(jenjang, fase) {
  if (jenjang === 'SD') {
    if (fase === 'A') return 'pilihan ganda 3 opsi (A\u2013C)';
    return 'pilihan ganda 4 opsi (A\u2013D)';
  } else if (jenjang === 'SMP') {
    return 'pilihan ganda 4 opsi (A\u2013D)';
  }
  return 'pilihan ganda 5 opsi (A\u2013E)';
}

function onInstansiChange() {
  const instansi = document.getElementById('gen-instansi').value.trim();
  const bar = document.getElementById('topbar-instansi');
  if (bar) bar.textContent = instansi || 'Pusat Asesmen Pendidikan';
  compilePrompt();
}

function onJurusanChange() {
  const jVal = document.getElementById('gen-jurusan').value;
  const badge = document.getElementById('topbar-jurusan-badge');
  if (badge) {
    badge.textContent = jVal === 'Umum' ? 'UMUM' : (jVal.match(/\(([^)]+)\)/) ? jVal.match(/\(([^)]+)\)/)[1] : jVal.substring(0, 10));
  }
  compilePrompt();
}

function onKelasChange() {
  const jenjang = document.getElementById('gen-jenjang').value;
  const kelasVal = document.getElementById('gen-kelas-select').value;
  const options = KELAS_MAP[jenjang] || [];
  const cur = options.find(o => o.val === kelasVal);
  const fase = cur ? cur.fase : 'E';

  document.getElementById('gen-fase').value = 'Fase ' + fase;
  document.getElementById('badge-jenjang-info').textContent = `${jenjang} - Kelas ${kelasVal} (Fase ${fase})`;

  const deskripsiOpsi = getOpsiPgDescription(jenjang, fase);
  document.getElementById('lbl-pg-sederhana').textContent = deskripsiOpsi.includes('A\u2013C') ? 'PG (A\u2013C)' : (deskripsiOpsi.includes('A\u2013D') ? 'PG (A\u2013D)' : 'PG (A\u2013E)');

  compilePrompt();
}

function onJenjangChange() {
  const jenjang = document.getElementById('gen-jenjang').value;
  const selKelas = document.getElementById('gen-kelas-select');
  const wrapperJurusan = document.getElementById('wrapper-jurusan');
  const labelFilter = document.getElementById('label-jenjang-filter');

  if (jenjang === 'SMK') {
    wrapperJurusan.classList.remove('hidden');
  } else {
    wrapperJurusan.classList.add('hidden');
  }

  selKelas.innerHTML = '';
  const listKelas = KELAS_MAP[jenjang] || [];
  listKelas.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k.val;
    opt.textContent = k.label;
    selKelas.appendChild(opt);
  });

  const selMapel = document.getElementById('gen-mapel');
  selMapel.innerHTML = '';

  const filtered = DB_SUBJECTS.filter(s => {
    const j = (s.jenjang || '').toUpperCase();
    if (j === 'SEMUA' || j === 'ALL') return true;
    if (jenjang === 'SD') return j === 'SD';
    if (jenjang === 'SMP') return j === 'SMP';
    if (jenjang === 'SMA') return j === 'SMA' || j === 'SMA/SMK';
    if (jenjang === 'SMK') return j === 'SMK' || j === 'SMA/SMK';
    return false;
  });

  labelFilter.textContent = `Menampilkan mapel jenjang ${jenjang} (${filtered.length} mapel)`;

  const list = filtered.length > 0 ? filtered : DB_SUBJECTS;
  list.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.nama;
    const tag = (s.jenjang === 'SEMUA' || s.jenjang === 'SMA/SMK') ? ` (${s.jenjang})` : '';
    opt.textContent = s.nama + tag;
    selMapel.appendChild(opt);
  });

  onKelasChange();
  onMapelChange();
}

// Toggle 3 Mode Generasi (Sumatif | TKA | Spesifik)
function setGenerationMode(mode) {
  currentMode = mode;

  const btnSumatif = document.getElementById('btn-mode-sumatif');
  const btnTka = document.getElementById('btn-mode-tka');
  const btnSpec = document.getElementById('btn-mode-specific');

  const wrapSumatif = document.getElementById('wrapper-param-sumatif');
  const wrapSpec = document.getElementById('wrapper-mode-specific');
  const wrapDist = document.getElementById('wrapper-distribusi');

  [btnSumatif, btnTka, btnSpec].forEach(b => {
    b.className = 'seg-btn';
  });

  if (mode === 'sumatif') {
    btnSumatif.className = 'seg-btn active';
    wrapSumatif.classList.remove('hidden');
    wrapSpec.classList.add('hidden');
    wrapDist.classList.remove('hidden');

    const tpl = DB_TEMPLATES.find(t => t.tipe === 'sumatif');
    if (tpl) document.getElementById('gen-template').value = tpl.id;
  } else if (mode === 'tka') {
    btnTka.className = 'seg-btn active';
    wrapSumatif.classList.add('hidden');
    wrapSpec.classList.add('hidden');
    wrapDist.classList.remove('hidden');

    const tpl = DB_TEMPLATES.find(t => t.tipe === 'tka_full');
    if (tpl) document.getElementById('gen-template').value = tpl.id;
  } else {
    btnSpec.className = 'seg-btn active';
    wrapSumatif.classList.add('hidden');
    wrapSpec.classList.remove('hidden');
    wrapDist.classList.remove('hidden');

    const tpl = DB_TEMPLATES.find(t => t.tipe === 'specific');
    if (tpl) document.getElementById('gen-template').value = tpl.id;
  }

  onTemplateChange();
}

function setDistMode(mode) {
  distMode = mode;
  const btnAuto = document.getElementById('btn-dist-auto');
  const btnManual = document.getElementById('btn-dist-manual');
  const wrapAuto = document.getElementById('wrapper-dist-auto');
  const wrapManual = document.getElementById('wrapper-dist-manual');

  if (mode === 'auto') {
    btnAuto.className = 'seg-btn active';
    btnManual.className = 'seg-btn';
    wrapAuto.classList.remove('hidden');
    wrapManual.classList.add('hidden');
  } else {
    btnManual.className = 'seg-btn active';
    btnAuto.className = 'seg-btn';
    wrapManual.classList.remove('hidden');
    wrapAuto.classList.add('hidden');
  }

  compilePrompt();
}

function onTotalSoalChange() {
  const totalSoal = parseInt(document.getElementById('gen-jumlah').value) || 25;

  if (distMode === 'auto') {
    const autoDist = calculateAutoDistribution(totalSoal);
    document.getElementById('manual-pg').value = autoDist.pgBiasa;
    document.getElementById('manual-pgk-mcma').value = autoDist.pgkMcma;
    document.getElementById('manual-pgk-kat').value = autoDist.pgkKategori;

    document.getElementById('manual-l1').value = autoDist.l1;
    document.getElementById('manual-l2').value = autoDist.l2;
    document.getElementById('manual-l3').value = autoDist.l3;
  }

  updateManualBadges();
  compilePrompt();
}

function onManualDistChange() {
  updateManualBadges();
  compilePrompt();
}

function updateManualBadges() {
  const pg = parseInt(document.getElementById('manual-pg').value) || 0;
  const mcma = parseInt(document.getElementById('manual-pgk-mcma').value) || 0;
  const kat = parseInt(document.getElementById('manual-pgk-kat').value) || 0;
  const totBentuk = pg + mcma + kat;

  const l1 = parseInt(document.getElementById('manual-l1').value) || 0;
  const l2 = parseInt(document.getElementById('manual-l2').value) || 0;
  const l3 = parseInt(document.getElementById('manual-l3').value) || 0;
  const totKognitif = l1 + l2 + l3;

  const badgeB = document.getElementById('badge-total-bentuk');
  const badgeK = document.getElementById('badge-total-kognitif');

  badgeB.textContent = `Total: ${totBentuk}`;
  badgeK.textContent = `Total: ${totKognitif}`;

  const totalTarget = parseInt(document.getElementById('gen-jumlah').value) || 25;
  badgeB.className = `stat-badge ${totBentuk === totalTarget ? 'ok' : 'bad'}`;
  badgeK.className = `stat-badge ${totKognitif === totalTarget ? 'ok' : 'bad'}`;
}

function onTemplateChange() {
  compilePrompt();
}

function subjectMatrixRows(mapel) {
  try {
    const matriksObj = JSON.parse(mapel.matriks_json);
    return matriksObj.rows || [];
  } catch (e) {
    return [];
  }
}

function onMapelChange() {
  const mapelName = document.getElementById('gen-mapel').value;
  const mapel = DB_SUBJECTS.find(s => s.nama === mapelName);
  if (!mapel) return;

  const selMuatan = document.getElementById('gen-muatan');
  selMuatan.innerHTML = '';

  const rows = subjectMatrixRows(mapel);
  const uniqueElements = new Set();
  rows.forEach(r => {
    const f = extractRowFields(r);
    if (f.elemen) uniqueElements.add(f.elemen);
  });

  if (uniqueElements.size > 0) {
    uniqueElements.forEach(el => {
      const opt = document.createElement('option');
      opt.value = el;
      opt.textContent = el;
      selMuatan.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option');
    opt.value = mapel.muatan || mapelName;
    opt.textContent = (mapel.muatan || mapelName).substring(0, 90) + '...';
    selMuatan.appendChild(opt);
  }

  onMuatanChange();
}

function onMuatanChange() {
  const mapelName = document.getElementById('gen-mapel').value;
  const selectedMuatan = document.getElementById('gen-muatan').value;
  const mapel = DB_SUBJECTS.find(s => s.nama === mapelName);
  const selKompetensi = document.getElementById('gen-kompetensi');
  selKompetensi.innerHTML = '';

  if (!mapel) return;

  const rows = subjectMatrixRows(mapel);
  const uniqueKomp = new Set();
  rows.forEach(r => {
    const f = extractRowFields(r);
    if (!f.elemen || f.elemen === selectedMuatan) {
      if (f.kompetensi) {
        f.kompetensi.split(';').forEach(k => {
          if (k.trim()) uniqueKomp.add(k.trim());
        });
      }
    }
  });

  if (uniqueKomp.size > 0) {
    uniqueKomp.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      selKompetensi.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option');
    opt.value = mapel.kompetensi ? mapel.kompetensi.split('\n')[0] : 'Penerapan konsep dan penalaran';
    opt.textContent = opt.value;
    selKompetensi.appendChild(opt);
  }

  onKompetensiChange();
}

function onKompetensiChange() {
  const mapelName = document.getElementById('gen-mapel').value;
  const selectedMuatan = document.getElementById('gen-muatan').value;
  const selectedKompetensi = document.getElementById('gen-kompetensi').value;
  const mapel = DB_SUBJECTS.find(s => s.nama === mapelName);
  const container = document.getElementById('gen-subkomp-container');
  container.innerHTML = '';

  if (!mapel) return;

  const rows = subjectMatrixRows(mapel);
  const subList = [];
  rows.forEach(r => {
    const f = extractRowFields(r);
    const matchM = !f.elemen || f.elemen === selectedMuatan;
    const matchK = !f.kompetensi || f.kompetensi.includes(selectedKompetensi);

    if (matchM && matchK) {
      const target = f.subKompetensi || f.subElemen;
      if (target) {
        target.split(/●|;/).map(s => s.trim()).filter(Boolean).forEach(item => {
          if (!subList.includes(item)) subList.push(item);
        });
      }
    }
  });

  if (subList.length > 0) {
    subList.forEach((s, idx) => {
      const label = document.createElement('label');
      label.className = 'check-row';
      label.innerHTML = `
        <input type="checkbox" value="${s}" ${idx === 0 ? 'checked' : ''} onchange="compilePrompt()" class="subkomp-chk">
        <span>${s}</span>
      `;
      container.appendChild(label);
    });
  } else {
    container.innerHTML = '<p class="card-text" style="font-size:11px;font-style:italic">Menggunakan target capaian kompetensi utama.</p>';
  }

  compilePrompt();
}

function matrixToMarkdownTable(mapel) {
  const rows = subjectMatrixRows(mapel);

  if (!rows || rows.length === 0) {
    return `Muatan / Elemen: ${mapel.muatan || '-'}\nKompetensi / TP: ${mapel.kompetensi || '-'}`;
  }

  let md = '| No | Elemen / Muatan | Kompetensi / Indikator | Batasan / Catatan |\n';
  md += '|:---|:---|:---|:---|\n';

  rows.forEach((r, idx) => {
    const f = extractRowFields(r);
    const elemen = (f.elemen || f.subElemen || '-').replace(/[\r\n|]+/g, ' ');
    const komp = (f.subKompetensi || f.kompetensi || '-').replace(/[\r\n|]+/g, ' ');
    const batasan = (r['Batasan/Catatan'] || r['Batasan / Catatan'] || r['Batasan/catatan'] || r['Batasan/Cakupan'] || '-').replace(/[\r\n|]+/g, ' ');

    md += `| ${idx + 1} | ${elemen} | ${komp} | ${batasan} |\n`;
  });

  return md;
}

function calculateAutoDistribution(totalSoal) {
  let pgkMcma = Math.max(1, Math.round(totalSoal * 0.15));
  let pgkKategori = Math.max(1, Math.round(totalSoal * 0.15));
  let pgBiasa = totalSoal - (pgkMcma + pgkKategori);
  if (pgBiasa < 0) pgBiasa = 0;

  let l1 = Math.max(1, Math.round(totalSoal * 0.30));
  let l3 = Math.max(1, Math.round(totalSoal * 0.30));
  let l2 = totalSoal - (l1 + l3);
  if (l2 < 0) l2 = 0;

  return { pgBiasa, pgkMcma, pgkKategori, l1, l2, l3 };
}

function getCompiledDistribution(totalSoal, jenjang, fase) {
  let pgBiasa, pgkMcma, pgkKategori, l1, l2, l3;

  if (distMode === 'auto') {
    const auto = calculateAutoDistribution(totalSoal);
    pgBiasa = auto.pgBiasa;
    pgkMcma = auto.pgkMcma;
    pgkKategori = auto.pgkKategori;
    l1 = auto.l1;
    l2 = auto.l2;
    l3 = auto.l3;

    document.getElementById('preview-bentuk-list').innerHTML = `
      <li>• PG Sederhana: <b>${pgBiasa}</b> soal (70%)</li>
      <li>• PGK MCMA: <b>${pgkMcma}</b> soal (15%)</li>
      <li>• PGK Kategori: <b>${pgkKategori}</b> soal (15%)</li>
    `;
    document.getElementById('preview-kognitif-list').innerHTML = `
      <li>• Pengetahuan & Pemahaman (L1): <b>${l1}</b> soal (30%)</li>
      <li>• Penerapan / Aplikasi (L2): <b>${l2}</b> soal (40%)</li>
      <li>• Penalaran (L3): <b>${l3}</b> soal (30%)</li>
    `;
  } else {
    pgBiasa = parseInt(document.getElementById('manual-pg').value) || 0;
    pgkMcma = parseInt(document.getElementById('manual-pgk-mcma').value) || 0;
    pgkKategori = parseInt(document.getElementById('manual-pgk-kat').value) || 0;

    l1 = parseInt(document.getElementById('manual-l1').value) || 0;
    l2 = parseInt(document.getElementById('manual-l2').value) || 0;
    l3 = parseInt(document.getElementById('manual-l3').value) || 0;
  }

  const pctPg = Math.round((pgBiasa / totalSoal) * 100);
  const pctMcma = Math.round((pgkMcma / totalSoal) * 100);
  const pctKat = Math.round((pgkKategori / totalSoal) * 100);

  const pctL1 = Math.round((l1 / totalSoal) * 100);
  const pctL2 = Math.round((l2 / totalSoal) * 100);
  const pctL3 = Math.round((l3 / totalSoal) * 100);

  const labelPgJenjang = getOpsiPgDescription(jenjang, fase);

  const strBentuk = `- Soal Jawaban ${labelPgJenjang} : ${pctPg}% dari ${totalSoal} Soal = ${pgBiasa} Soal\n- Soal Pilihan Ganda Kompleks MCMA (Multiple Choices Multiple Answers) : ${pctMcma}% dari ${totalSoal} soal = ${pgkMcma} soal\n- Soal Pilihan Ganda Kompleks kategori pernyataan: ${pctKat}% dari ${totalSoal} soal = ${pgkKategori} soal`;

  const strKognitif = `- Pengetahuan dan Pemahaman (L1): ${pctL1}% = ${l1} soal\n- Penerapan/Aplikasi (L2): ${pctL2}% dari ${totalSoal} soal = ${l2} Soal\n- Penalaran (L3) : ${pctL3}% dari ${totalSoal} Soal = ${l3} Soal`;

  return { strBentuk, strKognitif };
}

function compilePrompt() {
  const tplId = document.getElementById('gen-template').value;
  const tpl = DB_TEMPLATES.find(t => String(t.id) === String(tplId));
  if (!tpl) return;

  const jenjang = document.getElementById('gen-jenjang').value;
  const totalSoal = parseInt(document.getElementById('gen-jumlah').value) || 25;
  const mapelName = document.getElementById('gen-mapel').value;
  const mapel = DB_SUBJECTS.find(s => s.nama === mapelName) || {};

  const tahunAjaran = document.getElementById('gen-tahun-ajaran').value.trim() || '2025/2026';
  const instansiRaw = document.getElementById('gen-instansi').value.trim();
  const instansiVal = instansiRaw ? `Instansi: ${instansiRaw}.` : '';

  // Parameter Sumatif
  const kelas = document.getElementById('gen-kelas-select').value || 'X';
  const faseText = document.getElementById('gen-fase').value.replace('Fase ', '') || 'E';
  const semester = document.getElementById('gen-semester').value;
  const jenisAsesmen = document.getElementById('gen-jenis-asesmen').value;

  // Variabel Jurusan (Hanya jika SMK dan bukan umum)
  let jurusanVal = '';
  if (jenjang === 'SMK') {
    const j = document.getElementById('gen-jurusan').value;
    if (j && j !== 'Umum') {
      jurusanVal = `Konsentrasi Keahlian: ${j}. Rancang stimulus atau studi kasus yang aplikatif sesuai bidang kejuruan ini.`;
    }
  }

  const opsiPgText = getOpsiPgDescription(jenjang, faseText);

  const dist = getCompiledDistribution(totalSoal, jenjang, faseText);
  const tabelMatriks = matrixToMarkdownTable(mapel);

  const customMuatan = document.getElementById('gen-muatan-custom');
  const muatan = (!customMuatan.classList.contains('hidden') && customMuatan.value.trim())
    ? customMuatan.value.trim()
    : document.getElementById('gen-muatan').value;

  const customKomp = document.getElementById('gen-kompetensi-custom');
  const kompetensi = (!customKomp.classList.contains('hidden') && customKomp.value.trim())
    ? customKomp.value.trim()
    : document.getElementById('gen-kompetensi').value;

  const checkedBoxes = Array.from(document.querySelectorAll('.subkomp-chk:checked')).map(c => c.value);
  const subKompetensi = checkedBoxes.length > 0 ? checkedBoxes.join(', ') : kompetensi;

  let result = tpl.template
    .replaceAll('{INSTANSI}', instansiVal)
    .replaceAll('{TAHUN_AJARAN}', tahunAjaran)
    .replaceAll('{JENIS_ASESMEN}', jenisAsesmen)
    .replaceAll('{SEMESTER}', semester)
    .replaceAll('{FASE}', faseText)
    .replaceAll('{OPSI_PG}', opsiPgText)
    .replaceAll('{MAPEL}', mapelName)
    .replaceAll('{JENJANG}', jenjang)
    .replaceAll('{JURUSAN}', jurusanVal)
    .replaceAll('{JUMLAH}', totalSoal)
    .replaceAll('{TOTAL_SOAL}', totalSoal)
    .replaceAll('{KELAS}', kelas)
    .replaceAll('{DISTRIBUSI_BENTUK}', dist.strBentuk)
    .replaceAll('{DISTRIBUSI_KOGNITIF}', dist.strKognitif)
    .replaceAll('{TABEL_MATRIKS}', tabelMatriks)
    .replaceAll('{MUATAN}', muatan)
    .replaceAll('{KOMPETENSI}', kompetensi)
    .replaceAll('{SUB_KOMPETENSI}', subKompetensi);

  result = result.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  const out = document.getElementById('output-text');
  out.value = result;
  document.getElementById('stat-counter').textContent = `${result.length} Karakter | ${result.split(/\s+/).filter(Boolean).length} Kata`;
}

function copyToClipboard() {
  const out = document.getElementById('output-text');
  out.select();
  navigator.clipboard.writeText(out.value).then(() => {
    const toast = document.getElementById('copy-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }).catch(() => {
    document.execCommand('copy');
  });
}

function toggleCustom(field) {
  const el = document.getElementById(`gen-${field}-custom`);
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    el.value = document.getElementById(`gen-${field}`).value;
  }
  compilePrompt();
}

function switchTab(tabId) {
  ['generator', 'mapel', 'admin', 'data'].forEach(t => {
    const panel = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`btn-tab-${t}`);
    if (panel) panel.classList.add('hidden');
    if (btn) btn.className = 'tab';
  });
  const panel = document.getElementById(`tab-${tabId}`);
  const btn = document.getElementById(`btn-tab-${tabId}`);
  if (panel) panel.classList.remove('hidden');
  if (btn) btn.className = 'tab active';
}

function openAddJurusanModal() {
  document.getElementById('input-new-jurusan').value = '';
  document.getElementById('modal-add-jurusan').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-new-jurusan').focus(), 100);
}

function closeAddJurusanModal() {
  document.getElementById('modal-add-jurusan').classList.add('hidden');
}

function loadCustomJurusan() {
  const stored = localStorage.getItem('tka_custom_jurusan');
  let customList = [];
  try { customList = stored ? JSON.parse(stored) : []; } catch (e) { customList = []; }
  const optGroup = document.getElementById('optgroup-custom-jurusan');
  optGroup.innerHTML = '';

  if (customList.length > 0) {
    optGroup.classList.remove('hidden');
    customList.forEach(j => {
      const opt = document.createElement('option');
      opt.value = j;
      opt.textContent = j;
      optGroup.appendChild(opt);
    });
  } else {
    optGroup.classList.add('hidden');
  }
}

function saveNewJurusan() {
  const input = document.getElementById('input-new-jurusan');
  const val = input.value.trim();
  if (!val) {
    alert('Nama jurusan tidak boleh kosong.');
    return;
  }

  const stored = localStorage.getItem('tka_custom_jurusan');
  let customList = [];
  try { customList = stored ? JSON.parse(stored) : []; } catch (e) { customList = []; }

  if (!customList.includes(val)) {
    customList.unshift(val);
    localStorage.setItem('tka_custom_jurusan', JSON.stringify(customList));
  }

  loadCustomJurusan();
  document.getElementById('gen-jurusan').value = val;
  closeAddJurusanModal();
  compilePrompt();
}

function openModal() {
  document.getElementById('modal-tpl-title').textContent = 'Tambah Template Baru';
  document.getElementById('modal-tpl-id').value = '';
  document.getElementById('modal-tpl-name').value = '';
  document.getElementById('modal-tpl-type').value = 'sumatif';
  document.getElementById('modal-tpl-text').value = '';
  document.getElementById('modal-tpl').classList.remove('hidden');
}

function editModal(t) {
  document.getElementById('modal-tpl-title').textContent = 'Edit Template';
  document.getElementById('modal-tpl-id').value = t.id;
  document.getElementById('modal-tpl-name').value = t.nama;
  document.getElementById('modal-tpl-type').value = t.tipe;
  document.getElementById('modal-tpl-text').value = t.template;
  document.getElementById('modal-tpl').classList.remove('hidden');
}

function editModalById(id) {
  const t = DB_TEMPLATES.find(x => String(x.id) === String(id));
  if (t) editModal(t);
}

function closeModal() {
  document.getElementById('modal-tpl').classList.add('hidden');
}

function insertVar(v) {
  const area = document.getElementById('modal-tpl-text');
  const start = area.selectionStart;
  const end = area.selectionEnd;
  area.value = area.value.substring(0, start) + v + area.value.substring(end);
  area.focus();
  area.selectionEnd = start + v.length;
}

function openSubjectModal() {
  document.getElementById('modal-sub-title').textContent = 'Tambah Mata Pelajaran';
  document.getElementById('modal-sub-id').value = '';
  document.getElementById('modal-sub-nama').value = '';
  document.getElementById('modal-sub-jenjang').value = 'SEMUA';
  document.getElementById('modal-sub-muatan').value = '';
  document.getElementById('modal-sub-kompetensi').value = '';
  document.getElementById('modal-sub-matriks').value = '{\n  "rows": []\n}';
  document.getElementById('modal-subject').classList.remove('hidden');
}

function editSubjectModal(s) {
  document.getElementById('modal-sub-title').textContent = 'Edit Mata Pelajaran: ' + s.nama;
  document.getElementById('modal-sub-id').value = s.id;
  document.getElementById('modal-sub-nama').value = s.nama;
  document.getElementById('modal-sub-jenjang').value = s.jenjang;
  document.getElementById('modal-sub-muatan').value = s.muatan || '';
  document.getElementById('modal-sub-kompetensi').value = s.kompetensi || '';

  let formattedMatriks = s.matriks_json || '{"rows": []}';
  try {
    formattedMatriks = JSON.stringify(JSON.parse(formattedMatriks), null, 2);
  } catch (e) {}
  document.getElementById('modal-sub-matriks').value = formattedMatriks;

  document.getElementById('modal-subject').classList.remove('hidden');
}

function editSubjectModalById(id) {
  const s = DB_SUBJECTS.find(x => String(x.id) === String(id));
  if (s) editSubjectModal(s);
}

function closeSubjectModal() {
  document.getElementById('modal-subject').classList.add('hidden');
}

function filterMapelTable() {
  const query = document.getElementById('filter-mapel-input').value.toLowerCase();
  document.querySelectorAll('.subject-row').forEach(row => {
    const name = row.getAttribute('data-name');
    row.style.display = name.includes(query) ? '' : 'none';
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadCustomJurusan();
  onJenjangChange();
  setGenerationMode('sumatif');
  setDistMode('manual');
  updateManualBadges();
  switchTab(INITIAL_TAB);
});
