// Entry point for both engines:
//  - provider "claude": Claude drives the MCP tools itself (SDK tool runner, prompts 0–3)
//  - provider "ollama": local workflow — small model for language, code for lookups/dedupe/scheduling (prompts/local)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ROOT, loadSettings } from "../lib/config.js";
import { q, close as closeDb } from "../lib/db.js";
import { connectAll, closeAll } from "../lib/mcp-client.js";
import { dateContext } from "../lib/dates.js";
import { runLocal } from "./local.js";

export { SERVERS } from "../lib/mcp-client.js";
export { dateContext } from "../lib/dates.js";
const prompt = (n) => fs.readFileSync(path.join(ROOT, "prompts", `${n}.md`), "utf8");

/**
 * @param {{mode:'capture'|'brief', text?:string, date?:string, now?:string, dbName?:string}} opts
 */
export async function runAgent(opts) {
  const t0 = Date.now();
  if (opts.dbName) process.env.COS_DB_NAME = opts.dbName; // in-process DB access (run log, embeddings) uses the same DB
  const s = loadSettings();
  const log = [];
  const dc = dateContext(opts.now);
  const date = opts.date || dc.local.slice(0, 10);
  const label = opts.mode === "brief" ? `brief ${date}` : opts.text;
  const engine = s.provider === "claude" ? `claude:${s.model}` : `ollama:${s.ollama.model}`;
  try {
    const r = s.provider === "claude" ? await runClaude(opts, s, log, dc, date) : await runLocal({ ...opts, date }, log);
    const out = { ok: true, mode: opts.mode, engine, ...r, tool_calls: log, duration_ms: Date.now() - t0 };
    await q("INSERT INTO agent_runs (mode,input_text,reply,tool_calls,ok,usage_json,duration_ms,created_at) VALUES (?,?,?,?,1,?,?,?)",
      [opts.mode, label, r.reply, JSON.stringify(log), JSON.stringify({ engine, usage: r.usage ?? null, llm: r.llm_stats ?? null }), out.duration_ms, dc.local]).catch(() => {});
    return out;
  } catch (e0) {
    // some errors (e.g. DOMException from a timeout) have a read-only message, so wrap instead of mutating
    const e = new Error(friendlyError(e0));
    e.friendly = true;
    await q("INSERT INTO agent_runs (mode,input_text,tool_calls,ok,error,usage_json,duration_ms,created_at) VALUES (?,?,?,0,?,?,?,?)",
      [opts.mode, label, JSON.stringify(log), e.message, JSON.stringify({ engine }), Date.now() - t0, dc.local]).catch(() => {});
    e.tool_calls = log;
    throw e;
  }
}

async function runClaude(opts, s, log, dc, date) {
  if (!s.api_key) throw new Error("ยังไม่ได้ตั้งค่า Anthropic API key (หน้า ตั้งค่า) — หรือเปลี่ยนไปใช้ LLM ในเครื่อง");
  const env = {};
  if (opts.dbName) env.COS_DB_NAME = opts.dbName;
  if (opts.now) env.COS_NOW = opts.now;
  const clients = await connectAll(env);
  try {
    const tools = [];
    for (const c of clients) {
      for (const t of c.tools) {
        tools.push(betaTool({
          name: t.name,
          description: `[${c.name}-mcp] ${t.description ?? ""}`,
          inputSchema: { type: "object", ...t.inputSchema },
          run: async (input) => {
            const res = await c.client.callTool({ name: t.name, arguments: input });
            const text = (res.content ?? []).map((x) => x.text ?? "").join("\n");
            log.push({ server: c.name, name: t.name, input, result: text.length > 1500 ? text.slice(0, 1500) + "…" : text, is_error: !!res.isError });
            return text;
          },
        }));
      }
    }
    const system = opts.mode === "brief"
      ? [prompt("0_role"), prompt("2_context_linker"), prompt("3_timebox_nudge")].join("\n\n")
      : [prompt("0_role"), prompt("1_split_dedupe")].join("\n\n");
    const user = opts.mode === "brief"
      ? `${dc.text}\n\nMode: Sync & Brief\nPlan this date: ${date}`
      : `${dc.text}\n\nMode: Capture & Organize\nWhat the user said:\n"""\n${opts.text}\n"""`;

    const client = new Anthropic({ apiKey: s.api_key, maxRetries: 3 });
    const params = {
      model: s.model, max_tokens: 16000, system, tools,
      messages: [{ role: "user", content: user }],
      output_config: { effort: s.effort }, cache_control: { type: "ephemeral" }, max_iterations: 40,
    };
    let final;
    try {
      // On a safety-classifier decline, the API re-runs the request on a fallback model inside the same call.
      final = await client.beta.messages.toolRunner({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) final = await client.beta.messages.toolRunner(params);
      else throw e;
    }
    if (final.stop_reason === "refusal") throw new Error("Claude ปฏิเสธคำขอนี้");
    const reply = final.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return { reply, usage: final.usage, stop_reason: final.stop_reason };
  } finally {
    await closeAll(clients);
  }
}

export async function shutdown() { await closeDb(); }

/** Turn API / connection errors into a short Thai message the user can act on. */
export function friendlyError(e) {
  if (e.friendly) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "API key ไม่ถูกต้อง — ตรวจสอบในหน้าตั้งค่า";
  if (e instanceof Anthropic.PermissionDeniedError) return "API key นี้ไม่มีสิทธิ์ใช้โมเดลที่เลือก — ลองเปลี่ยนโมเดลในหน้าตั้งค่า";
  if (e instanceof Anthropic.RateLimitError) return "เรียก API ถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่";
  if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) return "เครดิต API หมด — เติมเงินที่ console.anthropic.com → Billing หรือเปลี่ยนไปใช้ LLM ในเครื่อง (ตั้งค่า)";
  if (e instanceof Anthropic.APIConnectionError) return "เชื่อมต่อ Anthropic API ไม่ได้ — ตรวจอินเทอร์เน็ต";
  if (e instanceof Anthropic.APIError) return `Claude API ผิดพลาด (${e.status ?? "?"}): ${e.error?.error?.message ?? e.message}`;
  if (e.code === "ECONNREFUSED") return "ต่อฐานข้อมูล MySQL ไม่ได้ — เปิด MySQL ใน XAMPP แล้วหรือยัง";
  if (e.name === "TimeoutError" || e.name === "AbortError") return "LLM ในเครื่องตอบช้าเกินกำหนด (อาจมีงานอื่นใช้การ์ดจออยู่) — ลองใหม่อีกครั้ง";
  return e.message;
}
