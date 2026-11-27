// Create the database, apply the schema, and (optionally) load demo data relative to a given "now".
// Usage: node setup.js [--db chief_of_staff] [--reset] [--seed] [--now 2026-11-25T08:00:00+07:00]
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { ROOT, loadSettings } from "./lib/config.js";
import { toSqlDateTime } from "./lib/mcp-helpers.js";

export async function setupDb({ dbName, reset = false, seed = false, now } = {}) {
  const { db } = loadSettings();
  const name = dbName || db.database;
  if (!/^\w+$/.test(name)) throw new Error("bad db name");
  const conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, multipleStatements: true, charset: "utf8mb4" });
  if (reset) await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${name}\``);
  await conn.query(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  if (seed) await seedDemo(conn, now);
  await conn.end();
  return name;
}

export async function seedDemo(conn, nowIso) {
  const now = toSqlDateTime(nowIso ? new Date(nowIso) : new Date());
  const day = (offset, time = "00:00") => {
    const d = new Date(now.slice(0, 10) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset);
    return `${d.toISOString().slice(0, 10)} ${time}:00`;
  };
  const date = (o) => day(o).slice(0, 10);
  const ins = async (table, rows) => {
    for (const r of rows) {
      const k = Object.keys(r);
      await conn.query(`INSERT INTO ${table} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`, k.map((x) => r[x]));
    }
  };
  for (const t of ["tasks", "events", "notes", "people", "interactions", "shopping_items", "inventory", "clarifications", "daily_plans", "agent_runs", "note_embeddings"]) {
    await conn.query(`DELETE FROM ${t}`); await conn.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);
  }

  await ins("people", [
    { name: "สมชาย ใจดี", aliases: "คุณสมชาย,สมชาย", relationship: "ลูกค้า (ผู้จัดการจัดซื้อ)", company: "บริษัท ABC จำกัด", phone: "081-555-0101", notes: "ชอบให้สรุปตัวเลขสั้นๆ ก่อนลงรายละเอียด", last_contact_at: day(-15, "15:00"), created_at: day(-60), updated_at: day(-15) },
    { name: "อรุณี ศรีสุข", aliases: "พี่เอ,เอ", relationship: "หัวหน้า", company: "บริษัทเรา", phone: "081-555-0102", created_at: day(-60), updated_at: day(-60) },
    { name: "เอกชัย มั่นคง", aliases: "เอ,ไอ้เอ,เอก", relationship: "เพื่อนสมัยมหาวิทยาลัย", phone: "081-555-0103", created_at: day(-60), updated_at: day(-60) },
    { name: "มาลี (แม่)", aliases: "แม่", relationship: "แม่", birthday: "1965-" + date(5).slice(5), created_at: day(-60), updated_at: day(-60) },
    { name: "ทพ.วิชัย", aliases: "หมอวิชัย,หมอฟัน", relationship: "ทันตแพทย์", company: "คลินิกทันตกรรมสุขุมวิท", created_at: day(-60), updated_at: day(-60) },
  ]);
  await ins("interactions", [
    { person_id: 1, happened_at: day(-15, "15:00"), summary: "คุยเรื่องต่อสัญญาปี 2027 — ABC ขอส่วนลด 10% ถ้าเซ็น 2 ปี ยังไม่ตกลง รับปากว่าจะส่งตัวเลขใหม่ก่อนประชุมรอบหน้า", created_at: day(-15) },
    { person_id: 2, happened_at: day(-3, "16:30"), summary: "1:1 — พี่เอให้เตรียมแผนแคมเปญปีใหม่คร่าวๆ", created_at: day(-3) },
  ]);
  await ins("notes", [
    { title: "ABC: เงื่อนไขต่อสัญญา 2027", body: "ABC ขอส่วนลด 10% ถ้าเซ็น 2 ปี\nเพดานที่เราให้ได้: 7% (อนุมัติแล้วโดยพี่เอ)\nต้องตอบภายใน " + date(5), tags: "ABC,สัญญา,ลูกค้า,contract", person_id: 1, created_at: day(-14), updated_at: day(-14) },
    { title: "ABC: ปัญหาส่งของล่าช้า ต.ค.", body: "ล็อตเดือน ต.ค. ส่งช้า 3 วัน ลูกค้าบ่น ต้องยืนยันว่าแก้แล้ว (เปลี่ยนขนส่ง)", tags: "ABC,ขนส่ง,ลูกค้า", person_id: 1, created_at: day(-20), updated_at: day(-20) },
    { title: "ไอเดียแคมเปญปีใหม่", body: "ทำ bundle ของขวัญ + ส่วนลดลูกค้าเก่า, ลอง TikTok live", tags: "marketing,ไอเดีย,ปีใหม่", person_id: null, created_at: day(-3), updated_at: day(-3) },
    { title: "ของขวัญวันเกิดแม่", body: "แม่อยากได้ผ้าพันคอไหมสีฟ้า และชอบเค้กมะพร้าวร้านประจำแถวอารีย์", tags: "แม่,วันเกิด,ของขวัญ", person_id: 4, created_at: day(-10), updated_at: day(-10) },
    { title: "สูตรต้มยำของแม่", body: "ข่า ตะไคร้ ใบมะกรูด พริกเผา น้ำปลา มะนาว", tags: "อาหาร,สูตร", person_id: 4, created_at: day(-40), updated_at: day(-40) },
    { title: "หนังสือที่อยากอ่าน", body: "Atomic Habits, Deep Work", tags: "หนังสือ", person_id: null, created_at: day(-30), updated_at: day(-30) },
    { title: "ร้านกาแฟแถวสาทรที่ชอบ", body: "ร้านเล็กๆ ซอยสาทร 10 กาแฟดี เงียบ นั่งทำงานได้", tags: "กาแฟ,สาทร", person_id: null, created_at: day(-25), updated_at: day(-25) },
  ]);
  await ins("tasks", [
    { title: "อ่านร่างสัญญา ABC ฉบับใหม่", category: "work", priority: "high", due_date: date(1), duration_min: 60, person_id: 1, created_at: day(-2), updated_at: day(-2), last_touched_at: day(-2) },
    { title: "ทำสไลด์ข้อเสนอราคาใหม่ให้ ABC", category: "work", priority: "high", due_date: date(1), duration_min: 90, person_id: 1, created_at: day(-2), updated_at: day(-2), last_touched_at: day(-2) },
    { title: "ส่งรายงานค่าใช้จ่ายประจำเดือน", category: "work", priority: "medium", due_date: date(2), duration_min: 45, created_at: day(-4), updated_at: day(-4), last_touched_at: day(-4) },
    { title: "ร่างแผนแคมเปญปีใหม่ให้พี่เอ", category: "work", priority: "medium", due_date: date(4), duration_min: 60, person_id: 2, created_at: day(-3), updated_at: day(-3), last_touched_at: day(-3) },
    { title: "จองโต๊ะร้านอาหารวันเกิดแม่", category: "personal", priority: "medium", due_date: date(3), duration_min: 15, person_id: 4, created_at: day(-9), updated_at: day(-9), last_touched_at: day(-9) },
    { title: "ต่อภาษีรถยนต์", category: "errand", priority: "low", due_date: null, duration_min: 30, created_at: day(-20), updated_at: day(-20), last_touched_at: day(-20) },
  ]);
  await ins("events", [
    { title: "ประชุมกับคุณสมชาย บริษัท ABC เรื่องต่อสัญญา", start_at: day(1, "10:00"), end_at: day(1, "11:30"), location: "ABC สำนักงานสาทร", is_offsite: 1, travel_min: 40, person_id: 1, created_at: day(-7), updated_at: day(-7) },
    { title: "Weekly team meeting", start_at: day(1, "14:00"), end_at: day(1, "15:00"), location: "ห้องประชุม 3", is_offsite: 0, created_at: day(-30), updated_at: day(-30) },
    { title: "1:1 กับพี่เอ", start_at: day(1, "16:30"), end_at: day(1, "17:00"), location: "ออฟฟิศ", is_offsite: 0, person_id: 2, created_at: day(-30), updated_at: day(-30) },
    { title: "Weekly team meeting", start_at: day(0, "14:00"), end_at: day(0, "15:00"), location: "ห้องประชุม 3", is_offsite: 0, created_at: day(-30), updated_at: day(-30) },
    { title: "กินข้าววันเกิดแม่", start_at: day(5, "18:00"), end_at: day(5, "21:00"), location: "บ้านแม่ อารีย์", is_offsite: 1, travel_min: 45, person_id: 4, created_at: day(-10), updated_at: day(-10) },
  ]);
  await ins("shopping_items", [
    { name: "นมจืด", qty: 2, unit: "กล่อง", store: "ซูเปอร์", status: "needed", created_at: day(-1), updated_at: day(-1) },
    { name: "ผ้าพันคอไหมสีฟ้า", qty: 1, unit: "ผืน", needed_for: "วันเกิดแม่", status: "needed", created_at: day(-10), updated_at: day(-10) },
  ]);
  await ins("inventory", [
    { name: "ไข่ไก่", qty: 2, unit: "ฟอง", location: "ตู้เย็น", low_threshold: 4 },
    { name: "กาแฟคั่วบด", qty: 1, unit: "ถุง", location: "ครัว", low_threshold: 1 },
    { name: "น้ำดื่ม", qty: 12, unit: "ขวด", location: "ครัว", low_threshold: 6 },
  ]);
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("setup.js")) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
  const name = await setupDb({ dbName: arg("--db"), reset: process.argv.includes("--reset"), seed: process.argv.includes("--seed"), now: arg("--now") });
  console.log(`database ${name} ready${process.argv.includes("--seed") ? " (demo data loaded)" : ""}`);
}
