<?php
// ============================================================
// 1. INISIALISASI DATABASE SQLITE
// ============================================================
$dbFile = __DIR__ . '/tka_database.sqlite';
$isNewDb = !file_exists($dbFile);

try {
    $pdo = new PDO("sqlite:" . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            tipe TEXT NOT NULL DEFAULT 'tka',
            template TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS mata_pelajaran (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL UNIQUE,
            jenjang TEXT NOT NULL,
            kelompok TEXT,
            muatan TEXT,
            kompetensi TEXT,
            matriks_json TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    ");

    // Template Seeder Bawaan Terpisah Berdasarkan Kategori
    $countTpl = $pdo->query("SELECT COUNT(*) FROM templates")->fetchColumn();
    if ($countTpl == 0) {
        $defaultTemplates = [
            [
                'nama' => 'Asesmen Sumatif Lengkap (Kurikulum Merdeka)',
                'tipe' => 'sumatif',
                'template' => "Buatkan Paket Naskah Soal {JENIS_ASESMEN} ({SEMESTER}) Tahun Ajaran {TAHUN_AJARAN} mata pelajaran {MAPEL} untuk jenjang {JENJANG} Kelas {KELAS} (Fase {FASE}).\n{INSTANSI}\n{JURUSAN}\nJumlah: {TOTAL_SOAL} Soal.\n\nKriteria dan Standar Asesmen:\n1. Mengukur ketercapaian Tujuan Pembelajaran (TP) pada Capaian Pembelajaran Kurikulum Merdeka Fase {FASE}.\n2. Stimulus berbasis masalah kontekstual autentik terkini, memuat analisis literasi/numerasi sesuai tingkat kognitif siswa {JENJANG} Kelas {KELAS}, disertai stimulus visual (narasi stimulus/data/tabel/infografis/diagram).\n3. Setiap butir soal wajib memuat:\n   - Nomor Soal & Target Elemen / Indikator Ketercapaian TP\n   - Level Kognitif & Bentuk Soal\n   - Teks Stimulus Kontekstual\n   - Pertanyaan dan Opsi Jawaban ({OPSI_PG})\n   - Kunci Jawaban beserta Rubrik/Pembahasan Lengkap\n\nKetentuan Komposisi Bentuk Soal:\n{DISTRIBUSI_BENTUK}\n\nKetentuan Komposisi Level Kognitif:\n{DISTRIBUSI_KOGNITIF}\n\nAcuan Materi dan Kisi-kisi:\nSusun seluruh butir soal merata mengacu pada Matriks/Lingkup Materi resmi berikut:\n{TABEL_MATRIKS}"
            ],
            [
                'nama' => 'Paket Lengkap TKA Terstandar Nasional (Full Matriks)',
                'tipe' => 'tka_full',
                'template' => "Buatkan Paket Soal Tes Kemampuan Akademik (TKA) Terstandar Tahun {TAHUN_AJARAN} mata pelajaran {MAPEL} untuk jenjang {JENJANG}.\n{INSTANSI}\n{JURUSAN}\nJumlah: {TOTAL_SOAL} Soal.\n\nKriteria dan Standar Soal:\n1. Mengacu pada \"Panduan Penulisan Soal Tes Terstandar berbasis AKM (Asesmen Kompetensi Minimum)\".\n2. Stimulus berbasis studi kasus terkini dan relevan dengan dunia nyata/kejuruan, memuat analisis literasi bacaan atau numerasi terapan, disertai deskripsi visual yang jelas.\n3. Setiap butir soal wajib menyertakan:\n   - Nomor Soal & Target Elemen Matriks\n   - Level Kognitif & Bentuk Soal\n   - Teks Stimulus Kontekstual\n   - Pertanyaan dan Pilihan Jawaban ({OPSI_PG})\n   - Kunci Jawaban beserta Penjelasan/Pembahasan Ilmiah\n\nKetentuan Komposisi Bentuk Soal:\n{DISTRIBUSI_BENTUK}\n\nKetentuan Komposisi Level Kognitif:\n{DISTRIBUSI_KOGNITIF}\n\nAcuan Indikator Matriks TKA:\n{TABEL_MATRIKS}"
            ],
            [
                'nama' => 'Pilihan Ganda Kompleks (Sesuai / Tidak Sesuai)',
                'tipe' => 'specific',
                'template' => 'Berdasarkan referensi asesmen mata pelajaran {MAPEL} jenjang {JENJANG}. {INSTANSI} {JURUSAN} Buatkan {JUMLAH} butir soal yang memuat materi {MUATAN}. Soal bertujuan menguji kompetensi {KOMPETENSI} khususnya subkompetensi {SUB_KOMPETENSI}. Buatkan dalam bentuk soal pilihan ganda kompleks yang meliputi stimulus kontekstual, tabel pernyataan dengan opsi sesuai dan tidak sesuai, serta kunci jawaban dan pembahasannya.'
            ],
            [
                'nama' => 'Pilihan Ganda Sederhana',
                'tipe' => 'specific',
                'template' => 'Berdasarkan referensi asesmen mata pelajaran {MAPEL} jenjang {JENJANG}. {INSTANSI} {JURUSAN} Buatkan {JUMLAH} butir soal yang memuat materi {MUATAN}. Soal bertujuan menguji kompetensi {KOMPETENSI}, khususnya subkompetensi {SUB_KOMPETENSI}. Buatkan dalam bentuk pilihan ganda dengan format {OPSI_PG}, disertai stimulus masalah nyata, kunci jawaban, dan pembahasan.'
            ]
        ];

        $stmtTpl = $pdo->prepare("INSERT INTO templates (nama, tipe, template) VALUES (?, ?, ?)");
        foreach ($defaultTemplates as $t) {
            $stmtTpl->execute([$t['nama'], $t['tipe'], $t['template']]);
        }
    }
} catch (Exception $e) {
    die("Koneksi SQLite Gagal: " . $e->getMessage());
}

// ============================================================
// 2. BACKEND HANDLER
// ============================================================
$message = '';
$messageType = '';

// Ekspor Data Matriks
if (isset($_GET['action']) && $_GET['action'] === 'export_matrix') {
    $rows = $pdo->query("SELECT nama, jenjang, kelompok, muatan, kompetensi, matriks_json FROM mata_pelajaran ORDER BY nama ASC")->fetchAll();
    
    $exportData = [
        'metadata' => [
            'sumber' => 'Database SQLite Assessment & TKA Engine',
            'waktu_ekspor' => date('c'),
            'total_mapel' => count($rows)
        ],
        'mata_pelajaran' => []
    ];

    foreach ($rows as $r) {
        $exportData['mata_pelajaran'][] = [
            'nama' => $r['nama'],
            'jenjang' => $r['jenjang'],
            'kelompok' => $r['kelompok'],
            'muatan' => $r['muatan'],
            'kompetensi' => $r['kompetensi'],
            'matriks' => json_decode($r['matriks_json'], true) ?: []
        ];
    }

    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="matriks_asesmen_export_' . date('Ymd_His') . '.json"');
    echo json_encode($exportData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    // Import Matriks JSON
    if ($action === 'import_matrix' && isset($_FILES['json_file'])) {
        if ($_FILES['json_file']['error'] === UPLOAD_ERR_OK) {
            $content = file_get_contents($_FILES['json_file']['tmp_name']);
            $parsed = json_decode($content, true);
            $list = $parsed['mata_pelajaran'] ?? $parsed;

            if (is_array($list)) {
                $stmtInsert = $pdo->prepare("
                    INSERT INTO mata_pelajaran (nama, jenjang, kelompok, muatan, kompetensi, matriks_json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(nama) DO UPDATE SET
                        jenjang = excluded.jenjang,
                        kelompok = excluded.kelompok,
                        muatan = excluded.muatan,
                        kompetensi = excluded.kompetensi,
                        matriks_json = excluded.matriks_json,
                        updated_at = datetime('now')
                ");

                $pdo->beginTransaction();
                $count = 0;
                foreach ($list as $item) {
                    if (empty($item['nama'])) continue;
                    $nama = trim($item['nama']);
                    
                    if (!empty($item['jenjang'])) {
                        $jenjang = strtoupper(trim($item['jenjang']));
                    } else {
                        if (stripos($nama, 'SMK') !== false) {
                            $jenjang = 'SMK';
                        } elseif (stripos($nama, 'SMA') !== false) {
                            $jenjang = 'SMA';
                        } elseif (stripos($nama, 'SMP') !== false) {
                            $jenjang = 'SMP';
                        } elseif (stripos($nama, 'SD') !== false) {
                            $jenjang = 'SD';
                        } else {
                            $jenjang = 'SEMUA';
                        }
                    }

                    $kelompok = $item['kelompok'] ?? 'umum';
                    $muatan = $item['muatan'] ?? '';
                    $kompetensi = $item['kompetensi'] ?? '';
                    $matriksJson = json_encode($item['matriks'] ?? []);

                    $stmtInsert->execute([$nama, $jenjang, $kelompok, $muatan, $kompetensi, $matriksJson]);
                    $count++;
                }
                $pdo->commit();

                $message = "Sukses mengimpor {$count} mapel ke database!";
                $messageType = "success";
            } else {
                $message = "Format JSON tidak valid.";
                $messageType = "error";
            }
        }
    }

    // Template CRUD
    if ($action === 'save_template') {
        $id = $_POST['template_id'] ?? '';
        $nama = trim($_POST['template_name'] ?? '');
        $tipe = $_POST['template_type'] ?? 'sumatif';
        $template = trim($_POST['template_text'] ?? '');

        if (!empty($nama) && !empty($template)) {
            if (!empty($id)) {
                $stmt = $pdo->prepare("UPDATE templates SET nama = ?, tipe = ?, template = ? WHERE id = ?");
                $stmt->execute([$nama, $tipe, $template, $id]);
                $message = "Template berhasil diperbarui!";
            } else {
                $stmt = $pdo->prepare("INSERT INTO templates (nama, tipe, template) VALUES (?, ?, ?)");
                $stmt->execute([$nama, $tipe, $template]);
                $message = "Template baru berhasil ditambahkan!";
            }
            $messageType = "success";
        }
    }

    if ($action === 'delete_template') {
        $id = $_POST['template_id'] ?? '';
        if (!empty($id)) {
            $stmt = $pdo->prepare("DELETE FROM templates WHERE id = ?");
            $stmt->execute([$id]);
            $message = "Template berhasil dihapus.";
            $messageType = "success";
        }
    }

    // Mapel CRUD
    if ($action === 'save_subject') {
        $id = $_POST['subject_id'] ?? '';
        $nama = trim($_POST['subject_nama'] ?? '');
        $jenjang = $_POST['subject_jenjang'] ?? 'SEMUA';
        $kelompok = trim($_POST['subject_kelompok'] ?? 'wajib');
        $muatan = trim($_POST['subject_muatan'] ?? '');
        $kompetensi = trim($_POST['subject_kompetensi'] ?? '');
        $matriksRaw = trim($_POST['subject_matriks_json'] ?? '');

        if (!empty($matriksRaw)) {
            $testJson = json_decode($matriksRaw, true);
            $matriksJson = ($testJson !== null) ? json_encode($testJson) : json_encode(['rows' => []]);
        } else {
            $matriksJson = json_encode(['rows' => []]);
        }

        if (!empty($nama)) {
            if (!empty($id)) {
                $stmt = $pdo->prepare("
                    UPDATE mata_pelajaran 
                    SET nama = ?, jenjang = ?, kelompok = ?, muatan = ?, kompetensi = ?, matriks_json = ?, updated_at = datetime('now')
                    WHERE id = ?
                ");
                $stmt->execute([$nama, $jenjang, $kelompok, $muatan, $kompetensi, $matriksJson, $id]);
                $message = "Data mata pelajaran '{$nama}' berhasil diperbarui!";
            } else {
                $stmt = $pdo->prepare("
                    INSERT INTO mata_pelajaran (nama, jenjang, kelompok, muatan, kompetensi, matriks_json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ");
                $stmt->execute([$nama, $jenjang, $kelompok, $muatan, $kompetensi, $matriksJson]);
                $message = "Mata pelajaran '{$nama}' berhasil ditambahkan!";
            }
            $messageType = "success";
        }
    }

    if ($action === 'delete_subject') {
        $id = $_POST['subject_id'] ?? '';
        if (!empty($id)) {
            $stmt = $pdo->prepare("DELETE FROM mata_pelajaran WHERE id = ?");
            $stmt->execute([$id]);
            $message = "Mata pelajaran berhasil dihapus.";
            $messageType = "success";
        }
    }
}

$templates = $pdo->query("SELECT * FROM templates ORDER BY id ASC")->fetchAll();
$subjects = $pdo->query("SELECT id, nama, jenjang, kelompok, muatan, kompetensi, matriks_json FROM mata_pelajaran ORDER BY nama ASC")->fetchAll();
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asesmen & TKA Prompt Engine</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' }
          }
        }
      }
    }
  </script>
</head>
<body class="bg-slate-50 text-slate-800 font-sans min-h-screen flex flex-col">

  <!-- TOP BAR BRANDING SEKOLAH -->
  <div class="bg-emerald-900 text-emerald-100 border-b border-emerald-950/40 text-xs py-2 px-4 shadow-inner">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500 text-slate-950 font-black text-[10px] shadow-sm">
          TQ
        </span>
        <span id="topbar-instansi" class="font-bold tracking-wide text-white">SMK Thibbil Qulub Assimbani</span>
        <span class="text-emerald-400 hidden sm:inline">•</span>
        <span class="text-emerald-200 hidden sm:inline">Pusat Asesmen & Uji Kompetensi Kejuruan</span>
      </div>
      <div class="flex items-center gap-1.5 text-[11px]">
        <span class="text-emerald-300">Konsentrasi Utama:</span>
        <span id="topbar-jurusan-badge" class="bg-emerald-800/90 border border-emerald-700 text-emerald-100 font-semibold px-2 py-0.5 rounded-md">
          PPLG
        </span>
      </div>
    </div>
  </div>

  <!-- HEADER UTAMA -->
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-black text-xl shadow-md">
          P
        </div>
        <div>
          <h1 class="text-base font-bold leading-tight text-slate-900">TKA Prompt Engine</h1>
          <p class="text-xs text-slate-500">Universal AKM & Assessment Generator</p>
        </div>
      </div>
      
      <!-- Nav Tabs -->
      <nav class="flex space-x-1 bg-slate-100 p-1 rounded-xl items-center">
        <button onclick="switchTab('generator')" id="btn-tab-generator" class="px-4 py-2 text-xs font-semibold rounded-lg transition bg-white text-brand-700 shadow-sm">
          ⚡ Generator
        </button>
        <button onclick="switchTab('mapel')" id="btn-tab-mapel" class="px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-slate-900">
          📚 Kelola Mapel (<?= count($subjects) ?>)
        </button>
        <button onclick="switchTab('admin')" id="btn-tab-admin" class="px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-slate-900">
          ⚙️ Admin Template
        </button>
        <button onclick="switchTab('data')" id="btn-tab-data" class="px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-slate-900">
          📂 Import / Export
        </button>
        <a href="https://gemini.google.com/gem/117WrAMmQHsva0tw7qixx1Xo-9HCP7eV0?usp=sharing" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-brand-700 hover:bg-white/60">
          ✨ Gemini Gem
          <svg class="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <a href="https://gemini-deployer.rifqiahmad-ra.workers.dev/" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-brand-700 hover:bg-white/60">
          🚀 Deployer
          <svg class="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </nav>
    </div>
  </header>

  <!-- Flash Message -->
  <?php if ($message): ?>
  <div class="max-w-7xl mx-auto px-4 mt-4 w-full">
    <div class="p-3.5 rounded-xl text-xs font-semibold border flex items-center justify-between <?= $messageType === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200' ?>">
      <span><?= htmlspecialchars($message) ?></span>
      <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600">✕</button>
    </div>
  </div>
  <?php endif; ?>

  <main class="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">

    <!-- ============================================================ -->
    <!-- TAB 1: GENERATOR SOAL                                        -->
    <!-- ============================================================ -->
    <div id="tab-generator" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <!-- Parameter Form -->
        <div class="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          
          <!-- Mode Switcher: 3 Mode (Asesmen Sumatif, TKA, Spesifik) -->
          <div class="p-1 bg-slate-100 rounded-xl grid grid-cols-3 gap-1 border border-slate-200 text-center">
            <button type="button" onclick="setGenerationMode('sumatif')" id="btn-mode-sumatif" class="py-2 px-2 text-xs font-bold rounded-lg transition-all bg-white text-emerald-700 shadow-sm">
              🎓 Asesmen Sumatif
            </button>
            <button type="button" onclick="setGenerationMode('tka')" id="btn-mode-tka" class="py-2 px-2 text-xs font-bold rounded-lg transition-all text-slate-600 hover:text-slate-900">
              📋 Mode TKA (AKM)
            </button>
            <button type="button" onclick="setGenerationMode('specific')" id="btn-mode-specific" class="py-2 px-2 text-xs font-bold rounded-lg transition-all text-slate-600 hover:text-slate-900">
              🎯 Mode Spesifik
            </button>
          </div>

          <!-- Template Selector -->
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Template Prompt</label>
            <select id="gen-template" onchange="onTemplateChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs bg-white focus:border-brand-500 outline-none">
              <?php foreach ($templates as $t): ?>
                <option value="<?= $t['id'] ?>" data-type="<?= $t['tipe'] ?>"><?= htmlspecialchars($t['nama']) ?></option>
              <?php endforeach; ?>
            </select>
          </div>

          <!-- Parameter Instansi & Tahun Ajaran (Dinamis) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nama Instansi / Sekolah</label>
              <input type="text" id="gen-instansi" value="SMK Thibbil Qulub Assimbani" oninput="onInstansiChange()" placeholder="Contoh: SMA Negeri 1 / SMK Thibbil Qulub" class="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white focus:border-brand-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Tahun Ajaran / Ujian</label>
              <input type="text" id="gen-tahun-ajaran" value="2025/2026" oninput="compilePrompt()" placeholder="Contoh: 2025/2026" class="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white focus:border-brand-500 outline-none font-semibold">
            </div>
          </div>

          <!-- Jenjang & Jumlah Soal Utama -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Jenjang</label>
              <select id="gen-jenjang" onchange="onJenjangChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs bg-white focus:border-brand-500 outline-none font-bold">
                <option value="SD">SD</option>
                <option value="SMP">SMP</option>
                <option value="SMA">SMA</option>
                <option value="SMK" selected>SMK</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Total Butir Soal</label>
              <input type="number" id="gen-jumlah" value="25" min="1" max="100" oninput="onTotalSoalChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:border-brand-500 outline-none font-bold">
            </div>
          </div>

          <!-- BLOK PARAMETER KHUSUS MODE ASESMEN SUMATIF (Kelas, Fase, Semester, Jenis Asesmen) -->
          <div id="wrapper-param-sumatif" class="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
            <div class="text-[11px] font-bold text-emerald-900 uppercase tracking-wider flex items-center justify-between">
              <span>📋 Parameter Kurikulum Merdeka</span>
              <span id="badge-jenjang-info" class="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold font-mono">SMK - Kelas X (Fase E)</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">Kelas</label>
                <select id="gen-kelas-select" onchange="onKelasChange()" class="w-full rounded-lg border border-emerald-300 p-2 text-xs bg-white focus:border-emerald-500 outline-none font-semibold">
                  <!-- Diisi otomatis oleh JS -->
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">Fase</label>
                <input type="text" id="gen-fase" readonly class="w-full rounded-lg border border-emerald-200 bg-emerald-100/60 p-2 text-xs text-emerald-900 font-bold outline-none text-center">
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">Semester</label>
                <select id="gen-semester" onchange="compilePrompt()" class="w-full rounded-lg border border-emerald-300 p-2 text-xs bg-white focus:border-emerald-500 outline-none">
                  <option value="Semester Ganjil" selected>Ganjil</option>
                  <option value="Semester Genap">Genap</option>
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">Jenis Asesmen</label>
                <select id="gen-jenis-asesmen" onchange="compilePrompt()" class="w-full rounded-lg border border-emerald-300 p-2 text-xs bg-white focus:border-emerald-500 outline-none font-semibold">
                  <option value="Asesmen Sumatif Akhir Semester (SAS)" selected>Sumatif Akhir Semester (SAS)</option>
                  <option value="Asesmen Sumatif Tengah Semester (STS)">Sumatif Tengah Semester (STS)</option>
                  <option value="Asesmen Sumatif Akhir Tahun (ASAT)">Sumatif Akhir Tahun (ASAT)</option>
                  <option value="Asesmen Sumatif Lingkup Materi">Sumatif Lingkup Materi (Harian)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Dropdown Jurusan Dinamis (Khusus SMK) -->
          <div id="wrapper-jurusan">
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-bold uppercase tracking-wider text-emerald-800">Konsentrasi Jurusan (Khusus SMK)</label>
              <button type="button" onclick="openAddJurusanModal()" class="text-[11px] text-brand-600 hover:text-brand-800 font-semibold hover:underline">
                + Tambah Jurusan
              </button>
            </div>
            <select id="gen-jurusan" onchange="onJurusanChange()" class="w-full rounded-xl border border-emerald-300 bg-emerald-50/40 p-2.5 text-xs focus:border-emerald-500 outline-none">
              <optgroup label="⭐ Jurusan Utama">
                <option value="Pengembangan Perangkat Lunak dan Gim (PPLG)" selected>Pengembangan Perangkat Lunak dan Gim (PPLG)</option>
              </optgroup>

              <option value="Umum">Umum / Lintas Bidang Keahlian</option>
              <optgroup id="optgroup-custom-jurusan" label="📁 Jurusan Kustom (Tersimpan)" class="hidden"></optgroup>

              <optgroup label="Teknologi Informasi & Komunikasi">
                <option value="Teknik Komputer dan Jaringan (TKJ)">Teknik Komputer dan Jaringan (TKJ)</option>
                <option value="Rekayasa Perangkat Lunak (RPL)">Rekayasa Perangkat Lunak (RPL)</option>
                <option value="Sistem Informatika, Jaringan, dan Aplikasi (SIJA)">SIJA (4 Tahun)</option>
              </optgroup>

              <optgroup label="Teknik Otomotif & Manufaktur">
                <option value="Teknik Kendaraan Ringan (TKR)">Teknik Kendaraan Ringan (TKR)</option>
                <option value="Teknik Sepeda Motor (TSM)">Teknik Sepeda Motor (TSM)</option>
                <option value="Teknik Pemesinan">Teknik Pemesinan (TPm)</option>
              </optgroup>

              <optgroup label="Bisnis, Manajemen & Pariwisata">
                <option value="Akuntansi dan Keuangan Lembaga (AKL)">Akuntansi dan Keuangan Lembaga (AKL)</option>
                <option value="Manajemen Perkantoran dan Layanan Bisnis (MPLB)">Manajemen Perkantoran (MPLB)</option>
                <option value="Desain Komunikasi Visual (DKV)">Desain Komunikasi Visual (DKV)</option>
                <option value="Kuliner / Tata Boga">Kuliner / Tata Boga</option>
              </optgroup>
            </select>
          </div>

          <!-- Mapel -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-bold uppercase tracking-wider text-slate-600">Mata Pelajaran</label>
              <span id="label-jenjang-filter" class="text-[11px] text-brand-600 font-medium"></span>
            </div>
            <select id="gen-mapel" onchange="onMapelChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs bg-white focus:border-brand-500 outline-none">
              <!-- Populated by JS -->
            </select>
          </div>

          <!-- KONTROL KHUSUS: MODE SPESIFIK MATRIKS -->
          <div id="wrapper-mode-specific" class="hidden space-y-4 pt-2 border-t border-slate-100">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-bold uppercase tracking-wider text-slate-600">Muatan / Elemen</label>
                <button type="button" onclick="toggleCustom('muatan')" class="text-[11px] text-brand-600 hover:underline">Edit Manual</button>
              </div>
              <select id="gen-muatan" onchange="onMuatanChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs bg-white focus:border-brand-500 outline-none">
                <!-- Populated by JS -->
              </select>
              <textarea id="gen-muatan-custom" rows="2" oninput="compilePrompt()" class="hidden mt-2 w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none" placeholder="Isi muatan kustom..."></textarea>
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-bold uppercase tracking-wider text-slate-600">Target Kompetensi</label>
                <button type="button" onclick="toggleCustom('kompetensi')" class="text-[11px] text-brand-600 hover:underline">Edit Manual</button>
              </div>
              <select id="gen-kompetensi" onchange="onKompetensiChange()" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs bg-white focus:border-brand-500 outline-none">
                <!-- Populated by JS -->
              </select>
              <textarea id="gen-kompetensi-custom" rows="2" oninput="compilePrompt()" class="hidden mt-2 w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none" placeholder="Isi kompetensi kustom..."></textarea>
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Sub Kompetensi <span class="text-slate-400 font-normal">(Centang satu atau lebih)</span>
              </label>
              <div id="gen-subkomp-container" class="max-h-48 overflow-y-auto space-y-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <!-- Populated by JS -->
              </div>
            </div>
          </div>

          <!-- KONTROL DISTRIBUSI (Dipakai untuk Asesmen Sumatif & TKA) -->
          <div id="wrapper-distribusi" class="space-y-4 pt-2 border-t border-slate-100">
            <div class="p-4 bg-brand-50/60 border border-brand-100 rounded-xl space-y-4">
              
              <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-brand-100">
                <h3 class="text-xs font-bold text-brand-900 uppercase tracking-wider">Distribusi Bentuk & Level Kognitif</h3>
                <div class="flex items-center gap-1 bg-white p-1 rounded-lg border border-brand-200 text-[11px]">
                  <button type="button" id="btn-dist-manual" onclick="setDistMode('manual')" class="px-2.5 py-1 font-semibold rounded bg-brand-600 text-white transition">
                    ✏️ Kustom Manual
                  </button>
                  <button type="button" id="btn-dist-auto" onclick="setDistMode('auto')" class="px-2.5 py-1 font-semibold rounded text-slate-600 hover:text-slate-900 transition">
                    % Hitung Otomatis
                  </button>
                </div>
              </div>

              <!-- TAMPILAN 1: KUSTOM MANUAL (DEFAULT) -->
              <div id="wrapper-dist-manual" class="space-y-3 text-xs">
                <div class="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-700">Ketentuan Pilihan Ganda (70% - 15% - 15%)</span>
                    <span id="badge-total-bentuk" class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">Total: 25</span>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div>
                      <label id="lbl-pg-sederhana" class="block text-[10px] text-slate-500 font-bold mb-1">PG Biasa</label>
                      <input type="number" id="manual-pg" value="17" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                    <div>
                      <label class="block text-[10px] text-slate-500 font-bold mb-1">PGK MCMA</label>
                      <input type="number" id="manual-pgk-mcma" value="4" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                    <div>
                      <label class="block text-[10px] text-slate-500 font-bold mb-1">PGK Kategori</label>
                      <input type="number" id="manual-pgk-kat" value="4" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                  </div>
                </div>

                <div class="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-700">Ketentuan Level Kognitif (30% - 40% - 30%)</span>
                    <span id="badge-total-kognitif" class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">Total: 25</span>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div>
                      <label class="block text-[10px] text-slate-500 font-bold mb-1">Pengetahuan / Pemahaman (L1)</label>
                      <input type="number" id="manual-l1" value="7" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                    <div>
                      <label class="block text-[10px] text-slate-500 font-bold mb-1">Penerapan / Aplikasi (L2)</label>
                      <input type="number" id="manual-l2" value="11" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                    <div>
                      <label class="block text-[10px] text-slate-500 font-bold mb-1">Penalaran (L3)</label>
                      <input type="number" id="manual-l3" value="7" min="0" oninput="onManualDistChange()" class="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-center focus:border-brand-500 outline-none font-mono">
                    </div>
                  </div>
                </div>
              </div>

              <!-- TAMPILAN 2: OTOMATIS PERSENTASE -->
              <div id="wrapper-dist-auto" class="hidden space-y-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div class="bg-white p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <span class="font-bold text-slate-700 block mb-1">Bentuk Soal</span>
                    <ul class="space-y-0.5 text-slate-600 text-[11px]" id="preview-bentuk-list"></ul>
                  </div>
                  <div class="bg-white p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <span class="font-bold text-slate-700 block mb-1">Level Kognitif</span>
                    <ul class="space-y-0.5 text-slate-600 text-[11px]" id="preview-kognitif-list"></ul>
                  </div>
                </div>
                <p class="text-[11px] text-slate-500 leading-relaxed italic">
                  *Kalkulasi butir soal otomatis disesuaikan secara matematis terhadap total soal.
                </p>
              </div>

            </div>
          </div>

        </div>

        <!-- Output Prompt Result -->
        <div class="lg:col-span-5 flex flex-col">
          <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full space-y-3">
            <div class="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 class="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Hasil Prompt
              </h2>
              <button onclick="copyToClipboard()" class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-sm transition">
                Salin Prompt
              </button>
            </div>

            <textarea id="output-text" readonly rows="18" class="w-full flex-1 rounded-xl border border-slate-200 bg-slate-50/60 p-4 font-mono text-xs leading-relaxed text-slate-800 resize-none outline-none"></textarea>

            <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span id="stat-counter">0 Karakter</span>
              <span id="copy-toast" class="text-emerald-600 font-semibold opacity-0 transition-opacity">✅ Tersalin ke clipboard!</span>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- ============================================================ -->
    <!-- TAB 2: KELOLA MATA PELAJARAN (CRUD)                         -->
    <!-- ============================================================ -->
    <div id="tab-mapel" class="hidden space-y-6">
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 class="text-base font-bold text-slate-900">Daftar Mata Pelajaran</h2>
            <p class="text-xs text-slate-500">Mendukung jenjang SD, SMP, SMA, SMK, atau SEMUA (Lintas jenjang).</p>
          </div>
          <div class="flex items-center gap-2">
            <input type="text" id="filter-mapel-input" oninput="filterMapelTable()" placeholder="Cari mapel..." class="px-3 py-2 border border-slate-300 rounded-xl text-xs outline-none focus:border-brand-500 w-48">
            <button onclick="openSubjectModal()" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl shadow-sm transition">
              + Tambah Mapel
            </button>
          </div>
        </div>

        <div class="overflow-x-auto max-h-[600px]">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-600 uppercase font-semibold sticky top-0 z-10">
              <tr>
                <th class="px-4 py-3">Nama Mapel</th>
                <th class="px-4 py-3">Jenjang</th>
                <th class="px-4 py-3">Muatan Ringkas</th>
                <th class="px-4 py-3">Kompetensi Ringkas</th>
                <th class="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody id="table-subject-body" class="divide-y divide-slate-100">
              <?php foreach ($subjects as $s): ?>
              <tr class="hover:bg-slate-50/70 subject-row" data-name="<?= strtolower(htmlspecialchars($s['nama'])) ?>">
                <td class="px-4 py-3 font-semibold text-slate-900"><?= htmlspecialchars($s['nama']) ?></td>
                <td class="px-4 py-3">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold 
                    <?= $s['jenjang'] === 'SD' ? 'bg-red-50 text-red-700' : 
                       ($s['jenjang'] === 'SMP' ? 'bg-blue-50 text-blue-700' : 
                       ($s['jenjang'] === 'SMA' ? 'bg-indigo-50 text-indigo-700' : 
                       ($s['jenjang'] === 'SMK' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'))) ?>">
                    <?= $s['jenjang'] ?>
                  </span>
                </td>
                <td class="px-4 py-3 text-slate-500 max-w-xs truncate" title="<?= htmlspecialchars($s['muatan']) ?>">
                  <?= htmlspecialchars(mb_substr($s['muatan'], 0, 60)) ?>...
                </td>
                <td class="px-4 py-3 text-slate-500 max-w-xs truncate" title="<?= htmlspecialchars($s['kompetensi']) ?>">
                  <?= htmlspecialchars(mb_substr($s['kompetensi'], 0, 60)) ?>...
                </td>
                <td class="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  <button onclick='editSubjectModal(<?= json_encode($s, JSON_HEX_APOS | JSON_HEX_QUOT) ?>)' class="text-brand-600 hover:underline font-semibold">Edit</button>
                  <form method="POST" class="inline" onsubmit="return confirm('Yakin ingin menghapus mapel ini?')">
                    <input type="hidden" name="action" value="delete_subject">
                    <input type="hidden" name="subject_id" value="<?= $s['id'] ?>">
                    <button type="submit" class="text-rose-600 hover:underline font-semibold">Hapus</button>
                  </form>
                </td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- TAB 3: ADMIN TEMPLATE PANEL                                 -->
    <!-- ============================================================ -->
    <div id="tab-admin" class="hidden space-y-6">
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <div class="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 class="text-base font-bold text-slate-900">Manajemen Template Prompt</h2>
            <p class="text-xs text-slate-500">Sesuaikan struktur prompt asesmen atau buat formula instruksi baru.</p>
          </div>
          <button onclick="openModal()" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl shadow-sm transition">
            + Tambah Template Baru
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-600 uppercase font-semibold">
              <tr>
                <th class="px-4 py-3 rounded-l-lg">Nama Template</th>
                <th class="px-4 py-3">Tipe</th>
                <th class="px-4 py-3">Struktur Formula</th>
                <th class="px-4 py-3 text-right rounded-r-lg">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <?php foreach ($templates as $t): ?>
              <tr class="hover:bg-slate-50/70">
                <td class="px-4 py-3 font-semibold text-slate-900"><?= htmlspecialchars($t['nama']) ?></td>
                <td class="px-4 py-3">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold <?= $t['tipe'] === 'sumatif' ? 'bg-emerald-50 text-emerald-700' : ($t['tipe'] === 'tka_full' ? 'bg-purple-50 text-purple-700' : 'bg-indigo-50 text-brand-600') ?>">
                    <?= strtoupper($t['tipe']) ?>
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-slate-500 max-w-sm truncate" title="<?= htmlspecialchars($t['template']) ?>">
                  <?= htmlspecialchars($t['template']) ?>
                </td>
                <td class="px-4 py-3 text-right space-x-2">
                  <button onclick='editModal(<?= json_encode($t) ?>)' class="text-brand-600 hover:underline font-semibold">Edit</button>
                  <form method="POST" class="inline" onsubmit="return confirm('Hapus template ini?')">
                    <input type="hidden" name="action" value="delete_template">
                    <input type="hidden" name="template_id" value="<?= $t['id'] ?>">
                    <button type="submit" class="text-rose-600 hover:underline font-semibold">Hapus</button>
                  </form>
                </td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- TAB 4: DATA MANAGER (IMPORT / EXPORT)                       -->
    <!-- ============================================================ -->
    <div id="tab-data" class="hidden space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <!-- Import Card -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 class="text-sm font-bold text-slate-900 flex items-center gap-2">
            📥 Import matriks_tka.json ke SQLite
          </h2>
          <p class="text-xs text-slate-500 leading-relaxed">
            Unggah file JSON. Mapel tanpa jenjang eksplisit otomatis berstatus <code class="bg-slate-100 px-1 py-0.5 rounded text-brand-600">SEMUA</code> agar bisa dipakai bersama.
          </p>

          <form method="POST" enctype="multipart/form-data" class="space-y-3">
            <input type="hidden" name="action" value="import_matrix">
            <input type="file" name="json_file" accept=".json" required class="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100">
            <button type="submit" class="w-full py-2.5 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold shadow-sm transition">
              Proses Impor JSON
            </button>
          </form>
        </div>

        <!-- Export Card -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 class="text-sm font-bold text-slate-900 flex items-center gap-2">
            📤 Ekspor Data Matriks
          </h2>
          <p class="text-xs text-slate-500 leading-relaxed">
            Unduh seluruh mata pelajaran dan tabel matriks yang tersimpan di SQLite dalam format JSON.
          </p>

          <div class="pt-3">
            <a href="?action=export_matrix" class="block text-center w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold shadow-sm transition">
              Unduh matriks_asesmen.json
            </a>
          </div>
        </div>

      </div>
    </div>

  </main>

  <!-- MODAL TAMBAH JURUSAN BARU (SMK) -->
  <div id="modal-add-jurusan" class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm hidden flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between">
        <h3 class="text-sm font-bold text-slate-900">Tambah Jurusan / Konsentrasi Baru</h3>
        <button type="button" onclick="closeAddJurusanModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <div class="p-5 space-y-3.5">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nama Jurusan / Konsentrasi</label>
          <input type="text" id="input-new-jurusan" placeholder="Contoh: Teknik Otomasi Industri" class="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none">
        </div>
        <p class="text-[11px] text-slate-500 leading-relaxed">
          Jurusan ini akan otomatis tersimpan di peramban Anda dan langsung terintegrasi untuk penyusunan konteks soal kejuruan.
        </p>
      </div>

      <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
        <button type="button" onclick="closeAddJurusanModal()" class="px-4 py-2 text-xs text-slate-600">Batal</button>
        <button type="button" onclick="saveNewJurusan()" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition">Simpan Jurusan</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAPEL -->
  <div id="modal-subject" class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm hidden flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      <form method="POST">
        <input type="hidden" name="action" value="save_subject">
        <input type="hidden" id="modal-sub-id" name="subject_id">

        <div class="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 id="modal-sub-title" class="text-sm font-bold text-slate-900">Tambah Mata Pelajaran</h3>
          <button type="button" onclick="closeSubjectModal()" class="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div class="p-5 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nama Mata Pelajaran</label>
              <input type="text" id="modal-sub-nama" name="subject_nama" required class="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Jenjang Target</label>
              <select id="modal-sub-jenjang" name="subject_jenjang" class="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none">
                <option value="SD">SD</option>
                <option value="SMP">SMP</option>
                <option value="SMA">SMA</option>
                <option value="SMK">SMK</option>
                <option value="SMA/SMK">SMA / SMK (Umum)</option>
                <option value="SEMUA">SEMUA (SD, SMP, SMA, SMK)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Muatan / Elemen Materi</label>
            <textarea id="modal-sub-muatan" name="subject_muatan" rows="3" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:border-brand-500 outline-none leading-relaxed" placeholder="Deskripsi umum muatan atau materi..."></textarea>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Target Kompetensi Utama</label>
            <textarea id="modal-sub-kompetensi" name="subject_kompetensi" rows="3" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:border-brand-500 outline-none leading-relaxed" placeholder="Deskripsi umum kompetensi..."></textarea>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Struktur Matriks (JSON)</label>
            <textarea id="modal-sub-matriks" name="subject_matriks_json" rows="6" class="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-mono focus:border-brand-500 outline-none leading-relaxed" placeholder='{"rows": [{"Elemen": "...", "Kompetensi": "...", "Subkompetensi": "..."}]}'></textarea>
          </div>
        </div>

        <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0">
          <button type="button" onclick="closeSubjectModal()" class="px-4 py-2 text-xs text-slate-600">Batal</button>
          <button type="submit" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition">Simpan Mapel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL TEMPLATE -->
  <div id="modal-tpl" class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm hidden flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-xl overflow-hidden">
      <form method="POST">
        <input type="hidden" name="action" value="save_template">
        <input type="hidden" id="modal-tpl-id" name="template_id">

        <div class="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 id="modal-tpl-title" class="text-sm font-bold text-slate-900">Tambah Template Baru</h3>
          <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nama Template</label>
            <input type="text" id="modal-tpl-name" name="template_name" required class="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Kategori Tipe</label>
            <select id="modal-tpl-type" name="template_type" class="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-brand-500 outline-none">
              <option value="sumatif">Asesmen Sumatif (Fase/Semester)</option>
              <option value="tka_full">TKA / AKM (Full Matriks Nasional)</option>
              <option value="specific">Spesifik (Per Target Kompetensi)</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Placeholder Variabel</label>
            <div class="flex flex-wrap gap-1 mb-2">
              <button type="button" onclick="insertVar('{INSTANSI}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{INSTANSI}</button>
              <button type="button" onclick="insertVar('{TAHUN_AJARAN}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{TAHUN_AJARAN}</button>
              <button type="button" onclick="insertVar('{JENIS_ASESMEN}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{JENIS_ASESMEN}</button>
              <button type="button" onclick="insertVar('{SEMESTER}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{SEMESTER}</button>
              <button type="button" onclick="insertVar('{FASE}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{FASE}</button>
              <button type="button" onclick="insertVar('{OPSI_PG}')" class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-[11px] font-mono font-semibold">{OPSI_PG}</button>
              <button type="button" onclick="insertVar('{MAPEL}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{MAPEL}</button>
              <button type="button" onclick="insertVar('{JENJANG}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{JENJANG}</button>
              <button type="button" onclick="insertVar('{JURUSAN}')" class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[11px] font-mono font-semibold">{JURUSAN}</button>
              <button type="button" onclick="insertVar('{TOTAL_SOAL}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{TOTAL_SOAL}</button>
              <button type="button" onclick="insertVar('{DISTRIBUSI_BENTUK}')" class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[11px] font-mono">{DISTRIBUSI_BENTUK}</button>
              <button type="button" onclick="insertVar('{DISTRIBUSI_KOGNITIF}')" class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[11px] font-mono">{DISTRIBUSI_KOGNITIF}</button>
              <button type="button" onclick="insertVar('{TABEL_MATRIKS}')" class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[11px] font-mono">{TABEL_MATRIKS}</button>
              <button type="button" onclick="insertVar('{MUATAN}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{MUATAN}</button>
              <button type="button" onclick="insertVar('{KOMPETENSI}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{KOMPETENSI}</button>
              <button type="button" onclick="insertVar('{SUB_KOMPETENSI}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{SUB_KOMPETENSI}</button>
              <button type="button" onclick="insertVar('{KELAS}')" class="px-2 py-1 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded text-[11px] font-mono">{KELAS}</button>
            </div>
            <textarea id="modal-tpl-text" name="template_text" rows="6" required class="w-full rounded-xl border border-slate-300 p-3 text-xs font-mono focus:border-brand-500 outline-none leading-relaxed"></textarea>
          </div>
        </div>

        <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-xs text-slate-600">Batal</button>
          <button type="submit" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition">Simpan ke SQLite</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Client-side Logic -->
  <script>
    const DB_TEMPLATES = <?= json_encode($templates, JSON_UNESCAPED_UNICODE) ?>;
    const DB_SUBJECTS = <?= json_encode($subjects, JSON_UNESCAPED_UNICODE) ?>;

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
        if (fase === 'A') return 'pilihan ganda 3 opsi (A–C)';
        return 'pilihan ganda 4 opsi (A–D)';
      } else if (jenjang === 'SMP') {
        return 'pilihan ganda 4 opsi (A–D)';
      }
      return 'pilihan ganda 5 opsi (A–E)';
    }

    function onInstansiChange() {
      const instansi = document.getElementById('gen-instansi').value.trim();
      document.getElementById('topbar-instansi').textContent = instansi || 'Pusat Asesmen Pendidikan';
      compilePrompt();
    }

    function onJurusanChange() {
      const jVal = document.getElementById('gen-jurusan').value;
      document.getElementById('topbar-jurusan-badge').textContent = jVal === 'Umum' ? 'UMUM' : (jVal.match(/\(([^)]+)\)/) ? jVal.match(/\(([^)]+)\)/)[1] : jVal.substring(0, 10));
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
      document.getElementById('lbl-pg-sederhana').textContent = deskripsiOpsi.includes('A–C') ? 'PG (A–C)' : (deskripsiOpsi.includes('A–D') ? 'PG (A–D)' : 'PG (A–E)');

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

      // Reset style tombol
      [btnSumatif, btnTka, btnSpec].forEach(b => {
        b.className = "py-2 px-2 text-xs font-bold rounded-lg transition-all text-slate-600 hover:text-slate-900";
      });

      if (mode === 'sumatif') {
        btnSumatif.className = "py-2 px-2 text-xs font-bold rounded-lg transition-all bg-white text-emerald-700 shadow-sm";
        wrapSumatif.classList.remove('hidden');
        wrapSpec.classList.add('hidden');
        wrapDist.classList.remove('hidden');

        // Pilih template sumatif
        const tpl = DB_TEMPLATES.find(t => t.tipe === 'sumatif');
        if (tpl) document.getElementById('gen-template').value = tpl.id;

      } else if (mode === 'tka') {
        btnTka.className = "py-2 px-2 text-xs font-bold rounded-lg transition-all bg-white text-brand-700 shadow-sm";
        wrapSumatif.classList.add('hidden');
        wrapSpec.classList.add('hidden');
        wrapDist.classList.remove('hidden');

        // Pilih template TKA Full Matriks
        const tpl = DB_TEMPLATES.find(t => t.tipe === 'tka_full');
        if (tpl) document.getElementById('gen-template').value = tpl.id;

      } else {
        btnSpec.className = "py-2 px-2 text-xs font-bold rounded-lg transition-all bg-white text-brand-700 shadow-sm";
        wrapSumatif.classList.add('hidden');
        wrapSpec.classList.remove('hidden');
        wrapDist.classList.remove('hidden');

        // Pilih template spesifik
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
        btnAuto.className = "px-2.5 py-1 font-semibold rounded bg-brand-600 text-white transition";
        btnManual.className = "px-2.5 py-1 font-semibold rounded text-slate-600 hover:text-slate-900 transition";
        wrapAuto.classList.remove('hidden');
        wrapManual.classList.add('hidden');
      } else {
        btnManual.className = "px-2.5 py-1 font-semibold rounded bg-brand-600 text-white transition";
        btnAuto.className = "px-2.5 py-1 font-semibold rounded text-slate-600 hover:text-slate-900 transition";
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
      badgeB.className = `text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${totBentuk === totalTarget ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`;
      badgeK.className = `text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${totKognitif === totalTarget ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`;
    }

    function onTemplateChange() {
      compilePrompt();
    }

    function onMapelChange() {
      const mapelName = document.getElementById('gen-mapel').value;
      const mapel = DB_SUBJECTS.find(s => s.nama === mapelName);
      if (!mapel) return;

      const selMuatan = document.getElementById('gen-muatan');
      selMuatan.innerHTML = '';

      let rows = [];
      try {
        const matriksObj = JSON.parse(mapel.matriks_json);
        rows = matriksObj.rows || [];
      } catch(e) {}

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

      let rows = [];
      try {
        const matriksObj = JSON.parse(mapel.matriks_json);
        rows = matriksObj.rows || [];
      } catch(e) {}

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
        opt.value = mapel.kompetensi ? mapel.kompetensi.split('\n')[0] : "Penerapan konsep dan penalaran";
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

      let rows = [];
      try {
        const matriksObj = JSON.parse(mapel.matriks_json);
        rows = matriksObj.rows || [];
      } catch(e) {}

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
          label.className = "flex items-start gap-2 p-1.5 rounded hover:bg-white cursor-pointer text-xs";
          label.innerHTML = `
            <input type="checkbox" value="${s}" ${idx === 0 ? 'checked' : ''} onchange="compilePrompt()" class="mt-0.5 rounded border-slate-300 text-brand-600 subkomp-chk">
            <span class="text-slate-700 select-none leading-snug">${s}</span>
          `;
          container.appendChild(label);
        });
      } else {
        container.innerHTML = `<p class="text-[11px] text-slate-400 italic">Menggunakan target capaian kompetensi utama.</p>`;
      }

      compilePrompt();
    }

    function matrixToMarkdownTable(mapel) {
      let rows = [];
      try {
        const matriksObj = JSON.parse(mapel.matriks_json);
        rows = matriksObj.rows || [];
      } catch(e) {}

      if (!rows || rows.length === 0) {
        return `Muatan / Elemen: ${mapel.muatan || '-'}\nKompetensi / TP: ${mapel.kompetensi || '-'}`;
      }

      let md = "| No | Elemen / Muatan | Kompetensi / Indikator | Batasan / Catatan |\n";
      md += "|:---|:---|:---|:---|\n";

      rows.forEach((r, idx) => {
        const f = extractRowFields(r);
        const elemen = (f.elemen || f.subElemen || '-').replace(/[\r\n|]+/g, ' ');
        const komp = (f.subKompetensi || f.kompetensi || '-').replace(/[\r\n|]+/g, ' ');
        const batasan = (r["Batasan/Catatan"] || r["Batasan / Catatan"] || r["Batasan/catatan"] || r["Batasan/Cakupan"] || '-').replace(/[\r\n|]+/g, ' ');

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

      // Opsi Pilihan Ganda sesuai jenjang
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
        toast.classList.remove('opacity-0');
        setTimeout(() => toast.classList.add('opacity-0'), 2000);
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
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`btn-tab-${t}`).className = "px-4 py-2 text-xs font-semibold rounded-lg transition text-slate-600 hover:text-slate-900";
      });
      document.getElementById(`tab-${tabId}`).classList.remove('hidden');
      document.getElementById(`btn-tab-${tabId}`).className = "px-4 py-2 text-xs font-semibold rounded-lg transition bg-white text-brand-700 shadow-sm";
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
      const customList = stored ? JSON.parse(stored) : [];
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
      let customList = stored ? JSON.parse(stored) : [];

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
      document.getElementById('modal-tpl-title').textContent = "Tambah Template Baru";
      document.getElementById('modal-tpl-id').value = "";
      document.getElementById('modal-tpl-name').value = "";
      document.getElementById('modal-tpl-type').value = "sumatif";
      document.getElementById('modal-tpl-text').value = "";
      document.getElementById('modal-tpl').classList.remove('hidden');
    }

    function editModal(t) {
      document.getElementById('modal-tpl-title').textContent = "Edit Template";
      document.getElementById('modal-tpl-id').value = t.id;
      document.getElementById('modal-tpl-name').value = t.nama;
      document.getElementById('modal-tpl-type').value = t.tipe;
      document.getElementById('modal-tpl-text').value = t.template;
      document.getElementById('modal-tpl').classList.remove('hidden');
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
      document.getElementById('modal-sub-title').textContent = "Tambah Mata Pelajaran";
      document.getElementById('modal-sub-id').value = "";
      document.getElementById('modal-sub-nama').value = "";
      document.getElementById('modal-sub-jenjang').value = "SEMUA";
      document.getElementById('modal-sub-muatan').value = "";
      document.getElementById('modal-sub-kompetensi').value = "";
      document.getElementById('modal-sub-matriks').value = '{\n  "rows": []\n}';
      document.getElementById('modal-subject').classList.remove('hidden');
    }

    function editSubjectModal(s) {
      document.getElementById('modal-sub-title').textContent = "Edit Mata Pelajaran: " + s.nama;
      document.getElementById('modal-sub-id').value = s.id;
      document.getElementById('modal-sub-nama').value = s.nama;
      document.getElementById('modal-sub-jenjang').value = s.jenjang;
      document.getElementById('modal-sub-muatan').value = s.muatan || '';
      document.getElementById('modal-sub-kompetensi').value = s.kompetensi || '';
      
      let formattedMatriks = s.matriks_json;
      try {
        formattedMatriks = JSON.stringify(JSON.parse(s.matriks_json), null, 2);
      } catch(e) {}
      document.getElementById('modal-sub-matriks').value = formattedMatriks;

      document.getElementById('modal-subject').classList.remove('hidden');
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
      setGenerationMode('sumatif'); // Default aktif di Mode Asesmen Sumatif
      setDistMode('manual');
      updateManualBadges();
    });
  </script>
</body>
</html>