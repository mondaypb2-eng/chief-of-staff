<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
layout_head('Eval', 'eval.php');
$f = APP_ROOT . '/storage/eval-latest.json';
$last = is_file($f) ? json_decode(file_get_contents($f), true) : null;
?>
<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
  <div><h1 class="h4 fw-bold mb-1"><i class="bi bi-clipboard-check me-2"></i>จุดวัดผล (Eval)</h1>
    <div class="d-flex flex-wrap gap-2 small">
      <span class="badge text-bg-light border"><i class="bi bi-arrow-repeat me-1"></i>เปลี่ยนใจกลางคัน → ไม่บันทึกซ้ำ</span>
      <span class="badge text-bg-light border"><i class="bi bi-calendar-check me-1"></i>ตารางสมจริงตามเวลาว่าง</span>
      <span class="badge text-bg-light border"><i class="bi bi-link-45deg me-1"></i>ดึงบริบทตรงจุด ไม่ยัดเกิน</span>
    </div></div>
  <div class="d-flex gap-2">
    <button class="btn btn-outline-secondary" id="smokeBtn"><i class="bi bi-plug me-1"></i>ทดสอบ MCP servers (ไม่ใช้ AI)</button>
    <button class="btn btn-primary" id="evalBtn" <?= ai_ready() ? '' : 'disabled title="' . h(ai_problem()) . '"' ?>><i class="bi bi-play-fill me-1"></i>รัน Eval (<?= h(engine_label()) ?>)</button>
  </div>
</div>
<div class="alert alert-info small"><i class="bi bi-info-circle me-1"></i>Eval ใช้ฐานข้อมูลแยก <code>chief_of_staff_eval</code> ล้างใหม่ทุกเคส และตรึงเวลาไว้ที่ พ. 25 พ.ย. 2026 08:00 — ข้อมูลจริงของคุณไม่ถูกแตะ · ทั้งชุดเรียก Agent ~9 ครั้ง ใช้เวลาหลายนาที</div>
<pre class="prompt d-none mb-4" id="out"></pre>

<?php if ($last): $s = $last['summary']; $all = $s['passed'] === $s['cases']; ?>
  <div class="card mb-4 border-start border-5 border-<?= $all ? 'success' : 'danger' ?>"><div class="card-body d-flex align-items-center gap-4">
    <div class="display-6 fw-bold text-<?= $all ? 'success' : 'danger' ?>"><?= $s['passed'] ?>/<?= $s['cases'] ?></div>
    <div class="small text-body-secondary">เคสผ่าน · <?= h($s['model']) ?> · <?= h(date('j M Y H:i', strtotime($s['at']))) ?></div></div></div>
  <div class="accordion">
  <?php $i = 0; foreach ($last['results'] as $k => $c): $i++; ?>
    <div class="accordion-item">
      <h2 class="accordion-header"><button class="accordion-button <?= $c['pass'] ? 'collapsed' : '' ?> gap-3" data-bs-toggle="collapse" data-bs-target="#e<?= $i ?>">
        <span class="badge <?= $c['pass'] ? 'text-bg-success' : 'text-bg-danger' ?>"><?= $c['pass'] ? 'PASS' : 'FAIL' ?></span>
        <span class="badge text-bg-light border"><?= $c['group'] === 'brief' ? 'วางแผน' : 'รับเรื่อง' ?></span>
        <span class="flex-grow-1 fw-semibold"><?= h($c['title']) ?></span><code class="small me-2"><?= h($k) ?></code></button></h2>
      <div id="e<?= $i ?>" class="accordion-collapse collapse <?= $c['pass'] ? '' : 'show' ?>"><div class="accordion-body">
        <?php if ($c['error']): ?><div class="alert alert-danger small"><?= h($c['error']) ?></div><?php endif; ?>
        <table class="table table-sm mb-3"><tbody>
          <?php foreach ($c['checks'] as $ch): ?><tr class="<?= $ch['ok'] ? '' : 'table-danger' ?>"><td style="width:28px"><i class="bi bi-<?= $ch['ok'] ? 'check-circle-fill text-success' : 'x-circle-fill text-danger' ?>"></i></td><td><?= h($ch['name']) ?></td><td class="text-end small text-body-secondary"><?= h($ch['detail']) ?></td></tr><?php endforeach; ?>
        </tbody></table>
        <?php foreach ($c['runs'] as $r): ?>
          <div class="border rounded p-2 mb-2 small"><div><i class="bi bi-chat-left-text me-1"></i><b><?= h($r['input']) ?></b></div>
            <div class="reply text-body-secondary mt-1"><?= h($r['reply']) ?></div>
            <details><summary class="text-body-secondary"><?= count($r['tool_calls']) ?> tool calls</summary><?php foreach ($r['tool_calls'] as $tc): ?><div class="tool-call <?= $tc['is_error'] ? 'err' : '' ?>"><b><?= h($tc['name']) ?></b> <code><?= h(json_encode($tc['input'], JSON_UNESCAPED_UNICODE)) ?></code></div><?php endforeach; ?></details></div>
        <?php endforeach; ?>
      </div></div>
    </div>
  <?php endforeach; ?></div>
<?php else: ?>
  <div class="card"><div class="card-body text-center py-5 text-body-secondary"><i class="bi bi-clipboard fs-1 d-block mb-2"></i>ยังไม่เคยรัน Eval<?= ai_ready() ? '' : ' — ใส่ API key ก่อน' ?></div></div>
<?php endif; ?>
<?php layout_foot('<script>
async function go(btn, action){ const o=document.getElementById("out"); btn.disabled=true; const old=btn.innerHTML; btn.innerHTML=\'<span class="spinner-border spinner-border-sm me-1"></span>กำลังรัน…\';
  o.classList.remove("d-none"); o.textContent="กำลังรัน…";
  const r=await api(action,{}); o.textContent=r.output||r.error||JSON.stringify(r); btn.disabled=false; btn.innerHTML=old; if(action==="eval") location.reload(); }
document.getElementById("smokeBtn").onclick=e=>go(e.currentTarget,"smoke");
document.getElementById("evalBtn").onclick=e=>go(e.currentTarget,"eval");
</script>');
