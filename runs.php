<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
layout_head('การทำงานของ Agent', 'runs.php');
$runs = db_ok() ? [] : rows("SELECT * FROM agent_runs ORDER BY id DESC LIMIT 40");
?>
<h1 class="h4 fw-bold mb-1"><i class="bi bi-cpu me-2"></i>การทำงานของ Agent</h1>
<p class="text-body-secondary small mb-4">ทุกครั้งที่ Agent ทำงาน: ข้อความที่รับ → เครื่องมือ MCP ที่เรียก (ตามลำดับ) → คำตอบ — ใช้ตรวจสอบว่ามันคิดและทำอะไร</p>
<div class="accordion" id="acc">
<?php foreach ($runs as $i => $r): $calls = json_decode($r['tool_calls'] ?? '[]', true) ?: []; $u = json_decode($r['usage_json'] ?? 'null', true); ?>
  <div class="accordion-item">
    <h2 class="accordion-header"><button class="accordion-button collapsed gap-3" data-bs-toggle="collapse" data-bs-target="#r<?= $i ?>">
      <span class="badge <?= $r['mode'] === 'brief' ? 'text-bg-warning' : 'text-bg-primary' ?>"><?= $r['mode'] === 'brief' ? 'วางแผน' : 'รับเรื่อง' ?></span>
      <?= $r['ok'] ? '' : '<span class="badge text-bg-danger">ผิดพลาด</span>' ?>
      <span class="flex-grow-1 text-truncate"><?= h(mb_strimwidth($r['input_text'] ?? '', 0, 90, '…')) ?></span>
      <span class="small text-body-secondary text-nowrap me-2"><?= count($calls) ?> tools · <?= round(($r['duration_ms'] ?? 0) / 1000, 1) ?>s · <?= h(thai_date($r['created_at'], true)) ?></span>
    </button></h2>
    <div id="r<?= $i ?>" class="accordion-collapse collapse"><div class="accordion-body">
      <div class="row g-4">
        <div class="col-md-5"><div class="small fw-semibold mb-1">ข้อความ</div><div class="reply small border rounded p-2 mb-3"><?= h($r['input_text']) ?></div>
          <div class="small fw-semibold mb-1"><?= $r['ok'] ? 'คำตอบ' : 'ข้อผิดพลาด' ?></div><div class="reply small border rounded p-2 <?= $r['ok'] ? '' : 'text-danger' ?>"><?= h($r['ok'] ? $r['reply'] : $r['error']) ?></div>
          <?php if ($u): ?><div class="small text-body-secondary mt-2">tokens (รอบสุดท้าย): in <?= (int)($u['input_tokens'] ?? 0) ?> · cache read <?= (int)($u['cache_read_input_tokens'] ?? 0) ?> · out <?= (int)($u['output_tokens'] ?? 0) ?></div><?php endif; ?></div>
        <div class="col-md-7"><div class="small fw-semibold mb-1">ลำดับการเรียกเครื่องมือ</div>
          <?php foreach ($calls as $n => $c): ?>
            <div class="tool-call <?= $c['is_error'] ? 'err' : '' ?>"><span class="text-body-secondary"><?= $n + 1 ?>.</span> <span class="badge text-bg-light border srv"><?= h($c['server']) ?></span> <b><?= h($c['name']) ?></b>
              <div><code><?= h(json_encode($c['input'], JSON_UNESCAPED_UNICODE)) ?></code></div><div class="text-body-secondary" style="word-break:break-all">→ <?= h(mb_strimwidth($c['result'], 0, 400, '…')) ?></div></div>
          <?php endforeach; ?>
          <?php if (!$calls): ?><div class="small text-body-secondary">—</div><?php endif; ?></div>
      </div>
    </div></div>
  </div>
<?php endforeach; ?>
<?php if (!$runs): ?><div class="card"><div class="card-body text-center text-body-secondary py-5">ยังไม่มีการทำงาน</div></div><?php endif; ?>
</div>
<?php layout_foot();
