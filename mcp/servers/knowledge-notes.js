// knowledge-notes-mcp — ideas, meeting notes, reference info
import { z } from "zod";
import { createServer, tool, start, nowSql } from "../lib/mcp-helpers.js";
import { q, one, keywordMatch } from "../lib/db.js";
import { mostSimilar } from "../lib/text.js";

const server = createServer("knowledge-notes-mcp");

tool(server, "search_notes",
  "Search notes by keywords (any match in title, body or tags); best matches first. Give several short keywords, including synonyms and English/Thai variants, e.g. ['ABC','เอบีซี','สัญญา'].",
  { keywords: z.array(z.string()), person_id: z.number().int().optional(), limit: z.number().int().optional() },
  async ({ keywords, person_id, limit = 8 }) => {
    const m = keywordMatch(["title", "body", "tags"], keywords);
    let where = m.where; const params = [...m.scoreParams, ...m.params];
    if (person_id) { where = `(${where} OR person_id = ?)`; params.push(person_id); }
    const rows = await q(`SELECT id,title,LEFT(body,220) AS snippet,tags,person_id,updated_at,${m.score} AS score FROM notes WHERE ${where} ORDER BY score DESC, updated_at DESC LIMIT ?`, [...params, limit]);
    return rows;
  });

tool(server, "get_note", "Full text of one note.", { id: z.number().int() },
  async ({ id }) => (await one("SELECT * FROM notes WHERE id=?", [id])) ?? { error: "not found" });

tool(server, "create_note",
  "Save an idea / information to remember. Refuses if a note with a very similar title exists — append to it with update_note instead (or force=true).",
  { title: z.string(), body: z.string(), tags: z.array(z.string()).optional(), person_id: z.number().int().optional(), force: z.boolean().optional() },
  async ({ title, body, tags = [], person_id, force }) => {
    if (!force) {
      const dup = mostSimilar(title, await q("SELECT id,title FROM notes"), "title", 0.7);
      if (dup.length) throw new Error(`similar note exists: ${JSON.stringify(dup.slice(0, 3))}. Use update_note with append, or force=true.`);
    }
    const now = nowSql();
    const r = await q("INSERT INTO notes (title,body,tags,person_id,created_at,updated_at) VALUES (?,?,?,?,?,?)", [title, body, tags.join(","), person_id ?? null, now, now]);
    return { created: "note", id: r.insertId, title };
  });

tool(server, "update_note", "Edit a note. Use append to add a new line of information without losing the old text.",
  { id: z.number().int(), title: z.string().optional(), body: z.string().optional(), append: z.string().optional(), tags: z.array(z.string()).optional() },
  async ({ id, title, body, append, tags }) => {
    const cur = await one("SELECT * FROM notes WHERE id=?", [id]);
    if (!cur) throw new Error(`note ${id} not found`);
    const nb = append ? `${body ?? cur.body}\n- ${append}` : body ?? cur.body;
    const nt = tags ? [...new Set([...cur.tags.split(",").filter(Boolean), ...tags])].join(",") : cur.tags;
    await q("UPDATE notes SET title=?, body=?, tags=?, updated_at=? WHERE id=?", [title ?? cur.title, nb, nt, nowSql(), id]);
    return { updated: "note", id };
  });

await start(server);
