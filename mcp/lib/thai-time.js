// Deterministic Thai time-of-day parser. Small models get "4 โมงเย็น" / "สองทุ่ม" wrong now and then,
// so times are read from the user's own words by code. Handles self-corrections: the last time wins.
const NUM = { "หนึ่ง": 1, "เอ็ด": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10, "สิบเอ็ด": 11, "สิบสอง": 12 };
const thaiDigits = (s) => s.replace(/[๐-๙]/g, (d) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)));
const NUMWORD = "(?:\\d{1,2}|สิบเอ็ด|สิบสอง|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)";
const toN = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[w]);
const fmt = (h, m = 0) => (h >= 0 && h < 24 && m >= 0 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);

const RULES = [
  // English: 3pm, 3 pm, 3:30pm, 9 a.m., 12pm (noon), 12am (midnight)
  [/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi, (m) => {
    let h = +m[1]; const pm = /^p/i.test(m[3]);
    if (h > 12) return null;
    if (pm && h < 12) h += 12; else if (!pm && h === 12) h = 0;
    return fmt(h, m[2] ? +m[2] : 0);
  }],
  // 14:30, 14.30 น., 9:00
  // (not a price or quantity: "1.50 บาท", "2.5 กก.")
  [new RegExp(`(?<![\\d.,])(\\d{1,2})[:.](\\d{2})(?![\\d.,]|\\s*(?:บาท|฿|%|กก|กิโล|ลิตร|kg|ml|ซม|เมตร|ชิ้น|ขวด|กล่อง))\\s*(?:น\\.?|นาฬิกา)?`, "g"), (m) => fmt(+m[1], +m[2])],
  // เที่ยงคืน / เที่ยงครึ่ง / เที่ยง
  [/เที่ยงคืน/g, () => "00:00"],
  [/เที่ยง(?:วัน)?(ครึ่ง)?/g, (m) => fmt(12, m[1] ? 30 : 0)],
  // บ่ายโมง / บ่าย 3 (โมง) (ครึ่ง)
  [new RegExp(`บ่าย\\s*(${NUMWORD})?\\s*(?:โมง)?\\s*(ครึ่ง)?`, "g"), (m) => fmt(12 + (m[1] ? toN(m[1]) : 1), m[2] ? 30 : 0)],
  // 1 ทุ่ม / สองทุ่มครึ่ง / ทุ่ม
  [new RegExp(`(${NUMWORD})?\\s*ทุ่ม\\s*(ครึ่ง)?`, "g"), (m) => fmt(18 + (m[1] ? toN(m[1]) : 1), m[2] ? 30 : 0)],
  // ตี 5
  [new RegExp(`ตี\\s*(${NUMWORD})\\s*(ครึ่ง)?`, "g"), (m) => fmt(toN(m[1]) % 24, m[2] ? 30 : 0)],
  // 4 โมงเย็น / 10 โมงเช้า / 10 โมง (ครึ่ง)
  [new RegExp(`(${NUMWORD})\\s*โมง\\s*(เช้า|เย็น)?\\s*(ครึ่ง)?`, "g"), (m) => {
    let h = toN(m[1]);
    if (m[2] === "เย็น" && h < 12) h += 12;
    else if (!m[2] && h >= 1 && h <= 6) h += 12;   // "4 โมง" in everyday Thai means 16:00
    return fmt(h, m[3] ? 30 : 0);
  }],
];

const CORRECTION = /(เอ้ย|เอ๊ย|ไม่ใช่|ไม่สิ|ไม่ๆ|เปลี่ยนเป็น|เลื่อนเป็น|ดีกว่า|แก้เป็น|ขอแก้)/;

/**
 * Returns {start, end} ("HH:MM" or null) read from a Thai phrase.
 * `hint` is the model's own reading. When the phrase holds several times for different items (the model sometimes
 * passes the whole message as an item's source) and the user did not correct themselves, the hint picks which one.
 */
export function parseThaiTimes(text, hint = "") {
  if (!text) return { start: null, end: null };
  const s = thaiDigits(text);
  const hits = [];
  const taken = [];
  for (const [re, f] of RULES) {
    for (const m of s.matchAll(re)) {
      const a = m.index, b = m.index + m[0].length;
      if (taken.some(([x, y]) => a < y && x < b)) continue;   // first (more specific) rule wins a span
      const t = f(m);
      if (t) { hits.push({ at: a, t }); taken.push([a, b]); }
    }
  }
  hits.sort((x, y) => x.at - y.at);
  if (!hits.length) return { start: null, end: null };
  if (CORRECTION.test(s)) return { start: hits[hits.length - 1].t, end: null };
  if (hits.length >= 2 && /(ถึง|จน|-|–)/.test(s.slice(hits[0].at, hits[1].at + 1))) return { start: hits[0].t, end: hits[1].t };
  const h = /^\d{1,2}:\d{2}$/.test(hint || "") ? hint.padStart(5, "0") : "";
  if (hits.length >= 2 && h && hits.some((x) => x.t === h)) return { start: h, end: null };
  return { start: hits[0].t, end: null };
}
