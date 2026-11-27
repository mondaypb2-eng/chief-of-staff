<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
layout_head('รับเรื่อง', 'index.php');
$ok = !db_ok();
$today = date('Y-m-d');
$events = $ok ? rows("SELECT * FROM events WHERE status<>'cancelled' AND start_at >= ? AND start_at < DATE_ADD(?, INTERVAL 2 DAY) ORDER BY start_at", [date('Y-m-d H:i:s'), $today]) : [];
$clar = $ok ? rows("SELECT * FROM clarifications WHERE status='open' ORDER BY id DESC") : [];
$stats = $ok ? row("SELECT (SELECT COUNT(*) FROM tasks WHERE status IN ('todo','doing')) open_tasks,
  (SELECT COUNT(*) FROM tasks WHERE status IN ('todo','doing') AND DATEDIFF(NOW(), last_touched_at) >= ?) stale,
  (SELECT COUNT(*) FROM shopping_items WHERE status='needed') shopping,
  (SELECT COUNT(*) FROM events WHERE status<>'cancelled' AND DATE(start_at)=?) today_events", [settings()['profile']['stale_days'], $today]) : null;
$examples = [
    'พรุ่งนี้นัดหมอฟันบ่าย 3 เอ้ยไม่ใช่ 4 โมงเย็น ที่คลินิกสุขุมวิท',
    'ซื้อนมด้วย 3 กล่อง ไข่หมดแล้ว ส่วนกาแฟยังมี แล้วก็จดไว้ว่าคุณสมชายเปลี่ยนเบอร์เป็น 089-555-0199',
    'โทรหาเอเรื่องนั้นด้วย แล้วก็จ่ายค่าไฟก่อนวันศุกร์',
    'ไอเดีย: แคมเปญปีใหม่ลองทำ live ขายของบน TikTok ช่วงสองทุ่ม ให้พี่เอดูก่อนวันศุกร์',
];
?>
<div class="row g-4">
  <div class="col-lg-8 vstack gap-4">
    <div class="card capture-box">
      <div class="card-body p-4">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div><h1 class="h4 fw-bold mb-1"><i class="bi bi-inbox text-primary me-2"></i>โหมดรับเรื่อง</h1>
            <div class="text-body-secondary small">พิมพ์หรือพูดทุกอย่างที่อยู่ในหัวปนกันได้เลย — นัด งาน ไอเดีย ของที่ต้องซื้อ ข้อมูลคน — ระบบแยกหมวด เช็กซ้ำ และเก็บให้</div></div>
        </div>
        <textarea id="txt" class="form-control mb-3" placeholder="เช่น พรุ่งนี้ประชุม ABC 10 โมง อย่าลืมเอาสัญญาไป แล้วก็ซื้อนมด้วย…"></textarea>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <button class="btn btn-outline-secondary mic" id="micBtn" type="button" title="พูด (ภาษาไทย)"><i class="bi bi-mic-fill"></i> พูด</button>
          <span class="small text-body-secondary" id="micHint"></span>
          <button class="btn btn-primary px-4 ms-auto" id="sendBtn" <?= ai_ready() ? '' : 'disabled' ?>><i class="bi bi-send-fill me-1"></i>ส่งให้ผู้ช่วย</button>
        </div>
        <?php if ($prob = ai_problem()): ?><div class="alert alert-warning small mt-3 mb-0"><i class="bi bi-exclamation-triangle me-1"></i><?= h($prob) ?> — <a href="settings.php">ตั้งค่า</a></div><?php endif; ?>
        <div class="mt-3">
          <div class="small text-body-secondary mb-1">ลองตัวอย่าง:</div>
          <div class="list-group list-group-flush small">
            <?php foreach ($examples as $ex): ?><div class="list-group-item example px-2 py-1" data-t="<?= h($ex) ?>"><i class="bi bi-lightning-charge text-warning me-1"></i><?= h($ex) ?></div><?php endforeach; ?>
          </div>
        </div>
      </div>
    </div>

    <div class="card d-none" id="resultCard">
      <div class="card-header d-flex justify-content-between align-items-center"><span><i class="bi bi-robot me-1"></i>ผลลัพธ์</span><span class="small text-body-secondary" id="dur"></span></div>
      <div class="card-body">
        <div id="working" class="d-flex align-items-center gap-3 text-body-secondary"><div class="spinner-border spinner-border-sm text-primary"></div><span>กำลังแยกเรื่อง ตรวจซ้ำ และบันทึก…</span></div>
        <div class="reply" id="reply"></div>
        <details class="mt-3" id="toolsWrap"><summary class="small text-body-secondary">ดูว่า Agent เรียกเครื่องมือ MCP อะไรบ้าง (<span id="toolCount">0</span>)</summary><div class="mt-2" id="tools"></div></details>
      </div>
    </div>
  </div>

  <div class="col-lg-4 vstack gap-4">
    <?php if ($stats): ?>
    <div class="row g-3">
      <?php foreach ([['bi-calendar-event', 'primary', 'นัดวันนี้', $stats['today_events'], 'data.php?tab=events'], ['bi-check2-square', 'success', 'งานค้าง', $stats['open_tasks'], 'data.php?tab=tasks'],
          ['bi-hourglass-split', 'warning', 'ค้างนาน', $stats['stale'], 'data.php?tab=tasks'], ['bi-cart', 'info', 'ต้องซื้อ', $stats['shopping'], 'data.php?tab=shopping']] as [$i, $c, $l, $n, $href]): ?>
        <div class="col-6"><a href="<?= $href ?>" class="card stat text-decoration-none text-body h-100"><div class="card-body d-flex gap-3 align-items-center py-3">
          <div class="icon bg-<?= $c ?> bg-opacity-10 text-<?= $c ?>"><i class="bi <?= $i ?>"></i></div><div><div class="n"><?= (int)$n ?></div><div class="small text-body-secondary"><?= $l ?></div></div></div></a></div>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <div class="card">
      <div class="card-header d-flex justify-content-between"><span><i class="bi bi-question-circle text-warning me-1"></i>รอคุณตอบ (needs_clarification)</span><span class="badge text-bg-warning"><?= count($clar) ?></span></div>
      <div class="list-group list-group-flush">
        <?php foreach ($clar as $c): ?>
          <div class="list-group-item" id="cl<?= $c['id'] ?>">
            <div class="small text-body-secondary">“<?= h($c['fragment']) ?>”</div>
            <div class="fw-semibold my-1"><?= h($c['question']) ?></div>
            <div class="input-group input-group-sm">
              <input class="form-control" placeholder="ตอบ…" id="ans<?= $c['id'] ?>">
              <button class="btn btn-primary" onclick="answer(<?= $c['id'] ?>)" <?= ai_ready() ? '' : 'disabled' ?>><i class="bi bi-reply"></i></button>
              <button class="btn btn-outline-secondary" onclick="dismiss(<?= $c['id'] ?>)" title="ไม่ต้องทำแล้ว"><i class="bi bi-x"></i></button>
            </div>
          </div>
        <?php endforeach; ?>
        <?php if (!$clar): ?><div class="list-group-item small text-body-secondary text-center py-3"><i class="bi bi-check2-circle me-1"></i>ไม่มีเรื่องค้างถาม</div><?php endif; ?>
      </div>
    </div>

    <div class="card">
      <div class="card-header d-flex justify-content-between"><span><i class="bi bi-calendar3 me-1 text-primary"></i>นัดถัดไป (วันนี้–พรุ่งนี้)</span><a href="brief.php" class="small fw-normal">วางแผน →</a></div>
      <div class="list-group list-group-flush">
        <?php foreach ($events as $e): ?>
          <div class="list-group-item d-flex gap-3">
            <div class="text-center" style="min-width:54px"><div class="fw-bold"><?= date('H:i', strtotime($e['start_at'])) ?></div><div class="small text-body-secondary"><?= date('Y-m-d', strtotime($e['start_at'])) === $today ? 'วันนี้' : 'พรุ่งนี้' ?></div></div>
            <div class="small"><div class="fw-semibold"><?= h($e['title']) ?></div><div class="text-body-secondary"><?= $e['is_offsite'] ? '<i class="bi bi-geo-alt"></i> ' : '' ?><?= h($e['location']) ?></div></div>
          </div>
        <?php endforeach; ?>
        <?php if (!$events): ?><div class="list-group-item small text-body-secondary text-center py-3">ไม่มีนัด</div><?php endif; ?>
      </div>
    </div>
  </div>
</div>
<?php
$js = <<<'JS'
<script>
const txt=document.getElementById('txt'), sendBtn=document.getElementById('sendBtn');
document.querySelectorAll('.example').forEach(e=>e.onclick=()=>{txt.value=e.dataset.t;txt.focus()});
function showResult(r){
  document.getElementById('working').classList.add('d-none');
  const rep=document.getElementById('reply');
  rep.innerHTML = r.ok ? esc(r.reply) : '<div class="alert alert-danger mb-0"><i class="bi bi-x-octagon me-1"></i>'+esc(r.error)+'</div>';
  const calls=r.tool_calls||[];
  document.getElementById('toolCount').textContent=calls.length;
  document.getElementById('tools').innerHTML=calls.map(c=>`<div class="tool-call ${c.is_error?'err':''}"><span class="badge text-bg-light border srv">${esc(c.server)}</span> <b>${esc(c.name)}</b> <code>${esc(JSON.stringify(c.input))}</code><div class="text-body-secondary text-truncate">→ ${esc(c.result)}</div></div>`).join('');
  if(r.duration_ms) document.getElementById('dur').textContent=(r.duration_ms/1000).toFixed(1)+' วินาที';
}
async function run(action, body){
  document.getElementById('resultCard').classList.remove('d-none');
  document.getElementById('working').classList.remove('d-none');
  document.getElementById('reply').innerHTML=''; document.getElementById('tools').innerHTML=''; document.getElementById('dur').textContent='';
  document.getElementById('resultCard').scrollIntoView({behavior:'smooth',block:'nearest'});
  sendBtn.disabled=true;
  try{ const r=await api(action, body); showResult(r); if(r.ok) document.getElementById('dur').innerHTML+=' · <a href="index.php">รีเฟรชแผงด้านข้าง</a>'; return r; }
  catch(e){ showResult({ok:false,error:e.message}); }
  finally{ sendBtn.disabled=false; }
}
sendBtn.onclick=async()=>{ const r=await run('capture',{text:txt.value}); if(r&&r.ok){ txt.value=''; } };
txt.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)) sendBtn.click(); });
async function answer(id){ const a=document.getElementById('ans'+id).value; const r=await run('answer',{id,answer:a}); if(r&&r.ok) document.getElementById('cl'+id).remove(); }
async function dismiss(id){ await api('dismiss',{id}); document.getElementById('cl'+id).remove(); }

// voice input (Web Speech API — Edge/Chrome)
const SR=window.SpeechRecognition||window.webkitSpeechRecognition, mic=document.getElementById('micBtn'), hint=document.getElementById('micHint');
if(!SR){ mic.disabled=true; hint.textContent='เบราว์เซอร์นี้ไม่รองรับการพูด'; }
else{
  let rec=null;
  mic.onclick=()=>{
    if(rec){ rec.stop(); return; }
    rec=new SR(); rec.lang='th-TH'; rec.interimResults=true; rec.continuous=true;
    const base=txt.value?txt.value+' ':'';
    rec.onresult=e=>{ let t=''; for(const r of e.results) t+=r[0].transcript; txt.value=base+t; };
    rec.onend=()=>{ rec=null; mic.classList.remove('recording'); hint.textContent=''; };
    rec.onerror=e=>{ hint.textContent='ไมค์ใช้ไม่ได้: '+e.error; };
    rec.start(); mic.classList.add('recording'); hint.textContent='กำลังฟัง… กดอีกครั้งเพื่อหยุด';
  };
}
</script>
JS;
layout_foot($js);
