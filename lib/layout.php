<?php
function layout_head(string $title, string $active = ''): void
{
    $nav = [
        'index.php' => ['bi-inbox', 'รับเรื่อง'],
        'brief.php' => ['bi-sunrise', 'แผนวันนี้'],
        'data.php' => ['bi-database', 'ข้อมูล'],
        'runs.php' => ['bi-cpu', 'การทำงานของ Agent'],
        'eval.php' => ['bi-clipboard-check', 'Eval'],
        'prompts.php' => ['bi-chat-square-text', 'Prompts'],
        'settings.php' => ['bi-gear', 'ตั้งค่า'],
    ];
    $dbErr = db_ok();
    $openQ = $dbErr ? 0 : (int)row("SELECT COUNT(*) n FROM clarifications WHERE status='open'")['n'];
    ?><!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= h($title) ?> · Chief of Staff</title>
<link rel="stylesheet" href="assets/bootstrap.min.css">
<link rel="stylesheet" href="assets/bootstrap-icons.min.css">
<link rel="stylesheet" href="assets/app.css?v=1">
<script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-bs-theme',t)}catch(e){}</script>
</head><body>
<nav class="navbar navbar-expand-lg navbar-dark app-nav">
  <div class="container-xl">
    <a class="navbar-brand d-flex align-items-center gap-2" href="index.php"><i class="bi bi-person-workspace text-warning"></i> Chief of Staff</a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="nav">
      <ul class="navbar-nav me-auto gap-lg-1">
        <?php foreach ($nav as $href => [$icon, $label]): ?>
          <li class="nav-item"><a class="nav-link <?= $active === $href ? 'active' : '' ?>" href="<?= $href ?>"><i class="bi <?= $icon ?> me-1"></i><?= $label ?>
            <?php if ($href === 'index.php' && $openQ): ?><span class="badge rounded-pill text-bg-warning ms-1"><?= $openQ ?></span><?php endif; ?></a></li>
        <?php endforeach; ?>
      </ul>
      <div class="d-flex align-items-center gap-2">
        <?php $prob = ai_problem(); $local = settings()['provider'] !== 'claude'; ?>
        <?= !$prob ? '<a href="settings.php" class="badge rounded-pill text-decoration-none ' . ($local ? 'text-bg-info' : 'text-bg-success') . '"><i class="bi ' . ($local ? 'bi-pc-display' : 'bi-stars') . ' me-1"></i>' . h(engine_label()) . '</a>'
            : '<a href="settings.php" class="badge rounded-pill text-bg-warning text-decoration-none" title="' . h($prob) . '"><i class="bi bi-exclamation-triangle me-1"></i>' . h(engine_label()) . ' ยังไม่พร้อม</a>' ?>
        <button class="btn btn-sm btn-outline-light border-0" id="themeBtn" title="โหมดมืด/สว่าง"><i class="bi bi-circle-half"></i></button>
      </div>
    </div>
  </div>
</nav>
<main class="container-xl py-4">
<?php if ($dbErr && $active !== 'settings.php'): ?>
  <div class="alert alert-danger"><i class="bi bi-database-x me-1"></i><b>ต่อฐานข้อมูลไม่ได้</b> — เปิด MySQL ใน XAMPP แล้วไปที่ <a href="settings.php">ตั้งค่า</a> เพื่อสร้างฐานข้อมูล<div class="small mt-1 font-monospace"><?= h($dbErr) ?></div></div>
<?php endif;
}

function layout_foot(string $js = ''): void
{ ?>
</main>
<script src="assets/bootstrap.bundle.min.js"></script>
<script>
document.getElementById('themeBtn').onclick=()=>{const r=document.documentElement,n=r.getAttribute('data-bs-theme')==='dark'?'light':'dark';r.setAttribute('data-bs-theme',n);try{localStorage.setItem('theme',n)}catch(e){}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(action, body={}){const r=await fetch('api.php?action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
</script>
<?= $js ?>
</body></html>
<?php }

function pri_badge(string $p): string {
    return ['high' => '<span class="badge text-bg-danger">ด่วน</span>', 'medium' => '<span class="badge text-bg-warning">กลาง</span>', 'low' => '<span class="badge text-bg-secondary">ต่ำ</span>'][$p] ?? '';
}
