<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $n = ['profile' => [], 'db' => [], 'ollama' => []];
    $n['provider'] = ($_POST['provider'] ?? '') === 'claude' ? 'claude' : 'ollama';
    if (preg_match('#^https?://[\w.\-:]+$#', $_POST['ollama_url'] ?? '')) $n['ollama']['url'] = rtrim($_POST['ollama_url'], '/');
    if (preg_match('/^[\w.\-:\/]+$/', $_POST['ollama_model'] ?? '')) $n['ollama']['model'] = $_POST['ollama_model'];
    if (in_array((int)($_POST['num_ctx'] ?? 0), [4096, 8192, 16384], true)) $n['ollama']['num_ctx'] = (int)$_POST['num_ctx'];
    $n['ollama']['think'] = !empty($_POST['think']);
    if (isset($_POST['clear_key'])) $n['api_key'] = '';
    elseif (trim($_POST['api_key'] ?? '') !== '') $n['api_key'] = trim($_POST['api_key']);
    $n['model'] = preg_replace('/[^a-z0-9.\-]/', '', $_POST['model'] ?? '') ?: 'claude-opus-5-5';
    $n['effort'] = in_array($_POST['effort'] ?? '', ['low', 'medium', 'high', 'xhigh'], true) ? $_POST['effort'] : 'medium';
    foreach (['work_start', 'work_end', 'lunch_start', 'lunch_end'] as $k) if (preg_match('/^\d{2}:\d{2}$/', $_POST[$k] ?? '')) $n['profile'][$k] = $_POST[$k];
    foreach (['default_travel_min', 'buffer_min', 'stale_days'] as $k) if (is_numeric($_POST[$k] ?? null)) $n['profile'][$k] = (int)$_POST[$k];
    if (isset($_POST['db_port']) && is_numeric($_POST['db_port'])) $n['db']['port'] = (int)$_POST['db_port'];
    if (isset($_POST['db_user'])) $n['db']['user'] = trim($_POST['db_user']);
    if (isset($_POST['db_password'])) $n['db']['password'] = $_POST['db_password'];
    if (trim($_POST['node_path'] ?? '') !== '') $n['node_path'] = trim($_POST['node_path']);
    save_settings($n);
    header('Location: settings.php?saved=1'); exit;
}
$s = settings(); $p = $s['profile'];
$mask = $s['api_key'] ? substr($s['api_key'], 0, 10) . '…' . substr($s['api_key'], -4) : '';
$dbErr = db_ok();
layout_head('ตั้งค่า', 'settings.php');
?>
<h1 class="h4 fw-bold mb-4"><i class="bi bi-gear me-2"></i>ตั้งค่า</h1>
<?php if (isset($_GET['saved'])): ?><div class="alert alert-success alert-dismissible fade show"><i class="bi bi-check-circle me-1"></i>บันทึกแล้ว<button class="btn-close" data-bs-dismiss="alert"></button></div><?php endif; ?>
<div class="alert d-none" id="msg"></div>
<?php $models = ollama_models(); $o = $s['ollama']; $prob = ai_problem(); ?>
<form method="post" class="row g-4">
  <div class="col-12"><div class="card"><div class="card-header d-flex justify-content-between"><span><i class="bi bi-cpu me-1 text-primary"></i>สมองของผู้ช่วย (AI engine)</span>
    <span class="badge <?= $prob ? 'text-bg-warning' : 'text-bg-success' ?>"><?= $prob ? h($prob) : 'พร้อมใช้งาน · ' . h(engine_label()) ?></span></div>
    <div class="card-body"><div class="row g-3">
      <div class="col-md-6"><input type="radio" class="btn-check" name="provider" id="pv1" value="ollama" <?= $s['provider'] !== 'claude' ? 'checked' : '' ?>>
        <label class="btn btn-outline-primary w-100 text-start p-3 h-100" for="pv1"><div class="fw-bold"><i class="bi bi-pc-display me-1"></i>LLM ในเครื่อง (Ollama) — ฟรี</div>
          <div class="small">ข้อมูลไม่ออกนอกเครื่อง · โมเดลเล็กทำเฉพาะงานภาษา ส่วนค้นหา/เช็กซ้ำ/จัดตาราง/แปลงเวลาไทย ทำด้วยโค้ด จึงแม่นและเร็วบนการ์ดจอ 4GB</div></label></div>
      <div class="col-md-6"><input type="radio" class="btn-check" name="provider" id="pv2" value="claude" <?= $s['provider'] === 'claude' ? 'checked' : '' ?>>
        <label class="btn btn-outline-primary w-100 text-start p-3 h-100" for="pv2"><div class="fw-bold"><i class="bi bi-stars me-1"></i>Claude API — เสียค่าใช้จ่ายตามการใช้งาน</div>
          <div class="small">Claude เป็น Agent เต็มรูปแบบ เลือกเรียกเครื่องมือ MCP เอง เข้าใจภาษากำกวมได้ดีกว่า · ต้องมี API key และเครดิต</div></label></div>
    </div></div></div></div>

  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-pc-display text-primary me-1"></i>LLM ในเครื่อง (Ollama)</div><div class="card-body vstack gap-3">
    <div class="form-floating"><input name="ollama_url" id="ou" value="<?= h($o['url']) ?>" class="form-control"><label for="ou">Ollama URL</label></div>
    <div class="row g-3">
      <div class="col-7"><div class="form-floating"><select name="ollama_model" id="om" class="form-select">
        <?php foreach (array_unique(array_merge([$o['model']], array_filter($models ?? [], fn($m) => !str_contains($m, 'bge') && !str_contains($m, 'embed')))) as $m): ?>
          <option <?= $m === $o['model'] ? 'selected' : '' ?>><?= h($m) ?></option><?php endforeach; ?>
      </select><label for="om">โมเดลภาษา</label></div></div>
      <div class="col-5"><div class="form-floating"><select name="num_ctx" id="nc" class="form-select"><?php foreach ([4096, 8192, 16384] as $c): ?><option <?= (int)$o['num_ctx'] === $c ? 'selected' : '' ?>><?= $c ?></option><?php endforeach; ?></select><label for="nc">Context (token)</label></div></div>
    </div>
    <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="think" id="th" <?= $o['think'] ? 'checked' : '' ?>><label class="form-check-label" for="th">โหมดคิดก่อนตอบ (think) — แม่นขึ้นเล็กน้อย แต่ช้าลง 3–5 เท่า</label></div>
    <div class="small text-body-secondary">
      <?php if ($models === null): ?><span class="text-danger"><i class="bi bi-x-circle"></i> ต่อ Ollama ไม่ได้</span>
      <?php else: ?><i class="bi bi-check-circle text-success"></i> โมเดลในเครื่อง: <?= h(implode(', ', $models)) ?><?php endif; ?><br>
      ค้นหาบริบทด้วย embedding: <code><?= h($o['embed_model']) ?></code> · แนะนำ <code>qwen3:4b</code> สำหรับการ์ดจอ 4GB (ทดสอบแล้วผ่าน Eval 7/7) · ถ้ามีการ์ดจอ 8GB+ ลอง <code>qwen3:8b</code>
    </div>
  </div></div></div>

  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-stars text-primary me-1"></i>Claude API</div><div class="card-body vstack gap-3">
    <div><label class="form-label">Anthropic API key <?= $mask ? '<span class="badge text-bg-success">ตั้งค่าแล้ว</span>' : '<span class="badge text-bg-warning">ยังไม่ตั้งค่า</span>' ?></label>
      <div class="input-group"><span class="input-group-text"><i class="bi bi-key"></i></span>
        <input name="api_key" id="key" type="password" class="form-control font-monospace" autocomplete="off" placeholder="<?= $mask ? h($mask) . ' (เว้นว่าง = ใช้คีย์เดิม)' : 'sk-ant-…' ?>">
        <button class="btn btn-outline-secondary" type="button" onclick="key.type=key.type==='password'?'text':'password'"><i class="bi bi-eye"></i></button></div>
      <div class="form-text">สร้างคีย์ที่ <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> → API Keys · เก็บใน storage/settings.json (เว็บเข้าไม่ได้)</div></div>
    <div class="row g-3">
      <div class="col-7"><div class="form-floating"><select name="model" id="m" class="form-select">
        <?php foreach (['claude-opus-5-5' => 'Claude Opus 5.5 (แนะนำ)', 'claude-sonnet-5-5' => 'Claude Sonnet 5.5 (ถูกกว่า)', 'claude-haiku-5-5' => 'Claude Haiku 5.5 (ถูกสุด)'] as $k => $l): ?><option value="<?= $k ?>" <?= $s['model'] === $k ? 'selected' : '' ?>><?= $l ?></option><?php endforeach; ?>
      </select><label for="m">Model</label></div></div>
      <div class="col-5"><div class="form-floating"><select name="effort" id="ef" class="form-select"><?php foreach (['low', 'medium', 'high', 'xhigh'] as $e): ?><option <?= $s['effort'] === $e ? 'selected' : '' ?>><?= $e ?></option><?php endforeach; ?></select><label for="ef">Effort</label></div></div>
    </div>
    <?php if ($s['api_key']): ?><div><button name="clear_key" value="1" class="btn btn-sm btn-outline-danger" onclick="return confirm('ลบ API key?')"><i class="bi bi-trash me-1"></i>ลบคีย์</button></div><?php endif; ?>
  </div></div></div>

  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-clock me-1 text-primary"></i>เวลาทำงาน (ใช้จัดตาราง)</div><div class="card-body">
    <div class="row g-3">
      <?php foreach (['work_start' => 'เริ่มงาน', 'work_end' => 'เลิกงาน', 'lunch_start' => 'พักเที่ยง', 'lunch_end' => 'จบพัก'] as $k => $l): ?>
        <div class="col-6 col-md-3"><div class="form-floating"><input type="time" name="<?= $k ?>" id="<?= $k ?>" value="<?= h($p[$k]) ?>" class="form-control"><label for="<?= $k ?>"><?= $l ?></label></div></div>
      <?php endforeach; ?>
      <div class="col-4"><div class="form-floating"><input type="number" name="default_travel_min" id="tm" value="<?= (int)$p['default_travel_min'] ?>" class="form-control"><label for="tm">เดินทาง (นาที)</label></div></div>
      <div class="col-4"><div class="form-floating"><input type="number" name="buffer_min" id="bm" value="<?= (int)$p['buffer_min'] ?>" class="form-control"><label for="bm">เผื่อระหว่างนัด</label></div></div>
      <div class="col-4"><div class="form-floating"><input type="number" name="stale_days" id="sd" value="<?= (int)$p['stale_days'] ?>" class="form-control"><label for="sd">ค้างกี่วันจึงเตือน</label></div></div>
    </div></div></div></div>

  <div class="col-lg-6"><div class="card h-100"><div class="card-header d-flex justify-content-between"><span><i class="bi bi-database me-1 text-primary"></i>ฐานข้อมูล MySQL (XAMPP)</span>
      <span class="badge <?= $dbErr ? 'text-bg-danger' : 'text-bg-success' ?>"><?= $dbErr ? 'ต่อไม่ได้' : 'เชื่อมต่อแล้ว' ?></span></div><div class="card-body vstack gap-3">
    <div class="row g-3">
      <div class="col-4"><div class="form-floating"><input name="db_port" id="dp" value="<?= (int)$s['db']['port'] ?>" class="form-control"><label for="dp">Port</label></div></div>
      <div class="col-4"><div class="form-floating"><input name="db_user" id="du" value="<?= h($s['db']['user']) ?>" class="form-control"><label for="du">User</label></div></div>
      <div class="col-4"><div class="form-floating"><input name="db_password" id="dw" type="password" value="<?= h($s['db']['password']) ?>" class="form-control"><label for="dw">Password</label></div></div>
    </div>
    <div class="small text-body-secondary">ฐานข้อมูล <code><?= h($s['db']['database']) ?></code> · MySQL ของ XAMPP เครื่องนี้อยู่ที่พอร์ต 3307</div>
    <div class="d-flex flex-wrap gap-2">
      <button type="button" class="btn btn-sm btn-outline-primary" onclick="setup({})"><i class="bi bi-database-add me-1"></i>สร้างตาราง (ถ้ายังไม่มี)</button>
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="if(confirm('ล้างข้อมูลทั้งหมดแล้วใส่ข้อมูลตัวอย่าง?'))setup({reset:1,seed:1})"><i class="bi bi-arrow-counterclockwise me-1"></i>รีเซ็ต + ข้อมูลตัวอย่าง</button>
    </div>
  </div></div></div>

  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-terminal me-1 text-primary"></i>Node.js (รัน MCP servers + Agent)</div><div class="card-body">
    <input name="node_path" value="<?= h($s['node_path']) ?>" class="form-control font-monospace small">
    <div class="form-text <?= node_path() ? 'text-success' : 'text-danger' ?>"><i class="bi bi-<?= node_path() ? 'check-circle' : 'x-circle' ?> me-1"></i><?= node_path() ? 'พบ node.exe' : 'ไม่พบ node.exe' ?></div>
    <div class="small text-body-secondary mt-2">ใช้ MCP servers กับ Claude Code / Claude Desktop ได้ด้วย — ดูคำสั่งใน README.md</div>
  </div></div></div>
  <div class="col-12"><button class="btn btn-primary btn-lg px-5"><i class="bi bi-save me-2"></i>บันทึก</button></div>
</form>
<?php layout_foot('<script>async function setup(b){const m=document.getElementById("msg");m.className="alert alert-info";m.textContent="กำลังทำงาน…";const r=await api("setup_db",b);m.className="alert "+(r.ok?"alert-success":"alert-danger");m.textContent=r.ok?r.message:(r.error||"ไม่สำเร็จ");}</script>');
