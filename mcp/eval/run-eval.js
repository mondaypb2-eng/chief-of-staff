// Eval suite for the agent (needs an API key). Each case: reset the eval DB to the demo data at a fixed "now",
// run the agent on the case's messages, then check the database with exact SQL assertions.
// Usage: node eval/run-eval.js [case_key ...]
import fs from "node:fs";
import path from "node:path";
import { runAgent, shutdown } from "../agent/agent.js";
import { setupDb } from "../setup.js";
import { ROOT } from "../lib/config.js";
import mysql from "mysql2/promise";
import { loadSettings } from "../lib/config.js";

const NOW = "2026-11-25T08:00:00+07:00"; // Wednesday
const DB = "chief_of_staff_eval";
const TOMORROW = "2026-11-26";

let conn;
const q = async (sql, p = []) => (await conn.query(sql, p))[0];
const one = async (sql, p = []) => (await q(sql, p))[0];

const CASES = {
  mind_change: {
    title: "เปลี่ยนใจกลางประโยค → บันทึกเฉพาะค่าสุดท้าย",
    group: "capture",
    steps: ["พรุ่งนี้นัดหมอฟันบ่าย 3 เอ้ยไม่ใช่ 4 โมงเย็น ที่คลินิกสุขุมวิทนะ"],
    checks: async () => {
      const ev = await q("SELECT * FROM events WHERE title LIKE '%ฟัน%' AND status<>'cancelled'");
      return [
        ["มีนัดหมอฟันแค่ 1 รายการ", ev.length === 1, `${ev.length} รายการ`],
        ["เวลาเป็น 16:00 พรุ่งนี้ (ไม่ใช่ 15:00)", ev[0]?.start_at === `${TOMORROW} 16:00:00`, ev.map((e) => e.start_at).join(", ")],
        ["ไม่มีนัด 15:00 หลงเหลือ", !(await one("SELECT id FROM events WHERE start_at=? ", [`${TOMORROW} 15:00:00`]))],
      ];
    },
  },
  repeat_no_duplicate: {
    title: "พูดเรื่องเดิมซ้ำอีกรอบ → ไม่บันทึกซ้ำ",
    group: "capture",
    steps: ["พรุ่งนี้นัดหมอฟันบ่าย 3 เอ้ยไม่ใช่ 4 โมงเย็น ที่คลินิกสุขุมวิทนะ", "อย่าลืมนะ พรุ่งนี้สี่โมงเย็นไปหาหมอฟัน"],
    checks: async () => {
      const ev = await q("SELECT * FROM events WHERE title LIKE '%ฟัน%' AND status<>'cancelled'");
      const tk = await q("SELECT * FROM tasks WHERE title LIKE '%ฟัน%' AND status IN ('todo','doing')");
      return [
        ["ยังมีนัดหมอฟัน 1 รายการ", ev.length === 1, `${ev.length} รายการ`],
        ["ไม่สร้าง task ซ้ำของเรื่องเดียวกัน", tk.length === 0, tk.map((t) => t.title).join(", ")],
      ];
    },
  },
  correction_later: {
    title: "แก้นัดในข้อความถัดไป → อัปเดตของเดิม",
    group: "capture",
    steps: ["ศุกร์นี้นัดกินข้าวกับไอ้เอก 1 ทุ่ม ที่ร้านส้มตำแถวอารีย์", "เลื่อนนัดกินข้าวกับเอกเป็นวันเสาร์ 6 โมงเย็นแทนนะ"],
    checks: async () => {
      const ev = await q("SELECT * FROM events WHERE (title LIKE '%เอก%' OR person_id=3) AND status<>'cancelled'");
      return [
        ["มีนัดกับเอกที่ยังไม่ยกเลิก 1 รายการ", ev.length === 1, `${ev.length} รายการ`],
        ["ย้ายเป็นเสาร์ 28 พ.ย. 18:00", ev[0]?.start_at === "2026-11-28 18:00:00", ev.map((e) => e.start_at).join(", ")],
        ["ไม่ไปแตะนัดอื่น (กินข้าววันเกิดแม่ ยังอยู่ 30 พ.ย. 18:00)", (await one("SELECT start_at FROM events WHERE id=5"))?.start_at === "2026-11-30 18:00:00"],
        ["ผูกกับคน: เอกชัย (ไม่ใช่พี่เอ)", ev[0]?.person_id === 3 || ev[0]?.person_id == null, `person_id=${ev[0]?.person_id}`],
      ];
    },
  },
  split_shopping_inventory: {
    title: "แตกหลายเรื่องในประโยคเดียว + รวมรายการซื้อเดิม",
    group: "capture",
    steps: ["ซื้อนมด้วยนะ เอา 3 กล่อง แล้วไข่หมดแล้ว ซื้อไข่ 1 แผง ส่วนกาแฟยังเหลืออยู่ไม่ต้องซื้อ"],
    checks: async () => {
      const milk = await q("SELECT * FROM shopping_items WHERE name LIKE '%นม%' AND status='needed'");
      const egg = await q("SELECT * FROM shopping_items WHERE name LIKE '%ไข่%' AND status='needed'");
      const coffee = await q("SELECT * FROM shopping_items WHERE name LIKE '%กาแฟ%' AND status='needed'");
      const inv = await one("SELECT qty FROM inventory WHERE name LIKE '%ไข่%'");
      return [
        ["นมมีรายการเดียว (รวมกับของเดิม)", milk.length === 1, `${milk.length} รายการ`],
        ["จำนวนนมเป็น 3", Number(milk[0]?.qty) === 3, `qty=${milk[0]?.qty}`],
        ["เพิ่มไข่ 1 รายการ", egg.length === 1, `${egg.length} รายการ`],
        ["ไม่เพิ่มกาแฟ", coffee.length === 0],
        ["อัปเดตของในบ้าน: ไข่ = 0", Number(inv?.qty) === 0, `qty=${inv?.qty}`],
      ];
    },
  },
  ambiguous_clarify: {
    title: "ข้อมูลกำกวม → แยกเข้า needs_clarification ไม่เดา",
    group: "capture",
    steps: ["โทรหาเอเรื่องนั้นด้วย แล้วก็จ่ายค่าไฟก่อนวันศุกร์"],
    checks: async () => {
      const cl = await q("SELECT * FROM clarifications WHERE status='open'");
      const callTask = await q("SELECT * FROM tasks WHERE title LIKE '%โทร%' AND person_id IN (2,3)");
      const bill = await q("SELECT * FROM tasks WHERE title LIKE '%ไฟ%' AND status='todo'");
      return [
        ["มีคำถาม clarification อย่างน้อย 1", cl.length >= 1, cl.map((c) => c.question).join(" | ")],
        ["ไม่เดาว่าเป็นพี่เอหรือเอกชัย", callTask.length === 0, callTask.map((t) => `${t.title}→${t.person_id}`).join(", ")],
        ["ส่วนที่ชัดเจน (ค่าไฟ) ยังบันทึกได้ ครบกำหนด ≤ ศุกร์ 27 พ.ย.", bill.length === 1 && bill[0].due_date && bill[0].due_date <= "2026-11-27", bill.map((b) => `${b.title} ${b.due_date}`).join(", ")],
      ];
    },
  },
  crm_update_no_dup: {
    title: "ข้อมูลคนเดิม → อัปเดต ไม่สร้างคนซ้ำ",
    group: "capture",
    steps: ["จดไว้หน่อย คุณสมชายที่ ABC เปลี่ยนเบอร์ใหม่เป็น 089-555-0199 แล้วพรุ่งนี้หลังประชุม ABC แวะซื้อเค้กมะพร้าวให้แม่ด้วย"],
    checks: async () => {
      const ppl = await one("SELECT COUNT(*) n FROM people");
      const p = await one("SELECT phone, notes FROM people WHERE id=1");
      const cake = await q("SELECT * FROM shopping_items WHERE name LIKE '%เค้ก%' AND status='needed'");
      const cakeTask = await q("SELECT * FROM tasks WHERE title LIKE '%เค้ก%'");
      return [
        ["ไม่สร้างคนซ้ำ (ยัง 5 คน)", Number(ppl.n) === 5, `${ppl.n} คน`],
        ["อัปเดตเบอร์ของคุณสมชาย", (p.phone || "").includes("089-555-0199") || (p.notes || "").includes("089-555-0199"), p.phone],
        ["บันทึกเค้กมะพร้าว (รายการซื้อหรือ task)", cake.length + cakeTask.length >= 1 && cake.length + cakeTask.length <= 2, `shopping ${cake.length}, task ${cakeTask.length}`],
      ];
    },
  },
  brief_plan: {
    title: "วางแผนพรุ่งนี้: จัดตารางตามเวลาว่างจริง + ดึงบริบท + เตือนงานค้าง",
    group: "brief",
    steps: [{ mode: "brief", date: TOMORROW }],
    checks: async () => {
      const plan = await one("SELECT * FROM daily_plans WHERE plan_date=?", [TOMORROW]);
      if (!plan) return [["บันทึกแผน (save_daily_plan)", false]];
      const blocks = typeof plan.blocks === "string" ? JSON.parse(plan.blocks) : plan.blocks;
      const links = typeof plan.context_links === "string" ? JSON.parse(plan.context_links) : plan.context_links;
      const nz = typeof plan.nudges === "string" ? JSON.parse(plan.nudges) : plan.nudges;
      const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
      const taskBlocks = blocks.filter((b) => b.kind === "task");
      const events = await q("SELECT id,start_at,end_at,is_offsite,travel_min FROM events WHERE DATE(start_at)=? AND status<>'cancelled'", [TOMORROW]);
      const busy = events.flatMap((e) => { const s = toMin(e.start_at.slice(11)), en = toMin(e.end_at.slice(11)), t = e.is_offsite ? (e.travel_min ?? 30) : 0; return [[s - t, en + t]]; });
      busy.push([12 * 60, 13 * 60]);
      const overlapBusy = taskBlocks.filter((b) => busy.some(([s, e]) => toMin(b.start) < e && s < toMin(b.end)));
      const outside = taskBlocks.filter((b) => toMin(b.start) < 9 * 60 || toMin(b.end) > 18 * 60);
      const scheduledMin = taskBlocks.reduce((s, b) => s + toMin(b.end) - toMin(b.start), 0);
      const freeMin = 50 + 70 + 50; // free slots tomorrow from get_day: 13:00-13:50, 15:10-16:20, 17:10-18:00
      const scheduledIds = new Set(taskBlocks.map((b) => b.ref_id));
      const unscheduled = new Set((nz.unscheduled ?? []).map((u) => u.task_id));
      const abcLink = links.find((l) => l.for_type === "event" && l.for_id === 1);
      const allNoteIds = links.flatMap((l) => l.note_ids);
      const nudgeIds = (nz.nudges ?? []).map((n) => n.task_id).sort();
      return [
        ["task ไม่ทับนัด/เวลาเดินทาง/พักเที่ยง", overlapBusy.length === 0, overlapBusy.map((b) => `${b.title} ${b.start}-${b.end}`).join(", ")],
        ["task อยู่ในเวลางาน 09:00–18:00", outside.length === 0],
        ["เวลารวมของ task ≤ เวลาว่างจริง (170 นาที)", scheduledMin <= freeMin, `${scheduledMin} นาที`],
        ["งานด่วนพรุ่งนี้ (id 1, 2) ถูกจัดลงตาราง หรือบอกเหตุผลที่ไม่ลง", [1, 2].every((id) => scheduledIds.has(id) || unscheduled.has(id)), `scheduled=${[...scheduledIds]} unscheduled=${[...unscheduled]}`],
        ["ประชุม ABC ดึงโน้ตเงื่อนไขสัญญา (note 1)", !!abcLink && abcLink.note_ids.includes(1), abcLink ? `notes=${abcLink.note_ids}` : "ไม่มี link"],
        ["ประชุม ABC ดึงข้อมูลคุณสมชาย (person 1)", !!abcLink && abcLink.person_ids.includes(1)],
        ["ไม่ยัดโน้ตที่ไม่เกี่ยว (สูตรต้มยำ, หนังสือ)", !allNoteIds.includes(5) && !allNoteIds.includes(6), `note_ids=${[...new Set(allNoteIds)]}`],
        ["ไม่แนบโน้ต ABC ให้นัดที่ไม่เกี่ยวกับ ABC (Weekly meeting, 1:1 พี่เอ)",
          !links.some((l) => l.for_type === "event" && [2, 3].includes(l.for_id) && l.note_ids.some((n) => [1, 2].includes(n))),
          links.filter((l) => l.for_type === "event" && [2, 3].includes(l.for_id)).map((l) => `event${l.for_id}:${l.note_ids}`).join(" ")],
        ["เตือนเฉพาะงานค้างนาน (id 5, 6)", JSON.stringify(nudgeIds) === "[5,6]", `nudge=${nudgeIds}`],
      ];
    },
  },

  // ---------- harder cases: places where a small model distorts facts ----------
  multi_time_items: {
    title: "สองนัดสองเวลาในประโยคเดียว → เวลาไม่สลับ/ไม่ปนกัน",
    group: "hard",
    steps: ["พรุ่งนี้ 9 โมงครึ่งคอลกับทีมดีไซน์ที่ออฟฟิศ แล้วบ่ายสองไปตรวจสุขภาพที่โรงพยาบาลพระราม 9"],
    checks: async () => {
      const design = await q("SELECT * FROM events WHERE title LIKE '%ดีไซน์%' AND status<>'cancelled'");
      const health = await q("SELECT * FROM events WHERE title LIKE '%สุขภาพ%' AND status<>'cancelled'");
      return [
        ["คอลทีมดีไซน์ พรุ่งนี้ 09:30", design.length === 1 && design[0].start_at === `${TOMORROW} 09:30:00`, design.map((e) => e.start_at).join(", ")],
        ["ตรวจสุขภาพ พรุ่งนี้ 14:00", health.length === 1 && health[0].start_at === `${TOMORROW} 14:00:00`, health.map((e) => e.start_at).join(", ")],
        ["ตรวจสุขภาพนอกสถานที่ (มีเวลาเดินทาง)", health[0]?.is_offsite === 1, `is_offsite=${health[0]?.is_offsite}`],
      ];
    },
  },
  cancel_existing: {
    title: "ยกเลิกนัดที่มีอยู่ → ยกเลิกถูกนัด ไม่แตะนัดอื่น",
    group: "hard",
    steps: ["ยกเลิก 1:1 กับพี่เอพรุ่งนี้นะ ไม่ว่างแล้ว"],
    checks: async () => {
      const st = Object.fromEntries((await q("SELECT id,status FROM events")).map((e) => [e.id, e.status]));
      const n = await one("SELECT COUNT(*) n FROM events");
      return [
        ["1:1 กับพี่เอ (id 3) ถูกยกเลิก", st[3] === "cancelled", `status=${st[3]}`],
        ["นัดอื่น (id 1, 2, 4, 5) ไม่ถูกยกเลิก", [1, 2, 4, 5].every((i) => st[i] !== "cancelled"), JSON.stringify(st)],
        ["ไม่สร้างนัดใหม่", Number(n.n) === 5, `${n.n} นัด`],
      ];
    },
  },
  inventory_no_shopping: {
    title: "บอกจำนวนของในบ้าน + บอกว่ายังไม่ต้องซื้อ → อัปเดตจำนวน ไม่เพิ่มรายการซื้อ",
    group: "hard",
    steps: ["น้ำดื่มเหลือ 3 ขวดแล้วนะ แต่ยังไม่ต้องซื้อ"],
    checks: async () => {
      const w = await one("SELECT qty FROM inventory WHERE name LIKE '%น้ำดื่ม%'");
      const s = await q("SELECT * FROM shopping_items WHERE name LIKE '%น้ำ%' AND status='needed'");
      const t = await q("SELECT * FROM tasks WHERE title LIKE '%น้ำ%'");
      return [
        ["น้ำดื่มในบ้าน = 3", Number(w?.qty) === 3, `qty=${w?.qty}`],
        ["ไม่เพิ่มน้ำในรายการซื้อ", s.length === 0, s.map((x) => x.name).join(", ")],
        ["ไม่สร้าง task เรื่องน้ำ", t.length === 0, t.map((x) => x.title).join(", ")],
      ];
    },
  },
  new_person_phone: {
    title: "คนใหม่ + เบอร์โทร → เพิ่มคนใหม่ เบอร์ตรงทุกหลัก",
    group: "hard",
    steps: ["จดไว้ เบอร์ช่างแอร์ชื่อพี่ต้อม 081-234-5678"],
    checks: async () => {
      const ppl = await q("SELECT * FROM people WHERE name LIKE '%ต้อม%' OR aliases LIKE '%ต้อม%'");
      const all = await one("SELECT COUNT(*) n FROM people");
      return [
        ["มีพี่ต้อมในรายชื่อ 1 คน", ppl.length === 1, `${ppl.length} คน`],
        ["เบอร์ 081-234-5678 ตรง", (ppl[0]?.phone || "").replace(/\D/g, "") === "0812345678", ppl[0]?.phone],
        ["เพิ่มคนใหม่ 1 คน (รวม 6)", Number(all.n) === 6, `${all.n} คน`],
        ["เบอร์ไม่ไปตกอยู่ที่คนอื่น", (await q("SELECT id FROM people WHERE phone LIKE '%234-5678%' AND name NOT LIKE '%ต้อม%'")).length === 0],
      ];
    },
  },
  deadline_next_monday: {
    title: "กำหนดส่ง 'ภายในวันจันทร์หน้า' + ด่วน → task วันที่ถูก priority high",
    group: "hard",
    steps: ["ต้องส่งใบเสนอราคาให้ลูกค้าภายในวันจันทร์หน้า เรื่องนี้ด่วนมาก"],
    checks: async () => {
      const t = await q("SELECT * FROM tasks WHERE title LIKE '%ใบเสนอราคา%'");
      const ev = await q("SELECT * FROM events WHERE title LIKE '%ใบเสนอราคา%'");
      return [
        ["สร้าง task 1 รายการ", t.length === 1, `${t.length}`],
        ["ครบกำหนดจันทร์ 30 พ.ย.", t[0]?.due_date === "2026-11-30", t[0]?.due_date],
        ["priority high", t[0]?.priority === "high", t[0]?.priority],
        ["ไม่สร้างเป็นนัด", ev.length === 0],
      ];
    },
  },
  english_mixed: {
    title: "อังกฤษปนไทย 'tomorrow 3pm call with คุณสมชาย' → เวลาถูก ผูกคนถูก",
    group: "hard",
    steps: ["tomorrow 3pm call with คุณสมชาย about the contract renewal"],
    checks: async () => {
      const ev = await q("SELECT * FROM events WHERE DATE(start_at)=? AND id>5 AND status<>'cancelled'", [TOMORROW]);
      const mins = ev[0] ? (new Date(ev[0].end_at.replace(" ", "T")) - new Date(ev[0].start_at.replace(" ", "T"))) / 60000 : null;
      return [
        ["มีนัดใหม่พรุ่งนี้ 1 รายการ", ev.length === 1, `${ev.length}`],
        ["เวลา 15:00", ev[0]?.start_at === `${TOMORROW} 15:00:00`, ev[0]?.start_at],
        ["ผูกกับคุณสมชาย (person 1)", ev[0]?.person_id === 1, `person_id=${ev[0]?.person_id}`],
        ["เป็นคอลสั้น (≤ 30 นาที)", mins !== null && mins <= 30, `${mins} นาที`],
      ];
    },
  },
  small_talk_nothing: {
    title: "คุยเล่นไม่มีงาน → ไม่สร้างอะไรเลย",
    group: "hard",
    steps: ["วันนี้อากาศดีจัง เมื่อคืนนอนหลับสบายมาก"],
    checks: async () => {
      const c = await one("SELECT (SELECT COUNT(*) FROM tasks) t,(SELECT COUNT(*) FROM events) e,(SELECT COUNT(*) FROM notes) n,(SELECT COUNT(*) FROM shopping_items) s,(SELECT COUNT(*) FROM people) p");
      return [
        ["ไม่มี task/นัด/ของซื้อ/คนใหม่", Number(c.t) === 6 && Number(c.e) === 5 && Number(c.s) === 2 && Number(c.p) === 5, JSON.stringify(c)],
        ["ไม่สร้างโน้ตขยะ", Number(c.n) === 7, `notes=${c.n}`],
      ];
    },
  },
  note_exact_digits: {
    title: "จดโน้ตที่มีตัวเลขสำคัญ → ตัวเลขไม่เพี้ยน",
    group: "hard",
    steps: ["จดไว้หน่อย Zoom ประชุมทีมการตลาด Meeting ID 845 2219 0873 รหัสผ่าน mkt2026"],
    checks: async () => {
      const n = await q("SELECT * FROM notes WHERE id>7");
      const body = n.map((x) => `${x.title} ${x.body}`).join(" ");
      return [
        ["สร้างโน้ตใหม่ 1 รายการ", n.length === 1, `${n.length}`],
        ["Meeting ID ตรงทุกหลัก", body.replace(/\s/g, "").includes("84522190873"), body],
        ["รหัสผ่านตรง", body.includes("mkt2026"), body],
      ];
    },
  },
  shopping_units: {
    title: "ของซื้อหลายรายการพร้อมหน่วย → จำนวน/หน่วยถูกทุกรายการ",
    group: "hard",
    steps: ["ซื้อกระดาษทิชชู่ 2 แพ็ก กับแชมพู 1 ขวด แล้วก็ถ่าน AA 4 ก้อน"],
    checks: async () => {
      const s = await q("SELECT * FROM shopping_items WHERE status='needed' AND id>2");
      const f = (re) => s.find((x) => re.test(x.name));
      const tissue = f(/ทิชชู่/), sh = f(/แชมพู/), aa = f(/ถ่าน|AA/i);
      return [
        ["มีครบ 3 รายการ", s.length === 3, s.map((x) => `${x.name} ${x.qty} ${x.unit}`).join(", ")],
        ["ทิชชู่ 2 แพ็ก", Number(tissue?.qty) === 2 && /แพ็ก|แพ็ค|pack/i.test(tissue?.unit || ""), `${tissue?.qty} ${tissue?.unit}`],
        ["แชมพู 1 ขวด", Number(sh?.qty) === 1 && /ขวด/.test(sh?.unit || ""), `${sh?.qty} ${sh?.unit}`],
        ["ถ่าน AA 4 ก้อน", Number(aa?.qty) === 4 && /ก้อน/.test(aa?.unit || ""), `${aa?.qty} ${aa?.unit}`],
      ];
    },
  },
  brief_faithful: {
    title: "สรุปวันพรุ่งนี้ → ไม่แต่งเวลา/นัด/ตัวเลขที่ไม่มีจริง",
    group: "hard",
    steps: [{ mode: "brief", date: TOMORROW }],
    checks: async () => {
      const plan = await one("SELECT * FROM daily_plans WHERE plan_date=?", [TOMORROW]);
      if (!plan) return [["บันทึกแผน", false]];
      const blocks = typeof plan.blocks === "string" ? JSON.parse(plan.blocks) : plan.blocks;
      const nz = typeof plan.nudges === "string" ? JSON.parse(plan.nudges) : plan.nudges;
      const times = new Set(blocks.flatMap((b) => [b.start, b.end]));
      const said = [...(plan.summary || "").matchAll(/(\d{1,2})[:.](\d{2})/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
      const bad = said.filter((t) => !times.has(t));
      const nudges = nz.nudges ?? [];
      const wrongDays = nudges.filter((n) => [...(n.message || "").matchAll(/(\d+)\s*วัน/g)].some((m) => Number(m[1]) !== Number(n.days_stale)));
      return [
        ["สรุปมีเนื้อหา", (plan.summary || "").trim().length >= 20, plan.summary],
        ["เวลาในสรุปมีอยู่จริงในตาราง", bad.length === 0, `${said.join(",")}${bad.length ? " ← ไม่มีจริง: " + bad : ""}`],
        ["สรุปไม่พูดถึงนัดวันอื่น (วันเกิดแม่)", !/วันเกิดแม่|กินข้าววันเกิด/.test(plan.summary || ""), plan.summary],
        ["จำนวนวันค้างในข้อความเตือนตรงข้อมูลจริง", wrongDays.length === 0, wrongDays.map((n) => `${n.days_stale}: ${n.message}`).join(" | ")],
      ];
    },
  },
};

export async function runEval(only = []) {
  const { db } = loadSettings();
  const results = {};
  for (const [key, c] of Object.entries(CASES)) {
    if (only.length && !only.includes(key)) continue;
    process.stderr.write(`▶ ${key}\n`);
    await setupDb({ dbName: DB, reset: true, seed: true, now: NOW });
    conn = await mysql.createConnection({ ...db, database: DB, dateStrings: true, charset: "utf8mb4" });
    const runs = [];
    let error = null;
    try {
      for (const st of c.steps) {
        const req = typeof st === "string" ? { mode: "capture", text: st } : st;
        const r = await runAgent({ ...req, now: NOW, dbName: DB });
        runs.push({ input: req.text ?? `brief ${req.date}`, reply: r.reply, tool_calls: r.tool_calls.map((t) => ({ name: t.name, input: t.input, is_error: t.is_error, result: t.result.slice(0, 300) })), duration_ms: r.duration_ms });
      }
    } catch (e) { error = e.message; }
    let checks = [];
    if (!error) {
      try { checks = (await c.checks()).map(([name, ok, detail = ""]) => ({ name, ok: !!ok, detail: String(detail) })); }
      catch (e) { error = "check error: " + e.message; }
    }
    await conn.end();
    results[key] = { title: c.title, group: c.group, pass: !error && checks.every((x) => x.ok), error, checks, runs };
    process.stderr.write(`  ${results[key].pass ? "PASS" : "FAIL"}${error ? " " + error : ""}\n`);
  }
  const st = loadSettings();
  const summary = { cases: Object.keys(results).length, passed: Object.values(results).filter((r) => r.pass).length, at: new Date().toISOString(),
    model: st.provider === "claude" ? `Claude · ${st.model}` : `Local · ${st.ollama.model}`,
    seconds: Math.round(Object.values(results).flatMap((r) => r.runs).reduce((a, r) => a + (r.duration_ms || 0), 0) / 1000) };
  const out = { summary, results };
  fs.writeFileSync(path.join(ROOT, "storage", "eval-latest.json"), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("run-eval.js")) {
  const out = await runEval(process.argv.slice(2));
  await shutdown();
  for (const [k, r] of Object.entries(out.results)) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${k} — ${r.title}`);
    for (const c of r.checks) if (!c.ok) console.log(`      XX ${c.name}  ${c.detail}`);
    if (r.error) console.log(`      ERROR ${r.error}`);
  }
  console.log(`\n${out.summary.passed}/${out.summary.cases} cases passed`);
  process.exit(0);
}
