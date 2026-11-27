// personal-crm-mcp — people, relationships, interaction history
import { z } from "zod";
import { createServer, tool, start, nowSql } from "../lib/mcp-helpers.js";
import { q, one } from "../lib/db.js";
import { similarity } from "../lib/text.js";

const server = createServer("personal-crm-mcp");

tool(server, "find_person",
  "Look up people by name or nickname (Thai nicknames like 'พี่เอ', 'น้องบี' — prefixes พี่/น้อง/คุณ are ignored). Returns ALL matches; if more than one matches and context can't tell which, ask the user via add_clarification.",
  { name: z.string() },
  async ({ name }) => {
    const strip = (s) => s.trim().replace(/^(คุณ|พี่|น้อง|ป้า|ลุง|น้า|อา|ไอ้|อี|เจ้า|ดร\.|นาย|นางสาว|นาง|k\.|khun)\s*/i, "").trim().toLowerCase();
    const bare = strip(name);
    if (!bare) return [];
    const all = await q("SELECT id,name,aliases,relationship,company,phone,email,last_contact_at FROM people");
    const forms = (p) => [p.name, ...p.aliases.split(",")].map(strip).filter(Boolean);
    // tiers: name/alias exactly as said (with its พี่/ไอ้/คุณ prefix) → exact nickname/name → first name starts
    // with it → contained / fuzzy. Return only the best tier, so "พี่เอ" finds อรุณี (her alias is "พี่เอ"),
    // "เอก" finds เอกชัย only, while a bare "เอ" (an alias of two people) stays ambiguous.
    const raw = name.trim().toLowerCase().replace(/\s+/g, "");
    const asSaid = all.filter((p) => [p.name, ...p.aliases.split(",")].some((f) => f.trim().toLowerCase().replace(/\s+/g, "") === raw));
    if (asSaid.length) return asSaid;
    const exact = all.filter((p) => forms(p).some((f) => f === bare) || (p.company && strip(p.company) === bare));
    if (exact.length) return exact;
    const prefix = all.filter((p) => forms(p).some((f) => f.startsWith(bare) && bare.length >= 2));
    if (prefix.length) return prefix;
    return all.filter((p) => forms(p).some((f) => (f.length >= 3 && bare.includes(f)) || similarity(bare, f) >= 0.7)
      || (p.company && p.company.toLowerCase().includes(bare)));
  });

tool(server, "get_person", "Profile of a person with their last interactions.",
  { id: z.number().int(), interactions: z.number().int().optional() },
  async ({ id, interactions = 5 }) => {
    const p = await one("SELECT * FROM people WHERE id=?", [id]);
    if (!p) throw new Error(`person ${id} not found`);
    p.recent_interactions = await q("SELECT happened_at,summary FROM interactions WHERE person_id=? ORDER BY happened_at DESC LIMIT ?", [id, interactions]);
    return p;
  });

tool(server, "create_person", "Add a new contact. Refuses if someone with the same/similar name exists (returns them).",
  { name: z.string(), aliases: z.array(z.string()).optional(), relationship: z.string().optional(), company: z.string().optional(),
    phone: z.string().optional(), email: z.string().optional(), notes: z.string().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), force: z.boolean().optional() },
  async (a) => {
    if (!a.force) {
      const all = await q("SELECT id,name,aliases,company FROM people");
      const dup = all.filter((p) => [p.name, ...p.aliases.split(",")].some((x) => similarity(a.name, x) >= 0.8));
      if (dup.length) throw new Error(`person may already exist: ${JSON.stringify(dup)}. Use update_person, or force=true.`);
    }
    const now = nowSql();
    const r = await q("INSERT INTO people (name,aliases,relationship,company,phone,email,notes,birthday,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [a.name, (a.aliases ?? []).join(","), a.relationship ?? null, a.company ?? null, a.phone ?? null, a.email ?? null, a.notes ?? null, a.birthday ?? null, now, now]);
    return { created: "person", id: r.insertId, name: a.name };
  });

tool(server, "update_person", "Update contact details; append_notes adds a line to their notes.",
  { id: z.number().int(), name: z.string().optional(), add_aliases: z.array(z.string()).optional(), relationship: z.string().optional(), company: z.string().optional(),
    phone: z.string().optional(), email: z.string().optional(), append_notes: z.string().optional(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  async ({ id, add_aliases, append_notes, ...f }) => {
    const cur = await one("SELECT * FROM people WHERE id=?", [id]);
    if (!cur) throw new Error(`person ${id} not found`);
    if (add_aliases) f.aliases = [...new Set([...cur.aliases.split(",").filter(Boolean), ...add_aliases])].join(",");
    if (append_notes) f.notes = [cur.notes, append_notes].filter(Boolean).join("\n");
    const sets = Object.keys(f).filter((k) => f[k] !== undefined);
    if (sets.length) await q(`UPDATE people SET ${[...sets.map((k) => `${k}=?`), "updated_at=?"].join(",")} WHERE id=?`, [...sets.map((k) => f[k]), nowSql(), id]);
    return { updated: "person", id, fields: sets };
  });

tool(server, "log_interaction", "Record that the user talked to / met someone, with a one-line summary.",
  { person_id: z.number().int(), summary: z.string(), happened_at: z.string().optional().describe("YYYY-MM-DD HH:MM, default now") },
  async ({ person_id, summary, happened_at }) => {
    const at = happened_at ? (happened_at.length === 16 ? happened_at + ":00" : happened_at) : nowSql();
    const r = await q("INSERT INTO interactions (person_id,happened_at,summary,created_at) VALUES (?,?,?,?)", [person_id, at, summary, nowSql()]);
    await q("UPDATE people SET last_contact_at = GREATEST(COALESCE(last_contact_at,'1970-01-01'), ?) WHERE id=?", [at, person_id]);
    return { created: "interaction", id: r.insertId };
  });

tool(server, "upcoming_birthdays", "People whose birthday falls in the next N days.", { days: z.number().int().optional() },
  async ({ days = 14 }) => q(`SELECT id,name,birthday,relationship FROM people WHERE birthday IS NOT NULL AND
    DATEDIFF(DATE_ADD(birthday, INTERVAL (YEAR(?) - YEAR(birthday) + IF(DATE_FORMAT(?, '%m%d') > DATE_FORMAT(birthday, '%m%d'), 1, 0)) YEAR), DATE(?)) BETWEEN 0 AND ?`,
    [nowSql(), nowSql(), nowSql(), days]));

await start(server);
