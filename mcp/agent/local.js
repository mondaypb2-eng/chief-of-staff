// Local-LLM workflow (Ollama). The small model does only language understanding, as schema-constrained JSON;
// code does lookups, dedupe, scheduling and validation through the same MCP servers the Claude agent uses.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadSettings } from "../lib/config.js";
import { connectAll, makeCaller, closeAll } from "../lib/mcp-client.js";
import { dateContext, toMin, hhmm, addDays } from "../lib/dates.js";
import { chatJSON, embed, cosine } from "../lib/ollama.js";
import { q } from "../lib/db.js";
import { similarity } from "../lib/text.js";
import { parseThaiTimes } from "../lib/thai-time.js";
import { parseThaiDate } from "../lib/thai-date.js";

const prompt = (n) => fs.readFileSync(path.join(ROOT, "prompts", "local", `${n}.md`), "utf8");
const isTime = (t) => /^\d{1,2}:\d{2}$/.test(t || "");
const padTime = (t) => (isTime(t) ? t.padStart(5, "0") : "");

export async function runLocal(opts, log) {
  const env = {};
  if (opts.dbName) env.COS_DB_NAME = opts.dbName;
  if (opts.now) env.COS_NOW = opts.now;
  const clients = await connectAll(env);
  const call = makeCaller(clients, log);
  const llm = [];
  try {
    const r = opts.mode === "brief" ? await brief(opts, call, llm) : await capture(opts, call, llm);
    return { ...r, llm_stats: llm };
  } finally {
    await closeAll(clients);
  }
}

// ======================= CAPTURE =======================
async function capture(opts, call, llm) {
  const dc = dateContext(opts.now);
  const dateEnum = ["", ...dc.dates.map((d) => d.date)];
  const item = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["event", "task", "note", "person_info", "shopping", "inventory", "unclear"] },
      action: { type: "string", enum: ["create", "update", "cancel"] },
      title: { type: "string" }, date: { type: "string", enum: dateEnum }, time: { type: "string" }, end_time: { type: "string" },
      location: { type: "string" }, offsite: { type: "boolean" }, person: { type: "string" },
      priority: { type: "string", enum: ["high", "medium", "low"] }, duration_min: { type: "integer" },
      qty: { type: "number" }, unit: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
      detail: { type: "string" }, question: { type: "string" }, source_text: { type: "string" },
    },
    required: ["kind", "action", "title", "date", "time", "person", "source_text"],
  };
  const schema = { type: "object", properties: { items: { type: "array", items: item } }, required: ["items"] };
  const user = `${dc.text}\n\nข้อความของผู้ใช้:\n"""\n${opts.text}\n"""`;
  const { data, stats } = await chatJSON({
    system: prompt("1_split_extract"), user, schema, numPredict: 3000,
    validate: (o) => (!Array.isArray(o.items) ? "items must be an array" : o.items.some((i) => !i.title?.trim()) ? "every item needs a title" : null),
  });
  llm.push({ step: "split_extract", ...stats });

  const lines = [];
  const items = data.items.map(fixKind).map((it) => fixItem(it, opts.text, dc, data.items.length)).filter(Boolean);
  for (const it of items) {
    try { lines.push(...(await handleItem(it, call, dc))); }
    catch (e) { lines.push(`⚠️ ${it.title}: ${e.message}`); }
  }
  return { reply: lines.join("\n") || "ไม่พบเรื่องที่ต้องบันทึก", extracted: items };
}

// Guardrail for small models that mislabel kinds: actions are tasks, not inventory / person facts.
const ACTION_VERB = /^(โทร|จ่าย|ชำระ|ส่ง|จอง|ทำ|ไปรับ|ไปส่ง|รับ|ต่อ|ซ่อม|ติดต่อ|ทัก|ไลน์|เมล|อีเมล|นัด|ยื่น|โอน|คืน|เตรียม|เช็ค|ตรวจ)/;
const STOCK_WORD = /(หมด|เหลือ|ยังมี|มีอยู่|ใช้ไป|ซื้อมา|เติมแล้ว)/;
function fixKind(it) {
  const t = (it.title || "").trim(), src = it.source_text || "";
  if (it.kind === "inventory" && (ACTION_VERB.test(t) || !STOCK_WORD.test(src))) return { ...it, kind: "task", action: "create" };
  if (it.kind === "person_info" && ACTION_VERB.test(t)) return { ...it, kind: "task", action: "create" };
  return it;
}

// Guardrails measured on the eval: a 4B model leaves the day empty for "วันจันทร์หน้า"/"tomorrow", ignores "ด่วน",
// marks a hospital visit as on-site, turns "จดไว้ … Zoom Meeting ID …" into an appointment with no day, and files
// small talk ("อากาศดีจัง") as notes. Code reads these from the user's own words.
const MEMO = /จด(?:ไว้|หน่อย|ด้วย|โน้ต)?|บันทึกไว้|จำไว้|โน้ตไว้|note (?:this|down)|remember/i;
const URGENT = /ด่วน|เร่งด่วน|สำคัญมาก|urgent|asap/i;
const OFFICE = /ออฟฟิศ|office|ห้องประชุม|zoom|teams|google meet|online|ออนไลน์|ที่ทำงาน|บริษัทเรา|โต๊ะ/i;
const PLACE = /โรงพยาบาล|รพ\.|คลินิก|ร้าน|ห้าง|สนามบิน|โรงแรม|บ้าน|ธนาคาร|สาขา|ไปที่|ไปหา|ไปตรวจ|ไปรับ|ไปส่ง|ไปซื้อ|ไปกิน/i;
const CONCRETE = /\d|@|https?:|www\./i;

function fixItem(it, fullText, dc, count) {
  const src = it.source_text || it.title || "";
  const memo = MEMO.test(fullText);
  const out = { ...it };
  // "จดไว้ …" with no day and no time is information to keep, not an appointment
  if (out.kind === "event" && memo && !out.date && !parseThaiDate(src, dc) && !parseThaiTimes(src).start)
    Object.assign(out, { kind: "note", action: "create", detail: src });
  // small talk is not a note: keep a note only if the user asked to remember it, or it holds concrete data
  if (out.kind === "note" && !memo && !CONCRETE.test(src)) return null;
  if (["event", "task"].includes(out.kind)) {
    const d = parseThaiDate(src, dc, out.date) || (count === 1 ? parseThaiDate(fullText, dc, out.date) : null);
    if (d) out.date = d;
    if (URGENT.test(src) || (count === 1 && URGENT.test(fullText))) out.priority = "high";
  }
  if (out.kind === "event") {
    const where = `${out.location || ""} ${out.title || ""}`;
    if (OFFICE.test(where)) out.offsite = false;
    else if (PLACE.test(where) || PLACE.test(src)) out.offsite = true;
  }
  return out;
}

async function lookupPerson(call, name) {
  if (!name?.trim()) return { id: null };
  const r = await call("find_person", { name });
  const list = r.ok ? r.data : [];
  if (list.length === 1) return { id: list[0].id, name: list[0].name };
  if (list.length > 1) return { ambiguous: list };
  return { id: null, unknown: true };
}

async function clarify(call, fragment, question) {
  await call("add_clarification", { fragment, question });
  return [`❓ ${question}`];
}

const dupId = (err) => { const m = /"id":(\d+)/.exec(err || ""); return m ? Number(m[1]) : null; };

async function handleItem(it, call, dc) {
  const src = it.source_text || it.title;
  if (it.kind === "unclear") return clarify(call, src, it.question || `“${it.title}” หมายถึงอะไร?`);

  // People must be unambiguous before anything is linked to them
  const needsPerson = ["event", "task", "person_info"].includes(it.kind) && it.person;
  const who = needsPerson ? await lookupPerson(call, it.person) : { id: null };
  if (who.ambiguous) return clarify(call, src, `“${it.person}” หมายถึง ${who.ambiguous.map((p) => `${p.name} (${p.relationship || p.company || "-"})`).join(" หรือ ")}?`);

  switch (it.kind) {
    case "event": {
      // time comes from the user's own words (deterministic parser, last value wins); the model's guess is the fallback
      const pt = parseThaiTimes(src, it.time);
      const time = pt.start || padTime(it.time);
      const endTime = pt.end || (isTime(it.end_time) ? padTime(it.end_time) : "");
      if (it.action !== "create") {
        // find the existing appointment to move/cancel
        const r = await call("search_events", { from: addDays(dc.today, -1), to: addDays(dc.today, 45) });
        // Never move someone else's appointment: if we know who it is with, only that person's events (or
        // unassigned ones with a clearly similar title) qualify.
        const cands = (r.ok ? r.data : []).filter((e) => !(who.id && e.person_id && e.person_id !== who.id))
          .map((e) => ({ ...e, s: who.id && e.person_id === who.id ? 0.6 + similarity(it.title, e.title) : similarity(it.title, e.title) }))
          .filter((e) => (who.id && e.person_id === who.id) || e.s >= 0.6).sort((a, b) => b.s - a.s);
        if (cands.length) {
          const ev = cands[0];
          if (it.action === "cancel") { await call("update_event", { id: ev.id, status: "cancelled" }); return [`🗑️ ยกเลิกนัด “${ev.title}”`]; }
          const date = it.date || ev.start_at.slice(0, 10);
          const t = time || ev.start_at.slice(11, 16);
          const u = await call("update_event", { id: ev.id, start_at: `${date} ${t}`, ...(it.location ? { location: it.location } : {}) });
          return u.ok ? [`🔁 ย้ายนัด “${ev.title}” เป็น ${thaiDT(date, t, dc)}`] : [`⚠️ ${u.error}`];
        }
        if (it.action === "cancel") return [`ℹ️ ไม่พบนัด “${it.title}” ที่จะยกเลิก`];
      }
      if (!it.date) return clarify(call, src, `นัด “${it.title}” วันไหน เวลาเท่าไร?`);
      if (!time) {
        const t = await call("create_task", { title: it.title, due_date: it.date, priority: it.priority || "medium", person_id: who.id ?? undefined, source_text: src });
        return t.ok ? [`✅ งาน “${it.title}” ภายใน ${thaiDT(it.date, "", dc)} (ไม่ได้ระบุเวลา)`] : [`🔁 มี “${it.title}” อยู่แล้ว`];
      }
      const offsite = it.offsite ?? !!(it.location && !/ออฟฟิศ|office|ห้องประชุม|zoom|teams|online|ออนไลน์/i.test(it.location));
      const args = { title: it.title, start_at: `${it.date} ${time}`, location: it.location || undefined, is_offsite: offsite,
        person_id: who.id ?? undefined, source_text: src, notes: it.detail || undefined };
      if (endTime && endTime > time) args.end_at = `${it.date} ${endTime}`;
      else if (it.duration_min) args.duration_min = it.duration_min;
      else if (/^(โทร|ทัก|ไลน์|คอล|call)/i.test(it.title)) args.duration_min = 15;   // a call isn't an hour-long meeting
      const c = await call("create_event", args);
      if (c.ok) return [`✅ นัด “${it.title}” ${thaiDT(it.date, time, dc)}${it.location ? " ที่ " + it.location : ""}`,
        ...(c.data.conflicts || []).map((x) => `⚠️ เวลาชนกับ “${x.title}” ${x.start_at.slice(11, 16)}–${x.end_at.slice(11, 16)}`)];
      const id = dupId(c.error);
      if (id) {
        const u = await call("update_event", { id, start_at: `${it.date} ${time}`, ...(it.location ? { location: it.location } : {}) });
        return [`🔁 มีนัดนี้อยู่แล้ว — ${u.ok ? "อัปเดตเป็น " + thaiDT(it.date, time, dc) : "ไม่ได้เปลี่ยน"}`];
      }
      return [`⚠️ ${c.error}`];
    }
    case "task": {
      if (it.action !== "create") {
        const r = await call("search_tasks", { limit: 100 });
        const best = (r.ok ? r.data : []).map((t) => ({ ...t, s: similarity(it.title, t.title) })).filter((t) => t.s >= 0.4).sort((a, b) => b.s - a.s)[0];
        if (best) {
          if (it.action === "cancel") { await call("update_task", { id: best.id, status: "cancelled" }); return [`🗑️ ยกเลิกงาน “${best.title}”`]; }
          await call("update_task", { id: best.id, ...(it.date ? { due_date: it.date } : {}), ...(it.priority ? { priority: it.priority } : {}), ...(it.detail ? { append_notes: it.detail } : {}) });
          return [`🔁 อัปเดตงาน “${best.title}”${it.date ? " กำหนด " + thaiDT(it.date, "", dc) : ""}`];
        }
      }
      const c = await call("create_task", { title: it.title, due_date: it.date || undefined, priority: it.priority || "medium",
        duration_min: it.duration_min || undefined, person_id: who.id ?? undefined, notes: it.detail || undefined, source_text: src });
      if (c.ok) return [`✅ งาน “${it.title}”${it.date ? " ภายใน " + thaiDT(it.date, "", dc) : ""}`];
      const id = dupId(c.error);
      if (id) {
        if (it.date || it.detail) await call("update_task", { id, ...(it.date ? { due_date: it.date } : {}), ...(it.detail ? { append_notes: it.detail } : {}) });
        return [`🔁 มีงานนี้อยู่แล้ว${it.date ? " — อัปเดตกำหนดเป็น " + thaiDT(it.date, "", dc) : ""}`];
      }
      return [`⚠️ ${c.error}`];
    }
    case "shopping": {
      const r = await call("add_shopping_items", { items: [{ name: it.title, ...(it.qty > 0 ? { qty: it.qty } : {}), ...(it.unit ? { unit: it.unit } : {}), ...(it.detail ? { needed_for: it.detail } : {}) }] });
      const x = r.ok ? r.data[0] : null;
      return [x?.merged ? `🔁 “${x.name}” มีในรายการซื้ออยู่แล้ว — อัปเดตจำนวน` : `🛒 เพิ่ม “${it.title}”${it.qty > 0 ? " " + it.qty + (it.unit ? " " + it.unit : "") : ""} ในรายการซื้อ`];
    }
    case "inventory": {
      if (typeof it.qty !== "number") return [];      // "ยังมีอยู่" — nothing to change
      const r = await call("update_inventory", { name: it.title, qty: Math.max(0, it.qty), ...(it.unit ? { unit: it.unit } : {}) });
      return r.ok ? [`📦 ของในบ้าน: ${it.title} = ${Math.max(0, it.qty)}`] : [];
    }
    case "note": {
      // numbers (IDs, passwords, phone numbers) must survive exactly: keep the user's own words in the body
      const body = /\d/.test(src) && !(it.detail || "").includes(src) ? (it.detail && it.detail !== src ? `${src}\n${it.detail}` : src) : (it.detail || src);
      const c = await call("create_note", { title: it.title, body, tags: [] });
      if (c.ok) return [`📝 จดโน้ต “${it.title}”`];
      const id = dupId(c.error);
      if (id) { await call("update_note", { id, append: it.detail || src }); return [`🔁 เพิ่มข้อมูลในโน้ตเดิม`]; }
      return [`⚠️ ${c.error}`];
    }
    case "person_info": {
      const fields = { ...(it.phone ? { phone: it.phone } : {}), ...(it.email ? { email: it.email } : {}) };
      // phone numbers sometimes only appear in the free text
      const ph = /0\d{1,2}-?\d{3}-?\d{4}/.exec(`${it.detail || ""} ${src}`);
      if (!fields.phone && ph) fields.phone = ph[0];
      if (who.id) {
        await call("update_person", { id: who.id, ...fields, ...(it.detail ? { append_notes: it.detail } : {}) });
        return [`👤 อัปเดตข้อมูล ${who.name}${fields.phone ? " (เบอร์ " + fields.phone + ")" : ""}`];
      }
      if (!it.person) return clarify(call, src, `ข้อมูล “${it.title}” เป็นของใคร?`);
      const c = await call("create_person", { name: it.person, ...fields, notes: it.detail || undefined });
      return c.ok ? [`👤 เพิ่มรายชื่อ ${it.person}`] : [`⚠️ ${c.error}`];
    }
  }
  return [];
}

function thaiDT(date, time, dc) {
  const d = dc.dates.find((x) => x.date === date);
  const label = d ? (d.rel || d.th) : date;
  return `${label} ${date.slice(8)}/${date.slice(5, 7)}${time ? " " + time : ""}`;
}

// ======================= BRIEF =======================
async function brief(opts, call, llm) {
  const dc = dateContext(opts.now);
  const date = opts.date || dc.today;
  const day = (await call("get_day", { date })).data;
  const stale = (await call("get_stale_tasks", {})).data ?? [];
  const clar = (await call("list_clarifications", {})).data ?? [];

  // ---- 1. time-box (deterministic)
  const { blocks, unscheduled } = schedule(day, date);

  // ---- 2. context linking: embeddings shortlist → model picks
  const eventPeople = new Set(day.events.map((e) => e.person_id).filter(Boolean));
  const scheduledIds = new Set(blocks.filter((b) => b.kind === "task").map((b) => b.ref_id));
  const items = [
    ...day.events.map((e) => ({ ref: `event:${e.id}`, type: "event", id: e.id, title: e.title, person_id: e.person_id, extra: e.location || "" })),
    ...day.open_tasks.filter((t) => scheduledIds.has(t.id) && t.priority === "high").map((t) => ({ ref: `task:${t.id}`, type: "task", id: t.id, title: t.title, person_id: t.person_id, extra: "" })),
  ];
  const links = items.length ? await linkContext(items, call, llm) : [];

  // ---- 3. writing (summary + nudges)
  const timeline = blocks.map((b) => `${b.start}-${b.end} ${b.title}`).join("\n");
  const staleList = stale.slice(0, 6);
  const wschema = { type: "object", required: ["summary", "nudges"], properties: {
    summary: { type: "string" },
    nudges: { type: "array", items: { type: "object", required: ["task_id", "message"], properties: { task_id: { type: "integer", enum: staleList.length ? staleList.map((t) => t.id) : [0] }, message: { type: "string" } } } } } };
  const w = await chatJSON({
    system: prompt("3_brief_write"), schema: wschema, numPredict: 1200,
    user: `วันที่: ${date}\nตาราง:\n${timeline}\n${day.conflicts?.length ? `\nนัดที่เวลาชนกัน (ต้องบอกผู้ใช้): ${day.conflicts.map((c) => `${c.a.title} กับ ${c.b.title}`).join("; ")}\n` : ""}\nงานที่ยังไม่ได้ลงตาราง: ${unscheduled.map((u) => u.title).join(", ") || "-"}\n\nงานค้างนาน:\n${staleList.map((t) => `id ${t.id}: ${t.title} (ค้าง ${t.days_stale} วัน, ความสำคัญ ${t.priority})`).join("\n") || "-"}`,
  });
  llm.push({ step: "brief_write", ...w.stats });
  const msgBy = new Map((w.data.nudges || []).map((n) => [n.task_id, n.message]));
  const nudges = staleList.map((t) => ({ task_id: t.id, title: t.title, days_stale: Number(t.days_stale),
    message: msgBy.get(t.id) || `ค้างมา ${t.days_stale} วันแล้ว — ทำต่อ หรือยกเลิกดี?` }));

  const save = await call("save_daily_plan", { date, summary: w.data.summary, blocks, context_links: links, nudges,
    unscheduled: unscheduled.map((u) => ({ task_id: u.id, reason: u.reason })) });
  if (!save.ok) throw new Error(save.error);

  const linkBy = new Map(links.map((l) => [`${l.for_type}:${l.for_id}`, l]));
  const out = [w.data.summary, ""];
  for (const b of blocks) {
    if (b.kind === "break" || b.kind === "travel") continue;
    out.push(`${b.start} · ${b.title}`);
    const l = linkBy.get(`${b.ref_type}:${b.ref_id}`);
    if (l?.why) out.push(`   📎 ${l.why}`);
  }
  if (day.conflicts?.length) out.push("", ...day.conflicts.map((c) => `⛔ นัดชนกัน: “${c.a.title}” ${c.a.time} กับ “${c.b.title}” ${c.b.time} — เลื่อนอันใดอันหนึ่ง`));
  if (nudges.length) out.push("", ...nudges.map((n) => `⚠️ ${n.title}: ${n.message}`));
  if (clar.length) out.push("", ...clar.map((c) => `❓ ${c.question}`));
  return { reply: out.join("\n") };
}

/** Greedy time-boxing into real free slots, keeping ~20% of free time open. */
export function schedule(day, date) {
  const slots = day.free_slots.map((s) => ({ start: toMin(s.start), end: toMin(s.end), cur: toMin(s.start) }));
  const totalFree = slots.reduce((a, s) => a + (s.end - s.start), 0);
  const budget = Math.floor(totalFree * 0.8);
  const eventPeople = new Set(day.events.map((e) => e.person_id).filter(Boolean));
  const tomorrow = addDays(date, 1);
  const score = (t) => (t.due_date && t.due_date < date ? 100 : 0) + (t.due_date === date ? 60 : 0)
    + (t.due_date === tomorrow && t.priority === "high" ? 50 : 0) + (t.person_id && eventPeople.has(t.person_id) ? 40 : 0)
    + ({ high: 30, medium: 15, low: 0 }[t.priority] ?? 0) + (t.due_date ? Math.max(0, 14 - daysBetween(date, t.due_date)) : 0);
  const tasks = [...day.open_tasks].sort((a, b) => score(b) - score(a));

  const taskBlocks = [], unscheduled = [];
  let used = 0;
  for (const t of tasks) {
    const d = t.duration_min || 30;
    // the 20% reserve only holds back work that can wait; urgent work (high priority, due by tomorrow or overdue) may use it
    const urgent = t.priority === "high" && t.due_date && t.due_date <= tomorrow;
    if (!urgent && used + d > budget) { unscheduled.push({ id: t.id, title: t.title, reason: "เวลาว่างวันนี้เต็มแล้ว (เผื่อ 20% ไว้สำหรับเรื่องแทรก)" }); continue; }
    const s = slots.find((x) => x.end - x.cur >= d);
    if (s) {
      taskBlocks.push({ start: hhmm(s.cur), end: hhmm(s.cur + d), kind: "task", ref_type: "task", ref_id: t.id, title: t.title });
      s.cur += d; used += d; continue;
    }
    if (d >= 90) { // split across two slots
      const s1 = slots.find((x) => x.end - x.cur >= 30);
      const s2 = s1 && slots.find((x) => x !== s1 && x.end - x.cur >= d - Math.min(s1.end - s1.cur, d - 30));
      if (s1 && s2) {
        const p1 = Math.min(s1.end - s1.cur, d - 30), p2 = d - p1;
        taskBlocks.push({ start: hhmm(s1.cur), end: hhmm(s1.cur + p1), kind: "task", ref_type: "task", ref_id: t.id, title: `${t.title} (1/2)` });
        taskBlocks.push({ start: hhmm(s2.cur), end: hhmm(s2.cur + p2), kind: "task", ref_type: "task", ref_id: t.id, title: `${t.title} (2/2)` });
        s1.cur += p1; s2.cur += p2; used += d; continue;
      }
    }
    unscheduled.push({ id: t.id, title: t.title, reason: `ไม่มีช่วงว่างยาวพอ (${d} นาที)` });
  }
  // fixed blocks: events, travel, lunch — lunch is trimmed if travel runs into it
  const fixed = [];
  for (const b of [...day.busy].sort((a, b) => toMin(a.start) - toMin(b.start))) {
    let s = toMin(b.start); const e = toMin(b.end);
    const prev = fixed[fixed.length - 1];
    if (b.kind === "break" && prev && toMin(prev.end) > s) s = toMin(prev.end);
    if (e <= s) continue;
    fixed.push({ start: hhmm(s), end: hhmm(e), kind: b.kind, ref_type: b.ref_type || "none", ref_id: b.ref_id ?? null, title: b.title });
  }
  const blocks = [...fixed, ...taskBlocks].sort((a, b) => toMin(a.start) - toMin(b.start));
  return { blocks, unscheduled };
}

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function noteVectors() {
  const s = loadSettings().ollama;
  const notes = await q("SELECT id,title,body,tags,person_id,updated_at FROM notes");
  const cache = new Map((await q("SELECT note_id,model,note_updated_at,vec FROM note_embeddings")).map((r) => [r.note_id, r]));
  const missing = notes.filter((n) => { const c = cache.get(n.id); return !c || c.model !== s.embed_model || c.note_updated_at !== n.updated_at; });
  if (missing.length) {
    const vecs = await embed(missing.map((n) => `${n.title}\n${n.tags}\n${n.body}`));
    for (let i = 0; i < missing.length; i++) {
      await q("REPLACE INTO note_embeddings (note_id,model,note_updated_at,vec) VALUES (?,?,?,?)", [missing[i].id, s.embed_model, missing[i].updated_at, JSON.stringify(vecs[i])]);
      cache.set(missing[i].id, { vec: JSON.stringify(vecs[i]) });
    }
  }
  return notes.map((n) => ({ ...n, vec: JSON.parse(cache.get(n.id).vec) }));
}

async function linkContext(items, call, llm) {
  const notes = await noteVectors();
  const shopping = (await call("list_shopping", {})).data ?? [];
  const openTasks = (await call("search_tasks", { limit: 100 })).data ?? [];
  const people = {};
  for (const pid of new Set(items.map((i) => i.person_id).filter(Boolean))) {
    const r = await call("get_person", { id: pid, interactions: 2 });
    if (r.ok) people[pid] = r.data;
  }
  const qv = await embed(items.map((i) => `${i.title} ${people[i.person_id]?.name ?? ""} ${people[i.person_id]?.company ?? ""} ${i.extra}`));
  const shopVec = shopping.length ? await embed(shopping.map((s) => `${s.name} ${s.needed_for ?? ""}`)) : [];

  const blocks = items.map((it, k) => {
    const scored = notes.map((n) => ({ n, s: cosine(qv[k], n.vec) })).sort((a, b) => b.s - a.s);
    const top = scored[0]?.s ?? 0;
    // bge-m3 cosine on this data: related notes ≈ 0.54–0.62, unrelated ≈ 0.30–0.50 → shortlist ≥ 0.52 near the top,
    // plus notes tied to the same person. The model then picks from this shortlist only.
    const noteC = scored.filter((x) => (x.s >= 0.52 && x.s >= top - 0.08) || (it.person_id && x.n.person_id === it.person_id && x.s >= 0.4)).slice(0, 5).map((x) => x.n);
    const shopC = shopping.map((s, i) => ({ s, sc: cosine(qv[k], shopVec[i]) })).filter((x) => x.sc >= 0.5).slice(0, 3).map((x) => x.s);
    const taskC = openTasks.filter((t) => it.person_id && t.person_id === it.person_id && !(it.type === "task" && t.id === it.id)).slice(0, 4);
    const p = people[it.person_id];
    return { it, noteC, shopC, taskC, p };
  });

  const text = blocks.map(({ it, noteC, shopC, taskC, p }) => [
    `### ${it.ref} — ${it.title}`,
    p ? `บุคคล person:${p.id} ${p.name} (${p.relationship ?? ""} ${p.company ?? ""}) คุยล่าสุด: ${(p.recent_interactions || []).map((x) => x.summary).join(" / ") || "-"}` : "บุคคล: -",
    "โน้ต:", ...(noteC.length ? noteC.map((n) => `  note:${n.id} ${n.title} — ${n.body.replace(/\s+/g, " ").slice(0, 160)}`) : ["  -"]),
    "ของที่ต้องซื้อ:", ...(shopC.length ? shopC.map((s) => `  shopping:${s.id} ${s.name} ${s.needed_for ? "(" + s.needed_for + ")" : ""}`) : ["  -"]),
    "งานที่เกี่ยว:", ...(taskC.length ? taskC.map((t) => `  task:${t.id} ${t.title}`) : ["  -"]),
  ].join("\n")).join("\n\n");

  const schema = { type: "object", required: ["links"], properties: { links: { type: "array", items: { type: "object",
    required: ["ref", "note_ids", "person_ids", "shopping_ids", "task_ids", "why"],
    properties: { ref: { type: "string", enum: items.map((i) => i.ref) }, note_ids: { type: "array", items: { type: "integer" } },
      person_ids: { type: "array", items: { type: "integer" } }, shopping_ids: { type: "array", items: { type: "integer" } },
      task_ids: { type: "array", items: { type: "integer" } }, why: { type: "string" } } } } } };
  const r = await chatJSON({ system: prompt("2_context_pick"), user: text, schema, numPredict: 1500 });
  llm.push({ step: "context_pick", ...r.stats });

  // keep only ids that were actually offered as candidates for that item
  const out = [];
  for (const b of blocks) {
    const l = (r.data.links || []).find((x) => x.ref === b.it.ref);
    if (!l) continue;
    const pick = (ids, allowed) => [...new Set(ids || [])].filter((id) => allowed.includes(id));
    const link = { for_type: b.it.type, for_id: b.it.id, title: b.it.title,
      note_ids: pick(l.note_ids, b.noteC.map((n) => n.id)), person_ids: pick(l.person_ids, b.p ? [b.p.id] : []),
      shopping_ids: pick(l.shopping_ids, b.shopC.map((s) => s.id)), task_ids: pick(l.task_ids, b.taskC.map((t) => t.id)), why: l.why || "" };
    if (b.p && !link.person_ids.length && link.note_ids.length) link.person_ids = [b.p.id];
    if (link.note_ids.length + link.person_ids.length + link.shopping_ids.length + link.task_ids.length) out.push(link);
  }
  return out;
}
