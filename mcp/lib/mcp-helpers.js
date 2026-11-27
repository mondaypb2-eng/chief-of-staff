import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export function createServer(name) {
  return new McpServer({ name, version: "1.0.0" });
}

/** Register a tool whose handler returns plain JS data; errors become isError results the model can read. */
export function tool(server, name, description, inputSchema, fn) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const data = await fn(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `ERROR: ${e.message}` }] };
    }
  });
}

export async function start(server) {
  await server.connect(new StdioServerTransport());
}

export const nowSql = () => {
  // "now" can be pinned for evals so dates like "พรุ่งนี้" are reproducible
  const d = process.env.COS_NOW ? new Date(process.env.COS_NOW) : new Date();
  return toSqlDateTime(d);
};

export function toSqlDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  // Asia/Bangkok, no DST
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}
