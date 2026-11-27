// CLI bridge used by PHP: reads {mode,text,date} JSON on stdin, prints a JSON result on stdout.
import { runAgent, shutdown, friendlyError } from "./agent.js";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let out;
try {
  const req = JSON.parse(input.replace(/^﻿/, "") || "{}");
  if (!["capture", "brief"].includes(req.mode)) throw new Error("mode must be capture or brief");
  if (req.mode === "capture" && !String(req.text || "").trim()) throw new Error("ไม่มีข้อความ");
  out = await runAgent(req);
} catch (e) {
  out = { ok: false, error: e.friendly ? e.message : friendlyError(e), tool_calls: e.tool_calls ?? [] };
}
await shutdown();
process.stdout.write(JSON.stringify(out));
process.exit(0);
