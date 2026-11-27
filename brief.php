<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
$date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'] ?? '') ? $_GET['date'] : date('Y-m-d');
layout_head('แผนวันนี้', 'brief.php');
$ok = !db_ok();
$plan = $ok ? row("SELECT * FROM daily_plans WHERE plan_date=? ORDER BY id DESC LIMIT 1", [$date]) : null;
$lastRun = $ok ? row("SELECT reply, created_at FROM agent_runs WHERE mode='brief' AND ok=1 AND input_text=? ORDER BY id DESC LIMIT 1", ["brief $date"]) : null;

// lookups for context links
$lookup = function (string $table, array $ids, string $cols) {
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (!$ids) return [];
    $out = [];
    foreach (rows("SELECT id,$cols FROM $table WHERE id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")", $ids) as $r) $out[$r['id']] = $r;
    return $out;
};
$blocks = $links = $nudges = $unsched = [];
if ($plan) {
    $blocks = json_decode($plan['blocks'], true) ?: [];
    $links = json_decode($plan['context_links'], true) ?: [];
    $nz = json_decode($plan['nudges'], true) ?: [];
    $nudges = $nz['nudges'] ?? []; $unsched = $nz['unscheduled'] ?? [];
    $notes = $lookup('notes', array_merge([], ...array_column($links, 'note_ids')), 'title,LEFT(body,160) body');
    $people = $lookup('people', array_merge([], ...array_column($links, 'person_ids')), 'name,phone,relationship');
    $shop = $lookup('shopping_items', array_merge([], ...array_column($links, 'shopping_ids')), 'name,qty,unit');
    $tasks = $lookup('tasks', array_merge(array_column($unsched, 'task_id'), ...array_column($links, 'task_ids')), 'title,priority');
    $linkBy = [];
    foreach ($links as $l) $linkBy[$l['for_type'] . ':' . $l['for_id']][] = $l;
}
$kindIcon = ['event' => 'bi-calendar-event text-primary', 'task' => 'bi-check2-square text-success', 'travel' => 'bi-car-front', 'break' => 'bi-cup-hot', 'buffer' => 'bi-hourglass'];
$taskMin = 0; foreach ($blocks as $b) if ($b['kind'] === 'task') $taskMin += (strtotime($b['end']) - strtotime($b['start'])) / 60;
?>
<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
  <div><h1 class="h4 fw-bold mb-1"><i class="bi bi-sunrise text-warning me-2"></i>โหมดวางแผน &amp; เตือน</h1>
    <div class="text-body-secondary small">จัดงานลงเวลาว่างจริง (หักเวลาเดินทาง พักเที่ยง และเผื่อเวลา) ดึงบริบทที่เกี่ยวข้อง และสะกิดงานที่ค้างนาน</div></div>
  <div class="d-flex gap-2">
    <form class="d-flex gap-2"><input type="date" name="date" value="<?= h($date) ?>" class="form-control" onchange="this.form.submit()"></form>
    <button class="btn btn-primary text-nowrap" id="genBtn" <?= ai_ready() ? '' : 'disabled' ?>><i class="bi bi-magic me-1"></i><?= $plan ? 'วางแผนใหม่' : 'สร้างแผน' ?></button>
  </div>
</div>
<div class="card mb-4 d-none" id="working"><div class="card-body d-flex gap-3 align-items-center"><div class="spinner-border text-primary"></div>
  <div><div class="fw-semibold">กำลังวางแผน <?= h(thai_date($date)) ?>…</div><div class="small text-body-secondary" id="wmsg">ดูตาราง → หาเวลาว่าง → ดึงบริบท → จัดลงเวลา → ตรวจไม่ให้ชนกัน (<?= settings()['provider'] === 'claude' ? 'ประมาณ 1–2 นาที' : 'LLM ในเครื่อง ประมาณ 30–60 วินาที' ?>)</div></div></div></div>

<?php if (!$plan): ?>
  <div class="card"><div class="card-body text-center py-5">
    <i class="bi bi-calendar2-week fs-1 text-body-secondary"></i>
    <div class="fw-semibold mt-2">ยังไม่มีแผนของ <?= h(thai_date($date)) ?></div>
    <div class="text-body-secondary small">กด "สร้างแผน" ให้ผู้ช่วยจัดตารางวันนี้ให้</div>
    <?php if ($prob = ai_problem()): ?><div class="alert alert-warning small mt-3 d-inline-block"><?= h($prob) ?> — <a href="settings.php">ตั้งค่า</a></div><?php endif; ?>
  </div></div>
<?php else: ?>
<div class="row g-4">
  <div class="col-lg-7">
    <div class="card">
      <div class="card-header d-flex justify-content-between"><span><i class="bi bi-clock me-1"></i>ตารางเวลา <?= h(thai_date($date)) ?></span>
        <span class="small fw-normal text-body-secondary">งานที่จัดลง <?= (int)$taskMin ?> นาที · สร้างเมื่อ <?= h(date('H:i', strtotime($plan['created_at']))) ?></span></div>
      <div class="card-body">
        <ul class="tl">
          <?php foreach ($blocks as $b): $key = ($b['ref_type'] ?? '') . ':' . ($b['ref_id'] ?? ''); ?>
            <li class="k-<?= h($b['kind']) ?>">
              <div class="time"><?= h($b['start']) ?>–<?= h($b['end']) ?></div>
              <div class="blk">
                <div><i class="bi <?= $kindIcon[$b['kind']] ?? 'bi-dot' ?> me-1"></i><span class="<?= in_array($b['kind'], ['event', 'task']) ? 'fw-semibold' : '' ?>"><?= h($b['title']) ?></span></div>
                <?php if (!empty($b['note'])): ?><div class="small text-body-secondary"><?= h($b['note']) ?></div><?php endif; ?>
                <?php if (in_array($b['kind'], ['event', 'task']) && isset($linkBy[$key])): foreach ($linkBy[$key] as $l): ?>
                  <div class="ctx">
                    <div><i class="bi bi-paperclip me-1"></i><?= h($l['why']) ?></div>
                    <div class="d-flex flex-wrap gap-1 mt-1">
                      <?php foreach ($l['person_ids'] as $id) if (isset($people[$id])): ?><span class="badge text-bg-light border fw-normal"><i class="bi bi-person"></i> <?= h($people[$id]['name']) ?></span><?php endif; ?>
                      <?php foreach ($l['note_ids'] as $id) if (isset($notes[$id])): ?><span class="badge text-bg-light border fw-normal" title="<?= h($notes[$id]['body']) ?>"><i class="bi bi-journal-text"></i> <?= h($notes[$id]['title']) ?></span><?php endif; ?>
                      <?php foreach ($l['shopping_ids'] as $id) if (isset($shop[$id])): ?><span class="badge text-bg-light border fw-normal"><i class="bi bi-cart"></i> <?= h($shop[$id]['name']) ?></span><?php endif; ?>
                      <?php foreach ($l['task_ids'] as $id) if (isset($tasks[$id])): ?><span class="badge text-bg-light border fw-normal"><i class="bi bi-check2-square"></i> <?= h($tasks[$id]['title']) ?></span><?php endif; ?>
                    </div>
                  </div>
                <?php endforeach; endif; ?>
              </div>
            </li>
          <?php endforeach; ?>
        </ul>
      </div>
    </div>
  </div>
  <div class="col-lg-5 vstack gap-4">
    <div class="card"><div class="card-header"><i class="bi bi-chat-quote me-1 text-primary"></i>สรุปเช้านี้</div>
      <div class="card-body"><div class="reply"><?= h($lastRun['reply'] ?? $plan['summary']) ?></div></div></div>
    <?php if ($nudges): ?>
    <div class="card border-start border-4 border-warning"><div class="card-header"><i class="bi bi-bell me-1 text-warning"></i>สะกิดงานค้าง</div>
      <div class="list-group list-group-flush">
        <?php foreach ($nudges as $n): ?>
          <div class="list-group-item" id="nt<?= (int)$n['task_id'] ?>">
            <div class="d-flex justify-content-between"><span class="fw-semibold"><?= h($n['title']) ?></span><span class="badge text-bg-warning"><?= (int)$n['days_stale'] ?> วัน</span></div>
            <div class="small my-1"><?= h($n['message']) ?></div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-success" onclick="taskStatus(<?= (int)$n['task_id'] ?>,'done')"><i class="bi bi-check2"></i> ทำแล้ว</button>
              <button class="btn btn-outline-secondary" onclick="taskStatus(<?= (int)$n['task_id'] ?>,'cancelled')"><i class="bi bi-x"></i> ไม่ทำแล้ว</button>
            </div>
          </div>
        <?php endforeach; ?>
      </div></div>
    <?php endif; ?>
    <?php if ($unsched): ?>
    <div class="card"><div class="card-header"><i class="bi bi-inboxes me-1"></i>ยังไม่ได้ลงตาราง</div>
      <ul class="list-group list-group-flush small">
        <?php foreach ($unsched as $u): ?><li class="list-group-item"><b><?= h($tasks[$u['task_id']]['title'] ?? '#' . $u['task_id']) ?></b><div class="text-body-secondary"><?= h($u['reason']) ?></div></li><?php endforeach; ?>
      </ul></div>
    <?php endif; ?>
  </div>
</div>
<?php endif; ?>
<?php
$js = '<script>
document.getElementById("genBtn").onclick=async()=>{
  const b=document.getElementById("genBtn"); b.disabled=true; document.getElementById("working").classList.remove("d-none");
  const r=await api("brief",{date:' . json_encode($date) . '});
  if(r.ok) location.reload();
  else { document.getElementById("wmsg").innerHTML="<span class=\"text-danger\">"+esc(r.error)+"</span>"; b.disabled=false; document.querySelector("#working .spinner-border").remove(); }
};
async function taskStatus(id,s){ await api("task_status",{id,status:s}); document.getElementById("nt"+id).style.opacity=.4; }
</script>';
layout_foot($js);
