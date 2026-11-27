import { toSqlDateTime } from "./mcp-helpers.js";

const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Date table so the model never does calendar arithmetic itself. */
export function dateContext(nowIso) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const local = toSqlDateTime(now);
  const base = new Date(local.slice(0, 10) + "T00:00:00Z");
  const dates = [];
  const daysToNextMonday = ((8 - base.getUTCDay()) % 7) || 7;
  for (let i = -1; i <= 13; i++) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const rel = i === -1 ? "เมื่อวาน" : i === 0 ? "วันนี้" : i === 1 ? "พรุ่งนี้" : i === 2 ? "มะรืน" : "";
    const week = i <= 0 ? "" : i < daysToNextMonday ? "สัปดาห์นี้" : i < daysToNextMonday + 7 ? "สัปดาห์หน้า" : "อีก 2 สัปดาห์";
    dates.push({ date: iso, en: EN_DAYS[d.getUTCDay()], th: `วัน${TH_DAYS[d.getUTCDay()]}`, rel, week });
  }
  const lines = dates.map((d) => `${d.date} ${d.en} (${d.th})${d.rel ? " ← " + d.rel : ""}${d.week && !d.rel ? " [" + d.week + "]" : ""}`);
  return { local, dates, today: local.slice(0, 10), text: `Now: ${local} Asia/Bangkok (วัน${TH_DAYS[base.getUTCDay()]})\nDates:\n${lines.join("\n")}` };
}

export const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export function addDays(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
