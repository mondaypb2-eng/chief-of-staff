// Deterministic day parser (Thai + English). A 4B model leaves the date empty for "วันจันทร์หน้า" / "tomorrow"
// now and then, so the day is read from the user's own words by code, using the same date table the model sees.
// Like thai-time.js: on a self-correction ("พรุ่งนี้ เอ้ย มะรืน") the last day said wins.
const TH = { "จันทร์": 1, "อังคาร": 2, "พุธ": 3, "พฤหัสบดี": 4, "พฤหัส": 4, "ศุกร์": 5, "เสาร์": 6, "อาทิตย์": 0 };
const EN = { monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0 };
const CORRECTION = /(เอ้ย|เอ๊ย|ไม่ใช่|ไม่สิ|ไม่ๆ|เปลี่ยนเป็น|เลื่อนเป็น|ดีกว่า|แก้เป็น|ขอแก้)/;

/**
 * @param {string} text  the user's words for this item
 * @param {{dates:{date:string,week:string}[], today:string}} dc  date table from dateContext()
 * @param {string} hint  the model's date, used to choose when the text names several days for different items
 * @returns {string|null} YYYY-MM-DD
 */
export function parseThaiDate(text, dc, hint = "") {
  if (!text) return null;
  const s = text.toLowerCase();
  const future = dc.dates.filter((d) => d.date > dc.today);
  const wd = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  const offset = (n) => dc.dates.find((d) => d.date === addDays(dc.today, n))?.date ?? null;
  const weekday = (n, which) => {
    if (which === "next") return future.find((d) => wd(d.date) === n && d.week === "สัปดาห์หน้า")?.date ?? null;
    return future.find((d) => wd(d.date) === n)?.date ?? null;     // "this" / bare: the next one coming up
  };
  const hits = [];
  const add = (at, date) => { if (date) hits.push({ at, date }); };
  for (const m of s.matchAll(/วันนี้|today|tonight|คืนนี้/g)) add(m.index, dc.today);
  for (const m of s.matchAll(/มะรืน(?:นี้)?|day after tomorrow/g)) add(m.index, offset(2));
  for (const m of s.matchAll(/พรุ่งนี้|tomorrow/g)) if (!/day after $/.test(s.slice(0, m.index))) add(m.index, offset(1));
  // Thai weekday: needs "วัน" in front, or นี้/หน้า after (bare "อาทิตย์หน้า" means "next week", so Sunday needs "วัน")
  for (const m of s.matchAll(/(วัน)?(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)\s*(นี้|หน้า)?/g)) {
    if (!m[1] && !m[3]) continue;
    if (m[2] === "อาทิตย์" && !m[1]) continue;
    add(m.index, weekday(TH[m[2]], m[3] === "หน้า" ? "next" : "this"));
  }
  for (const m of s.matchAll(/\b(next|this|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thurs?|fri|sat|sun)\b/g)) {
    if (m[2].length <= 4 && !m[1]) continue;            // "sat"/"sun" alone are too often other words
    add(m.index, weekday(EN[m[2]], m[1] === "next" ? "next" : "this"));
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.at - b.at);
  if (CORRECTION.test(s)) return hits[hits.length - 1].date;
  if (hits.length > 1 && hint && hits.some((h) => h.date === hint)) return hint;
  return hits[0].date;
}

function addDays(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
