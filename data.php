<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
$tabs = ['tasks' => ['bi-check2-square', 'งาน'], 'events' => ['bi-calendar-event', 'ปฏิทิน'], 'notes' => ['bi-journal-text', 'โน้ต'],
    'people' => ['bi-people', 'คน (CRM)'], 'shopping' => ['bi-cart', 'รายการซื้อ'], 'inventory' => ['bi-box-seam', 'ของในบ้าน']];
$tab = isset($tabs[$_GET['tab'] ?? '']) ? $_GET['tab'] : 'tasks';
layout_head('ข้อมูล', 'data.php');
$ok = !db_ok();
$mcp = ['tasks' => 'task-calendar-mcp', 'events' => 'task-calendar-mcp', 'notes' => 'knowledge-notes-mcp', 'people' => 'personal-crm-mcp', 'shopping' => 'shopping-inventory-mcp', 'inventory' => 'shopping-inventory-mcp'];
?>
<div class="d-flex justify-content-between align-items-end mb-3">
  <h1 class="h4 fw-bold mb-0"><i class="bi bi-database me-2"></i>ข้อมูลในระบบ</h1>
  <span class="small text-body-secondary">แหล่งข้อมูลของ <code><?= $mcp[$tab] ?></code></span>
</div>
<ul class="nav nav-tabs mb-3">
  <?php foreach ($tabs as $k => [$i, $l]): ?><li class="nav-item"><a class="nav-link <?= $tab === $k ? 'active' : '' ?>" href="?tab=<?= $k ?>"><i class="bi <?= $i ?> me-1"></i><?= $l ?></a></li><?php endforeach; ?>
</ul>
<div class="card"><div class="table-responsive">
<?php if ($ok && $tab === 'tasks'): $r = rows("SELECT t.*, p.name person, DATEDIFF(NOW(), t.last_touched_at) stale FROM tasks t LEFT JOIN people p ON p.id=t.person_id ORDER BY FIELD(t.status,'doing','todo','done','cancelled'), FIELD(t.priority,'high','medium','low'), t.due_date IS NULL, t.due_date"); ?>
  <table class="table table-hover align-middle mb-0"><thead><tr><th>งาน</th><th>ความสำคัญ</th><th>กำหนด</th><th>ใช้เวลา</th><th>หมวด</th><th>เกี่ยวกับ</th><th>แตะล่าสุด</th><th></th></tr></thead><tbody>
  <?php foreach ($r as $t): $done = in_array($t['status'], ['done', 'cancelled']); ?>
    <tr class="<?= $done ? 'text-body-secondary text-decoration-line-through' : '' ?>" id="t<?= $t['id'] ?>">
      <td><div class="fw-semibold"><?= h($t['title']) ?></div><?php if ($t['source_text']): ?><div class="small text-body-secondary text-truncate" style="max-width:340px">“<?= h($t['source_text']) ?>”</div><?php endif; ?></td>
      <td><?= pri_badge($t['priority']) ?></td><td class="text-nowrap"><?= $t['due_date'] ? h(thai_date($t['due_date'])) : '—' ?></td><td><?= (int)$t['duration_min'] ?> น.</td>
      <td><span class="badge text-bg-light border fw-normal"><?= h($t['category']) ?></span></td><td><?= h($t['person']) ?></td>
      <td class="small <?= !$done && $t['stale'] >= settings()['profile']['stale_days'] ? 'text-warning-emphasis fw-semibold' : '' ?>"><?= (int)$t['stale'] ?> วันก่อน</td>
      <td class="text-end text-nowrap"><?php if (!$done): ?><button class="btn btn-sm btn-outline-success" onclick="act('task_status',{id:<?= $t['id'] ?>,status:'done'},'t<?= $t['id'] ?>')"><i class="bi bi-check2"></i></button><?php endif; ?></td></tr>
  <?php endforeach; ?></tbody></table>

<?php elseif ($ok && $tab === 'events'): $r = rows("SELECT e.*, p.name person FROM events e LEFT JOIN people p ON p.id=e.person_id ORDER BY e.start_at"); ?>
  <table class="table table-hover align-middle mb-0"><thead><tr><th>วันเวลา</th><th>นัด</th><th>สถานที่</th><th>เดินทาง</th><th>กับใคร</th><th>สถานะ</th><th></th></tr></thead><tbody>
  <?php foreach ($r as $e): ?>
    <tr id="e<?= $e['id'] ?>" class="<?= $e['status'] === 'cancelled' ? 'text-body-secondary text-decoration-line-through' : '' ?>">
      <td class="text-nowrap"><?= h(thai_date($e['start_at'])) ?> <b><?= date('H:i', strtotime($e['start_at'])) ?>–<?= date('H:i', strtotime($e['end_at'])) ?></b></td>
      <td><div class="fw-semibold"><?= h($e['title']) ?></div><?php if ($e['source_text']): ?><div class="small text-body-secondary">“<?= h($e['source_text']) ?>”</div><?php endif; ?></td>
      <td><?= h($e['location']) ?></td><td><?= $e['is_offsite'] ? '<i class="bi bi-car-front"></i> ' . (int)($e['travel_min'] ?: settings()['profile']['default_travel_min']) . ' น.' : '—' ?></td>
      <td><?= h($e['person']) ?></td><td><span class="badge text-bg-<?= $e['status'] === 'confirmed' ? 'success' : ($e['status'] === 'tentative' ? 'warning' : 'secondary') ?>"><?= h($e['status']) ?></span></td>
      <td class="text-end"><?php if ($e['status'] !== 'cancelled'): ?><button class="btn btn-sm btn-outline-danger" title="ยกเลิก" onclick="act('event_cancel',{id:<?= $e['id'] ?>},'e<?= $e['id'] ?>')"><i class="bi bi-x"></i></button><?php endif; ?></td></tr>
  <?php endforeach; ?></tbody></table>

<?php elseif ($ok && $tab === 'notes'): $r = rows("SELECT n.*, p.name person FROM notes n LEFT JOIN people p ON p.id=n.person_id ORDER BY n.updated_at DESC"); ?>
  <div class="row g-3 p-3">
  <?php foreach ($r as $n): ?>
    <div class="col-md-6 col-xl-4"><div class="border rounded-3 p-3 h-100">
      <div class="fw-semibold"><?= h($n['title']) ?></div>
      <div class="small mt-1" style="white-space:pre-wrap"><?= h($n['body']) ?></div>
      <div class="mt-2 d-flex flex-wrap gap-1"><?php foreach (array_filter(explode(',', $n['tags'])) as $tg): ?><span class="badge text-bg-light border fw-normal">#<?= h($tg) ?></span><?php endforeach; ?>
        <?php if ($n['person']): ?><span class="badge text-bg-info bg-opacity-25 text-info-emphasis fw-normal"><i class="bi bi-person"></i> <?= h($n['person']) ?></span><?php endif; ?></div>
      <div class="small text-body-secondary mt-2"><?= h(thai_date($n['updated_at'], true)) ?></div>
    </div></div>
  <?php endforeach; ?></div>

<?php elseif ($ok && $tab === 'people'): $r = rows("SELECT p.*, (SELECT summary FROM interactions i WHERE i.person_id=p.id ORDER BY happened_at DESC LIMIT 1) last_summary FROM people p ORDER BY p.name"); ?>
  <table class="table table-hover align-middle mb-0"><thead><tr><th>ชื่อ</th><th>ชื่อเล่น/เรียก</th><th>ความสัมพันธ์</th><th>บริษัท</th><th>ติดต่อ</th><th>คุยล่าสุด</th></tr></thead><tbody>
  <?php foreach ($r as $p): ?>
    <tr><td class="fw-semibold"><?= h($p['name']) ?><?= $p['birthday'] ? '<div class="small text-body-secondary"><i class="bi bi-cake2"></i> ' . h(date('j M', strtotime($p['birthday']))) . '</div>' : '' ?></td>
      <td><?php foreach (array_filter(explode(',', $p['aliases'])) as $a): ?><span class="badge text-bg-light border fw-normal me-1"><?= h($a) ?></span><?php endforeach; ?></td>
      <td><?= h($p['relationship']) ?></td><td><?= h($p['company']) ?></td><td class="small"><?= h($p['phone']) ?><br><?= h($p['email']) ?></td>
      <td class="small"><?= $p['last_contact_at'] ? '<b>' . h(thai_date($p['last_contact_at'])) . '</b><br>' : '' ?><span class="text-body-secondary"><?= h($p['last_summary']) ?></span></td></tr>
  <?php endforeach; ?></tbody></table>

<?php elseif ($ok && $tab === 'shopping'): $r = rows("SELECT * FROM shopping_items ORDER BY FIELD(status,'needed','bought','cancelled'), created_at DESC"); ?>
  <table class="table table-hover align-middle mb-0"><thead><tr><th>ของ</th><th>จำนวน</th><th>ร้าน</th><th>ใช้สำหรับ</th><th>สถานะ</th><th></th></tr></thead><tbody>
  <?php foreach ($r as $s): ?>
    <tr id="s<?= $s['id'] ?>" class="<?= $s['status'] !== 'needed' ? 'text-body-secondary text-decoration-line-through' : '' ?>">
      <td class="fw-semibold"><?= h($s['name']) ?></td><td><?= $s['qty'] !== null ? h(rtrim(rtrim($s['qty'], '0'), '.')) . ' ' . h($s['unit']) : '—' ?></td>
      <td><?= h($s['store']) ?></td><td><?= h($s['needed_for']) ?></td><td><?= h($s['status']) ?></td>
      <td class="text-end"><?php if ($s['status'] === 'needed'): ?><button class="btn btn-sm btn-outline-success" onclick="act('shopping_status',{id:<?= $s['id'] ?>,status:'bought'},'s<?= $s['id'] ?>')"><i class="bi bi-bag-check"></i> ซื้อแล้ว</button><?php endif; ?></td></tr>
  <?php endforeach; ?></tbody></table>

<?php elseif ($ok && $tab === 'inventory'): $r = rows("SELECT *, (low_threshold IS NOT NULL AND qty <= low_threshold) low FROM inventory ORDER BY low DESC, name"); ?>
  <table class="table table-hover align-middle mb-0"><thead><tr><th>ของ</th><th>คงเหลือ</th><th>เก็บที่</th><th>เตือนเมื่อเหลือ ≤</th></tr></thead><tbody>
  <?php foreach ($r as $i): ?>
    <tr class="<?= $i['low'] ? 'table-warning' : '' ?>"><td class="fw-semibold"><?= h($i['name']) ?> <?= $i['low'] ? '<span class="badge text-bg-warning">ใกล้หมด</span>' : '' ?></td>
      <td><?= h(rtrim(rtrim($i['qty'], '0'), '.') ?: '0') ?> <?= h($i['unit']) ?></td><td><?= h($i['location']) ?></td><td><?= $i['low_threshold'] !== null ? h(rtrim(rtrim($i['low_threshold'], '0'), '.')) : '—' ?></td></tr>
  <?php endforeach; ?></tbody></table>
<?php endif; ?>
</div></div>
<?php layout_foot('<script>async function act(a,b,row){const r=await api(a,b);if(r.ok){const el=document.getElementById(row);el.classList.add("text-body-secondary","text-decoration-line-through");el.querySelectorAll("button").forEach(x=>x.remove());}}</script>');
