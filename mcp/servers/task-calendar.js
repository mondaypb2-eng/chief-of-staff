// task-calendar-mcp — tasks, calendar events, free-time calculation, daily plans, clarification inbox
import { z } from "zod";
import { createServer, tool, start, nowSql } from "../lib/mcp-helpers.js";
import { q, one, keywordMatch } from "../lib/db.js";
import { loadSettings } from "../lib/config.js";
import { mostSimilar, similarity, overlap } from "../lib/text.js";

const server = createServer("task-calendar-mcp");
const P = () => loadSettings().profile;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const DATETIME = z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/).describe("YYYY-MM-DD HH:MM");
const PRIORITY = z.enum(["high", "medium", "low"]);

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const minOf = (dt) => toMin(dt.slice(11, 16));
const sqlDT = (s) => (s.length === 16 ? s.replace("T", " ") + ":00" : s.replace("T", " "));
const addMin = (dt, m) => { const d = new Date(dt.replace(" ", "T") + "Z"); d.setUTCMinutes(d.getUTCMinutes() + m); return d.toISOString().slice(0, 19).replace("T", " "); };

// ---------------- tasks ----------------
tool(server, "search_tasks",
  "Find existing tasks before creating one (to avoid duplicates) or to plan a day. Matches any keyword in title/notes.",
  { keywords: z.array(z.string()).optional(), status: z.enum(["open", "todo", "doing", "done", "cancelled", "any"]).optional().describe("open = todo+doing (default)"),
    due_before: DATE.optional(), limit: z.number().int().optional() },
  async ({ keywords, status = "open", due_before, limit = 20 }) => {
    const m = keywordMatch(["title", "COALESCE(notes,'')"], keywords);
    const st = status === "open" ? "status IN ('todo','doing')" : status === "any" ? "1=1" : "status = ?";
    const params = [...m.scoreParams, ...m.params];
    if (!["open", "any"].includes(status)) params.push(status);
    let sql = `SELECT id,title,notes,category,priority,status,due_date,duration_min,location,person_id,last_touched_at,${m.score} AS score FROM tasks WHERE ${m.where} AND ${st}`;
    if (due_before) { sql += " AND due_date IS NOT NULL AND due_date <= ?"; params.push(due_before); }
    sql += " ORDER BY score DESC, FIELD(priority,'high','medium','low'), due_date IS NULL, due_date LIMIT ?";
    params.push(limit);
    return q(sql, params);
  });

tool(server, "create_task",
  "Create a to-do. Refuses if a similar open task exists (returns its id) — then update that task instead, or pass force=true if it is truly different.",
  { title: z.string(), notes: z.string().optional(), category: z.string().optional(), priority: PRIORITY.optional(),
    due_date: DATE.optional(), duration_min: z.number().int().optional().describe("realistic estimate of how long it takes"),
    location: z.string().optional(), person_id: z.number().int().optional(), source_text: z.string().optional(), force: z.boolean().optional() },
  async (a) => {
    if (!a.force) {
      const dup = mostSimilar(a.title, await q("SELECT id,title,due_date,status FROM tasks WHERE status IN ('todo','doing')"), "title", 0.6);
      if (dup.length) throw new Error(`possible duplicate of existing task(s): ${JSON.stringify(dup.slice(0, 3))}. Use update_task, or force=true if different.`);
    }
    const now = nowSql();
    const r = await q(`INSERT INTO tasks (title,notes,category,priority,due_date,duration_min,location,person_id,source_text,created_at,updated_at,last_touched_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [a.title, a.notes ?? null, a.category ?? "general", a.priority ?? "medium", a.due_date ?? null,
      a.duration_min ?? 30, a.location ?? null, a.person_id ?? null, a.source_text ?? null, now, now, now]);
    return { created: "task", id: r.insertId, title: a.title };
  });

tool(server, "update_task",
  "Update a task (change due date, priority, mark done, add notes...). Also counts as 'touched' so it won't be nudged.",
  { id: z.number().int(), title: z.string().optional(), notes: z.string().optional(), append_notes: z.string().optional(), category: z.string().optional(),
    priority: PRIORITY.optional(), status: z.enum(["todo", "doing", "done", "cancelled"]).optional(), due_date: DATE.nullable().optional(),
    duration_min: z.number().int().optional(), location: z.string().optional(), person_id: z.number().int().optional() },
  async ({ id, append_notes, ...f }) => {
    const cur = await one("SELECT * FROM tasks WHERE id=?", [id]);
    if (!cur) throw new Error(`task ${id} not found`);
    if (append_notes) f.notes = [cur.notes, append_notes].filter(Boolean).join("\n");
    const sets = Object.keys(f).filter((k) => f[k] !== undefined);
    const now = nowSql();
    await q(`UPDATE tasks SET ${[...sets.map((k) => `${k}=?`), "last_touched_at=?", "updated_at=?"].join(",")} WHERE id=?`, [...sets.map((k) => f[k]), now, now, id]);
    return { updated: "task", id, fields: sets };
  });

tool(server, "get_stale_tasks",
  "Open tasks nobody has touched for a while (default: profile.stale_days) — candidates for a nudge.",
  { days: z.number().int().optional() },
  async ({ days }) => {
    const d = days ?? P().stale_days;
    return q(`SELECT id,title,priority,due_date,category,last_touched_at,nudge_count, DATEDIFF(?, last_touched_at) AS days_stale
      FROM tasks WHERE status IN ('todo','doing') AND DATEDIFF(?, last_touched_at) >= ? ORDER BY days_stale DESC`, [nowSql(), nowSql(), d]);
  });

// ---------------- events ----------------
tool(server, "search_events",
  "Find calendar events by keywords and/or date range. Use before creating an event to avoid duplicates.",
  { keywords: z.array(z.string()).optional(), from: DATE.optional(), to: DATE.optional(), include_cancelled: z.boolean().optional() },
  async ({ keywords, from, to, include_cancelled }) => {
    const m = keywordMatch(["title", "COALESCE(location,'')", "COALESCE(notes,'')"], keywords);
    const params = [...m.scoreParams, ...m.params];
    let sql = `SELECT id,title,start_at,end_at,location,is_offsite,travel_min,person_id,notes,status,${m.score} AS score FROM events WHERE ${m.where}`;
    if (!include_cancelled) sql += " AND status <> 'cancelled'";
    if (from) { sql += " AND start_at >= ?"; params.push(from + " 00:00:00"); }
    if (to) { sql += " AND start_at <= ?"; params.push(to + " 23:59:59"); }
    sql += " ORDER BY start_at LIMIT 50";
    return q(sql, params);
  });

tool(server, "create_event",
  "Add a calendar appointment. Refuses if an event with a similar title already exists on the same day (returns it) — update that one instead.",
  { title: z.string(), start_at: DATETIME, end_at: DATETIME.optional(), duration_min: z.number().int().optional().describe("used when end_at is missing (default 60)"),
    location: z.string().optional(), is_offsite: z.boolean().optional().describe("true if the user must travel there"),
    travel_min: z.number().int().optional().describe("one-way travel estimate in minutes, if known"), person_id: z.number().int().optional(),
    notes: z.string().optional(), status: z.enum(["confirmed", "tentative"]).optional(), source_text: z.string().optional(), force: z.boolean().optional() },
  async (a) => {
    const start = sqlDT(a.start_at);
    const end = a.end_at ? sqlDT(a.end_at) : addMin(start, a.duration_min ?? 60);
    if (end <= start) throw new Error("end_at must be after start_at");
    if (!a.force) {
      const sameDay = await q("SELECT id,title,start_at,end_at,location FROM events WHERE DATE(start_at)=? AND status<>'cancelled'", [start.slice(0, 10)]);
      // similar title, or overlapping time with a title that is mostly contained in the other
      const dup = sameDay.filter((e) => similarity(a.title, e.title) >= 0.55 || (start < e.end_at && e.start_at < end && overlap(a.title, e.title) >= 0.6));
      if (dup.length) throw new Error(`possible duplicate event on ${start.slice(0, 10)}: ${JSON.stringify(dup.slice(0, 3))}. Use update_event (e.g. to change the time), or force=true if it is a different appointment.`);
    }
    const now = nowSql();
    const r = await q(`INSERT INTO events (title,start_at,end_at,location,is_offsite,travel_min,person_id,notes,status,source_text,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [a.title, start, end, a.location ?? null, a.is_offsite ? 1 : 0, a.travel_min ?? null,
      a.person_id ?? null, a.notes ?? null, a.status ?? "confirmed", a.source_text ?? null, now, now]);
    const conflicts = await q("SELECT id,title,start_at,end_at FROM events WHERE id<>? AND status<>'cancelled' AND start_at < ? AND end_at > ?", [r.insertId, end, start]);
    return { created: "event", id: r.insertId, title: a.title, start_at: start, end_at: end,
      ...(conflicts.length ? { warning: "time clashes with existing appointment(s) — tell the user", conflicts } : {}) };
  });

tool(server, "update_event",
  "Change an event (new time, place, cancel...). When moving the start without giving end_at, the duration is kept.",
  { id: z.number().int(), title: z.string().optional(), start_at: DATETIME.optional(), end_at: DATETIME.optional(), location: z.string().optional(),
    is_offsite: z.boolean().optional(), travel_min: z.number().int().optional(), person_id: z.number().int().optional(), notes: z.string().optional(),
    status: z.enum(["confirmed", "tentative", "cancelled"]).optional() },
  async ({ id, ...f }) => {
    const cur = await one("SELECT * FROM events WHERE id=?", [id]);
    if (!cur) throw new Error(`event ${id} not found`);
    if (f.start_at) {
      f.start_at = sqlDT(f.start_at);
      if (!f.end_at) f.end_at = addMin(f.start_at, (new Date(cur.end_at.replace(" ", "T") + "Z") - new Date(cur.start_at.replace(" ", "T") + "Z")) / 60000);
    }
    if (f.end_at) f.end_at = sqlDT(f.end_at);
    if (f.is_offsite !== undefined) f.is_offsite = f.is_offsite ? 1 : 0;
    const sets = Object.keys(f).filter((k) => f[k] !== undefined);
    if (!sets.length) return { updated: "event", id, fields: [] };
    await q(`UPDATE events SET ${[...sets.map((k) => `${k}=?`), "updated_at=?"].join(",")} WHERE id=?`, [...sets.map((k) => f[k]), nowSql(), id]);
    return { updated: "event", id, fields: sets, ...(await one("SELECT start_at,end_at,status FROM events WHERE id=?", [id])) };
  });

// ---------------- day view & free time ----------------
async function busyBlocks(date) {
  const p = P();
  const evs = await q("SELECT id,title,start_at,end_at,location,is_offsite,travel_min,person_id FROM events WHERE DATE(start_at)=? AND status<>'cancelled' ORDER BY start_at", [date]);
  const busy = [];
  for (const e of evs) {
    const s = minOf(e.start_at), en = minOf(e.end_at) || 24 * 60;
    if (e.is_offsite) {
      const t = e.travel_min ?? p.default_travel_min;
      busy.push({ start: s - t, end: s, kind: "travel", ref_type: "event", ref_id: e.id, title: `เดินทางไป ${e.location || e.title}` });
      busy.push({ start: s, end: en, kind: "event", ref_type: "event", ref_id: e.id, title: e.title });
      busy.push({ start: en, end: en + t, kind: "travel", ref_type: "event", ref_id: e.id, title: `เดินทางกลับจาก ${e.location || e.title}` });
    } else {
      busy.push({ start: s, end: en, kind: "event", ref_type: "event", ref_id: e.id, title: e.title });
    }
  }
  busy.push({ start: toMin(p.lunch_start), end: toMin(p.lunch_end), kind: "break", title: "พักกลางวัน" });
  return { busy: busy.sort((a, b) => a.start - b.start), events: evs };
}

function freeSlots(busy, dayStart, dayEnd, buffer) {
  const slots = [];
  let cur = dayStart;
  for (const b of busy) {
    const bs = b.kind === "break" ? b.start : b.start - buffer;
    if (bs > cur) slots.push([cur, Math.min(bs, dayEnd)]);
    cur = Math.max(cur, b.kind === "break" ? b.end : b.end + buffer);
  }
  if (cur < dayEnd) slots.push([cur, dayEnd]);
  return slots.filter(([s, e]) => e - s >= 15).map(([s, e]) => ({ start: hhmm(s), end: hhmm(e), minutes: e - s }));
}

tool(server, "get_day",
  "Everything for one date: events (with travel/lunch blocks), tasks due that day or overdue, and the computed free slots inside working hours. Call this first when planning a day.",
  { date: DATE },
  async ({ date }) => {
    const p = P();
    const { busy, events } = await busyBlocks(date);
    const tasks = await q(`SELECT id,title,priority,due_date,duration_min,category,location,person_id,last_touched_at FROM tasks
      WHERE status IN ('todo','doing') AND (due_date IS NULL OR due_date <= ?) ORDER BY FIELD(priority,'high','medium','low'), due_date IS NULL, due_date`, [date]);
    const slots = freeSlots(busy, toMin(p.work_start), toMin(p.work_end), p.buffer_min);
    const conflicts = [];
    for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      if (b.start_at < a.end_at && a.start_at < b.end_at) conflicts.push({ a: { id: a.id, title: a.title, time: `${a.start_at.slice(11, 16)}-${a.end_at.slice(11, 16)}` }, b: { id: b.id, title: b.title, time: `${b.start_at.slice(11, 16)}-${b.end_at.slice(11, 16)}` } });
    }
    return {
      date, work_hours: `${p.work_start}-${p.work_end}`, buffer_min: p.buffer_min, conflicts,
      events, busy: busy.map((b) => ({ ...b, start: hhmm(Math.max(0, b.start)), end: hhmm(Math.min(24 * 60, b.end)) })),
      free_slots: slots, free_minutes_total: slots.reduce((s, x) => s + x.minutes, 0),
      open_tasks: tasks.map((t) => ({ ...t, overdue: t.due_date && t.due_date < date })),
    };
  });

tool(server, "save_daily_plan",
  "Save the time-boxed plan for a day. The server checks it: blocks must not overlap each other or any event/travel/lunch, must stay inside working hours (except event/travel blocks), and must reference real items. If it reports problems, fix the plan and call again.",
  { date: DATE, summary: z.string().describe("2-4 sentence morning brief in Thai"),
    blocks: z.array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/),
      kind: z.enum(["event", "travel", "task", "break", "buffer"]), ref_type: z.enum(["event", "task", "none"]), ref_id: z.number().int().nullable(),
      title: z.string(), note: z.string().optional() })),
    context_links: z.array(z.object({ for_type: z.enum(["event", "task"]), for_id: z.number().int(), title: z.string(),
      note_ids: z.array(z.number().int()), person_ids: z.array(z.number().int()), shopping_ids: z.array(z.number().int()), task_ids: z.array(z.number().int()),
      why: z.string().describe("one line: what to remember / bring / prepare") })),
    nudges: z.array(z.object({ task_id: z.number().int(), title: z.string(), days_stale: z.number().int(), message: z.string() })),
    unscheduled: z.array(z.object({ task_id: z.number().int(), reason: z.string() })).optional() },
  async ({ date, summary, blocks, context_links, nudges, unscheduled = [] }) => {
    const p = P();
    const { busy } = await busyBlocks(date);
    const ws = toMin(p.work_start), we = toMin(p.work_end);
    const problems = [];
    const B = blocks.map((b) => ({ ...b, s: toMin(b.start), e: toMin(b.end) })).sort((a, b) => a.s - b.s);
    for (const b of B) {
      if (b.e <= b.s) problems.push(`"${b.title}" ends before it starts`);
      if (["task", "buffer"].includes(b.kind) && (b.s < ws || b.e > we)) problems.push(`"${b.title}" ${b.start}-${b.end} is outside working hours ${p.work_start}-${p.work_end}`);
      if (b.kind === "task") {
        for (const x of busy) {
          if (b.s < x.end && x.start < b.e) problems.push(`task "${b.title}" ${b.start}-${b.end} overlaps ${x.kind} "${x.title}" ${hhmm(Math.max(0, x.start))}-${hhmm(x.end)}`);
        }
        if (b.ref_type !== "task" || !b.ref_id || !(await one("SELECT id FROM tasks WHERE id=? AND status IN ('todo','doing')", [b.ref_id]))) problems.push(`task block "${b.title}" must reference an open task id`);
      }
      if (b.ref_type === "event" && b.ref_id && !(await one("SELECT id FROM events WHERE id=?", [b.ref_id]))) problems.push(`event ${b.ref_id} does not exist`);
    }
    // Fixed appointments may genuinely clash (that's the user's calendar, reported as a conflict elsewhere);
    // what the plan must never do is put work on top of something else.
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (b.s >= a.e) continue;
      const planned = (x) => ["task", "buffer"].includes(x.kind);
      if (planned(a) || planned(b)) problems.push(`"${a.title}" ${a.start}-${a.end} overlaps "${b.title}" ${b.start}-${b.end}`);
    }
    const ids = new Set(B.filter((b) => b.kind === "task").map((b) => b.ref_id));
    for (const u of unscheduled) if (ids.has(u.task_id)) problems.push(`task ${u.task_id} is both scheduled and unscheduled`);
    if (problems.length) throw new Error("plan rejected:\n- " + [...new Set(problems)].join("\n- "));

    await q("DELETE FROM daily_plans WHERE plan_date=?", [date]);
    const r = await q("INSERT INTO daily_plans (plan_date,summary,blocks,context_links,nudges,created_at) VALUES (?,?,?,?,?,?)",
      [date, summary, JSON.stringify(B.map(({ s, e, ...b }) => b)), JSON.stringify(context_links), JSON.stringify({ nudges, unscheduled }), nowSql()]);
    if (nudges.length) await q(`UPDATE tasks SET nudge_count = nudge_count + 1 WHERE id IN (${nudges.map(() => "?").join(",")})`, nudges.map((n) => n.task_id));
    return { saved: true, plan_id: r.insertId, blocks: B.length, scheduled_task_ids: [...ids] };
  });

// ---------------- clarification inbox ----------------
tool(server, "add_clarification",
  "Park a piece of what the user said that is too unclear to act on (unknown person, missing date, two possible meanings). Do NOT guess — store it here with the question to ask.",
  { fragment: z.string(), question: z.string().describe("short question in Thai to ask the user") },
  async ({ fragment, question }) => {
    const open = await q("SELECT id,fragment,question FROM clarifications WHERE status='open'");
    const dup = mostSimilar(fragment, open, "fragment", 0.7);
    if (dup.length) return { exists: true, id: dup[0].id };
    const r = await q("INSERT INTO clarifications (fragment,question,created_at) VALUES (?,?,?)", [fragment, question, nowSql()]);
    return { created: "clarification", id: r.insertId };
  });

tool(server, "list_clarifications", "Open questions waiting for the user.", {},
  async () => q("SELECT id,fragment,question,created_at FROM clarifications WHERE status='open' ORDER BY id"));

tool(server, "resolve_clarification", "Mark a clarification answered (after acting on the answer) or dismissed.",
  { id: z.number().int(), answer: z.string().optional(), dismiss: z.boolean().optional() },
  async ({ id, answer, dismiss }) => {
    await q("UPDATE clarifications SET status=?, answer=?, resolved_at=? WHERE id=?", [dismiss ? "dismissed" : "resolved", answer ?? null, nowSql(), id]);
    return { resolved: id };
  });

await start(server);
