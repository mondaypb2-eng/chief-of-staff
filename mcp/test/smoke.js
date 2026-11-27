// Calls every MCP server directly over stdio (no Claude) to check tools and server-side guards.
// Usage: node test/smoke.js   (uses database chief_of_staff_smoke, reset each run)
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "../lib/config.js";
import { setupDb } from "../setup.js";
import { SERVERS } from "../lib/mcp-client.js";

const NOW = "2026-11-25T08:00:00+07:00";
const DB = "chief_of_staff_smoke";
await setupDb({ dbName: DB, reset: true, seed: true, now: NOW });

const c = {};
for (const name of SERVERS) {
  const t = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "mcp", "servers", `${name}.js`)],
    env: { ...getDefaultEnvironment(), COS_DB_NAME: DB, COS_NOW: NOW }, stderr: "inherit" });
  c[name] = new Client({ name: "smoke", version: "1" });
  await c[name].connect(t);
  const { tools } = await c[name].listTools();
  console.log(`${name}: ${tools.length} tools — ${tools.map((x) => x.name).join(", ")}`);
}
let fails = 0;
const call = async (srv, name, args) => {
  const r = await c[srv].callTool({ name, arguments: args });
  const text = r.content.map((x) => x.text).join("");
  return { err: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
};
const check = (label, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "  — " + detail : ""}`); if (!ok) fails++; };

// task-calendar
const day = await call("task-calendar", "get_day", { date: "2026-11-26" });
check("get_day returns events", day.data.events.length === 3, `${day.data.events.length} events`);
check("travel blocks around off-site ABC meeting", day.data.busy.some((b) => b.kind === "travel" && b.start === "09:20" && b.end === "10:00"), JSON.stringify(day.data.busy.filter((b) => b.kind === "travel").map((b) => b.start + "-" + b.end)));
check("free slots exclude busy time", !day.data.free_slots.some((s) => s.start < "12:10" && s.end > "10:00"), JSON.stringify(day.data.free_slots));
const dupEv = await call("task-calendar", "create_event", { title: "ประชุมคุณสมชาย ABC", start_at: "2026-11-26 10:00" });
check("create_event refuses same-day duplicate", dupEv.err && /duplicate/.test(dupEv.text));
const newEv = await call("task-calendar", "create_event", { title: "นัดหมอฟัน", start_at: "2026-11-26 16:00", location: "คลินิกทันตกรรมสุขุมวิท", is_offsite: true });
check("create_event new", !newEv.err && newEv.data.end_at === "2026-11-26 17:00:00", newEv.text);
const mv = await call("task-calendar", "update_event", { id: newEv.data.id, start_at: "2026-11-26 15:00" });
check("update_event keeps duration", mv.data.end_at === "2026-11-26 16:00:00", mv.text);
const dupTask = await call("task-calendar", "create_task", { title: "อ่านร่างสัญญา ABC" });
check("create_task refuses duplicate", dupTask.err && /duplicate/.test(dupTask.text));
const stale = await call("task-calendar", "get_stale_tasks", {});
check("stale tasks (>=5 days)", stale.data.map((t) => t.title).join("|") === "ต่อภาษีรถยนต์|จองโต๊ะร้านอาหารวันเกิดแม่", stale.data.map((t) => `${t.title}:${t.days_stale}`).join(", "));
const badPlan = await call("task-calendar", "save_daily_plan", { date: "2026-11-26", summary: "x", context_links: [], nudges: [],
  blocks: [{ start: "10:30", end: "11:30", kind: "task", ref_type: "task", ref_id: 1, title: "อ่านสัญญา" }] });
check("save_daily_plan rejects task during meeting", badPlan.err && /overlaps/.test(badPlan.text));
const goodPlan = await call("task-calendar", "save_daily_plan", { date: "2026-11-26", summary: "ok", context_links: [], nudges: [],
  blocks: [{ start: "08:00", end: "09:00", kind: "task", ref_type: "task", ref_id: 1, title: "อ่านสัญญา" }] });
check("save_daily_plan rejects task outside work hours", goodPlan.err && /outside working hours/.test(goodPlan.text));
const okPlan = await call("task-calendar", "save_daily_plan", { date: "2026-11-26", summary: "ok", context_links: [], nudges: [],
  blocks: [{ start: "09:00", end: "09:20", kind: "task", ref_type: "task", ref_id: 5, title: "จองโต๊ะ" }, { start: "09:20", end: "10:00", kind: "travel", ref_type: "event", ref_id: 1, title: "เดินทาง" }] });
check("save_daily_plan accepts valid plan", !okPlan.err, okPlan.text);
const cl = await call("task-calendar", "add_clarification", { fragment: "โทรหาเอเรื่องนั้น", question: "เอ คนไหน?" });
const cl2 = await call("task-calendar", "add_clarification", { fragment: "โทรหาเอ เรื่องนั้น", question: "?" });
check("clarification dedupe", cl2.data.exists === true && cl2.data.id === cl.data.id);

// notes
const ns = await call("knowledge-notes", "search_notes", { keywords: ["ABC", "สัญญา"] });
check("search_notes ranks ABC contract first", ns.data[0]?.title.startsWith("ABC: เงื่อนไข"), ns.data.map((n) => n.title).join(" | "));
check("search_notes excludes unrelated", !ns.data.some((n) => /ต้มยำ|หนังสือ/.test(n.title)));
const dn = await call("knowledge-notes", "create_note", { title: "ABC: เงื่อนไขต่อสัญญา 2027", body: "dup" });
check("create_note refuses duplicate", dn.err);

// crm
const fe = await call("personal-crm", "find_person", { name: "เอ" });
check("find_person 'เอ' is ambiguous (2 people)", fe.data.length === 2, fe.data.map((p) => p.name).join(", "));
const fpa = await call("personal-crm", "find_person", { name: "พี่เอ" });
check("find_person 'พี่เอ' = อรุณี only (her alias as said)", fpa.data.length === 1 && fpa.data[0].id === 2, fpa.data.map((p) => p.name).join(", "));
const gp = await call("personal-crm", "get_person", { id: 1 });
check("get_person has interactions", gp.data.recent_interactions.length === 1);
const bd = await call("personal-crm", "upcoming_birthdays", { days: 7 });
check("upcoming birthday (แม่ in 5 days)", bd.data.length === 1, JSON.stringify(bd.data));

// shopping
const add = await call("shopping-inventory", "add_shopping_items", { items: [{ name: "นมจืด", qty: 3 }, { name: "ไข่ไก่", qty: 10, unit: "ฟอง" }] });
check("add_shopping merges existing milk, creates eggs", add.data[0].merged === true && add.data[1].created === true, add.text);
const low = await call("shopping-inventory", "low_stock", {});
check("low_stock skips items already on list", low.data.map((x) => x.name).join(",") === "กาแฟคั่วบด", low.text);

for (const k in c) await c[k].close();
console.log(fails ? `\n${fails} FAILED` : "\nall smoke checks passed");
process.exit(fails ? 1 : 0);
