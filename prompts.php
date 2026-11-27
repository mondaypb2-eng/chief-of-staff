<?php
require __DIR__ . '/config.php';
require APP_ROOT . '/lib/layout.php';
layout_head('Prompts', 'prompts.php');
$p = [
    '0_role' => ['bi-person-badge', 'บทบาทพื้นฐาน (ใช้ทุกโหมด)', 'บอกว่าเป็นใคร มีเครื่องมือ MCP อะไร และกติกาเรื่องวันที่/การเช็กซ้ำ'],
    '1_split_dedupe' => ['bi-scissors', '1. Split & Deduplicate Prompt', 'โหมดรับเรื่อง: แตกคำพูดปนกัน → ตรวจซ้ำ/อัปเดตของเดิม → แยกจุดไม่ชัดเข้า needs_clarification'],
    '2_context_linker' => ['bi-link-45deg', '2. Context Linker Prompt', 'ดึงโน้ต ประวัติคน งาน และรายการซื้อที่เกี่ยวกับนัด/งาน — เฉพาะที่มีประโยชน์จริง'],
    '3_timebox_nudge' => ['bi-hourglass-split', '3. Time-Box & Nudge Prompt', 'โหมดวางแผน: จัดงานลงเวลาว่างจริง เผื่อเดินทาง/พัก แล้วสะกิดงานค้างนาน'],
];
?>
<h1 class="h4 fw-bold mb-1"><i class="bi bi-chat-square-text me-2"></i>Agent Loop &amp; Prompt Design</h1>
<p class="text-body-secondary small mb-3">โหมดรับเรื่อง = บทบาท + Prompt 1 · โหมดวางแผน = บทบาท + Prompt 2 + Prompt 3 · แก้ได้ที่ <code>prompts/*.md</code></p>
<div class="card mb-4"><div class="card-body small">
  <div class="fw-semibold mb-2">MCP Servers (stdio) ที่ Agent ต่ออยู่</div>
  <div class="row g-2">
    <?php foreach (['task-calendar-mcp' => 'งาน · ปฏิทิน · หาเวลาว่าง · บันทึกแผน (ตรวจไม่ให้ชน) · กล่องคำถาม', 'knowledge-notes-mcp' => 'ค้นหา/บันทึก/ต่อท้ายโน้ต', 'personal-crm-mcp' => 'หาคน (รวมชื่อเล่น) · ประวัติการคุย · วันเกิด', 'shopping-inventory-mcp' => 'รายการซื้อ (รวมรายการซ้ำอัตโนมัติ) · ของในบ้าน · ของใกล้หมด'] as $n => $d): ?>
      <div class="col-md-6 col-xl-3"><div class="border rounded p-2 h-100"><code><?= $n ?></code><div class="text-body-secondary mt-1"><?= $d ?></div></div></div>
    <?php endforeach; ?>
  </div></div></div>
<div class="accordion" id="pa">
<?php $i = 0; foreach ($p as $f => [$ic, $t, $d]): $i++; ?>
  <div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button <?= $i > 1 ? 'collapsed' : '' ?> gap-3" data-bs-toggle="collapse" data-bs-target="#p<?= $i ?>">
    <i class="bi <?= $ic ?> fs-5 text-primary"></i><span><span class="fw-semibold"><?= h($t) ?></span><br><span class="small text-body-secondary"><?= h($d) ?></span></span></button></h2>
    <div id="p<?= $i ?>" class="accordion-collapse collapse <?= $i === 1 ? 'show' : '' ?>" data-bs-parent="#pa"><div class="accordion-body"><pre class="prompt"><?= h(prompt_text($f)) ?></pre></div></div></div>
<?php endforeach; ?>
</div>

<h2 class="h5 fw-bold mt-5 mb-1"><i class="bi bi-pc-display me-2"></i>เวอร์ชันสำหรับ LLM ในเครื่อง (prompts/local/)</h2>
<p class="text-body-secondary small mb-3">โมเดลเล็กทำงานแบบ “workflow” — prompt สั้น มีตัวอย่าง ตอบเป็น JSON ตาม schema · ส่วนที่โค้ดทำแทน: ค้นของเดิม/เช็กซ้ำผ่าน MCP, แปลงเวลาไทย (“บ่าย 3 เอ้ย 4 โมงเย็น” → 16:00), ตรวจชื่อคนกำกวม, ค้นบริบทด้วย embedding (bge-m3), จัดงานลงเวลาว่าง</p>
<div class="accordion" id="pl">
<?php $j = 0; foreach (['1_split_extract' => ['bi-scissors', 'Split & Extract (→ โค้ดทำ Deduplicate)'], '2_context_pick' => ['bi-link-45deg', 'Context Pick (embedding คัดมาก่อน → โมเดลเลือก)'], '3_brief_write' => ['bi-pencil', 'Brief Write (โค้ดจัด Time-box → โมเดลเขียนสรุป + Nudge)']] as $f => [$ic, $t]): $j++; ?>
  <div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button collapsed gap-3" data-bs-toggle="collapse" data-bs-target="#l<?= $j ?>"><i class="bi <?= $ic ?> fs-5 text-info"></i><span class="fw-semibold"><?= h($t) ?></span></button></h2>
    <div id="l<?= $j ?>" class="accordion-collapse collapse" data-bs-parent="#pl"><div class="accordion-body"><pre class="prompt"><?= h(file_get_contents(APP_ROOT . "/prompts/local/$f.md")) ?></pre></div></div></div>
<?php endforeach; ?>
</div>
<?php layout_foot();
