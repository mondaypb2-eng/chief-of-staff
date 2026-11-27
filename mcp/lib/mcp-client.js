// Connects to the 4 MCP servers over stdio; used by both the Claude agent and the local workflow.
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "./config.js";

export const SERVERS = ["task-calendar", "knowledge-notes", "personal-crm", "shopping-inventory"];

export async function connectAll(env = {}) {
  const clients = [];
  for (const name of SERVERS) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "mcp", "servers", `${name}.js`)],
      env: { ...getDefaultEnvironment(), ...env },
      stderr: "pipe",
    });
    const client = new Client({ name: "chief-of-staff", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    clients.push({ name, client, tools });
  }
  return clients;
}

/** Simple caller for code-driven workflows: call(tool, args) → {ok, data, error}; every call is logged. */
export function makeCaller(clients, log) {
  const byTool = new Map();
  for (const c of clients) for (const t of c.tools) byTool.set(t.name, c);
  return async (name, args = {}) => {
    const c = byTool.get(name);
    if (!c) throw new Error(`unknown MCP tool ${name}`);
    const res = await c.client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map((x) => x.text ?? "").join("\n");
    log.push({ server: c.name, name, input: args, result: text.length > 1500 ? text.slice(0, 1500) + "…" : text, is_error: !!res.isError });
    if (res.isError) return { ok: false, error: text };
    try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: text }; }
  };
}

export async function closeAll(clients) {
  for (const c of clients) await c.client.close().catch(() => {});
}
