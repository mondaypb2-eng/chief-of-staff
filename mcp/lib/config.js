// Shared config for MCP servers and the agent. Settings are written by the PHP settings page.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
export const SETTINGS_FILE = path.join(ROOT, "storage", "settings.json");

export const DEFAULTS = {
  provider: "ollama",          // "ollama" (local, free) | "claude" (Anthropic API)
  ollama: {
    url: "http://127.0.0.1:11434",
    model: "qwen3:4b",
    embed_model: "bge-m3",
    num_ctx: 8192,
    think: false,
    keep_alive: "30m",
    timeout_sec: 600,          // Ollama queues requests; leave room if another app is using the GPU
  },
  api_key: "",
  model: "claude-opus-5-5",
  effort: "medium",
  db: { host: "127.0.0.1", port: 3307, user: "root", password: "", database: "chief_of_staff" },
  profile: {
    name: "",
    timezone: "Asia/Bangkok",
    work_start: "09:00",
    work_end: "18:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    default_travel_min: 30,   // one-way, used when an off-site event has no estimate
    buffer_min: 10,           // gap kept between blocks
    stale_days: 5,            // a todo untouched this long gets a nudge
    home: "บ้าน",
    office: "ออฟฟิศ",
  },
};

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { /* first run */ }
  const s = { ...DEFAULTS, ...saved, db: { ...DEFAULTS.db, ...(saved.db || {}) }, profile: { ...DEFAULTS.profile, ...(saved.profile || {}) },
    ollama: { ...DEFAULTS.ollama, ...(saved.ollama || {}) } };
  if (process.env.COS_PROVIDER) s.provider = process.env.COS_PROVIDER;
  if (process.env.COS_DB_NAME) s.db.database = process.env.COS_DB_NAME; // eval uses its own database
  if (!s.api_key && process.env.ANTHROPIC_API_KEY) s.api_key = process.env.ANTHROPIC_API_KEY;
  return s;
}
