// Local LLM via Ollama (http://127.0.0.1:11434). JSON output is constrained with a JSON Schema (`format`),
// temperature 0, thinking off — the settings that make a small local model reliable and fast.
import { loadSettings } from "./config.js";

const cfg = () => loadSettings().ollama;

export async function ollamaUp() {
  try {
    const r = await fetch(`${cfg().url}/api/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

/**
 * Ask the local model for JSON matching `schema`. Retries once with the parse/validation error.
 * @param {{system:string,user:string,schema:object,validate?:(o:any)=>string|null,numPredict?:number}} a
 */
export async function chatJSON({ system, user, schema, validate, numPredict = 2048 }) {
  const c = cfg();
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${c.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(c.timeout_sec * 1000),
      body: JSON.stringify({
        model: c.model, messages, stream: false, format: schema, think: !!c.think,
        keep_alive: c.keep_alive, options: { temperature: 0, num_ctx: c.num_ctx, num_predict: numPredict },
      }),
    }).catch((e) => { throw new Error(`ต่อ Ollama ไม่ได้ (${c.url}) — เปิดโปรแกรม Ollama แล้วหรือยัง: ${e.message}`); });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 404) throw new Error(`ไม่พบโมเดล ${c.model} ใน Ollama — รัน: ollama pull ${c.model}`);
      throw new Error(`Ollama error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.message?.content ?? "";
    const stats = { ms: Date.now() - t0, prompt_tokens: data.prompt_eval_count, output_tokens: data.eval_count };
    let obj;
    try { obj = JSON.parse(text); } catch { lastErr = "output was not valid JSON"; }
    if (obj) {
      const v = validate ? validate(obj) : null;
      if (!v) return { data: obj, stats };
      lastErr = v;
    }
    messages.push({ role: "assistant", content: text }, { role: "user", content: `แก้คำตอบ: ${lastErr}. ตอบ JSON ใหม่ทั้งหมด` });
  }
  throw new Error(`โมเดลในเครื่องตอบไม่ถูกรูปแบบ: ${lastErr}`);
}

/** Embeddings for semantic search (bge-m3 handles Thai well). */
export async function embed(texts) {
  const c = cfg();
  const res = await fetch(`${c.url}/api/embed`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: c.embed_model, input: texts, keep_alive: c.keep_alive }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`embedding error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).embeddings;
}

export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x) * Math.sqrt(y) || 1);
}
