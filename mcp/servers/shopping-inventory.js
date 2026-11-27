// shopping-inventory-mcp — shopping list and what's at home
import { z } from "zod";
import { createServer, tool, start, nowSql } from "../lib/mcp-helpers.js";
import { q, one, keywordMatch } from "../lib/db.js";
import { similarity } from "../lib/text.js";

const server = createServer("shopping-inventory-mcp");

tool(server, "list_shopping", "Shopping list items (default: still needed). Keywords filter by name / needed_for / store.",
  { status: z.enum(["needed", "bought", "cancelled", "any"]).optional(), keywords: z.array(z.string()).optional() },
  async ({ status = "needed", keywords }) => {
    const m = keywordMatch(["name", "COALESCE(needed_for,'')", "COALESCE(store,'')"], keywords);
    const params = [...m.params];
    let sql = `SELECT id,name,qty,unit,store,needed_for,status,created_at FROM shopping_items WHERE ${m.where}`;
    if (status !== "any") { sql += " AND status=?"; params.push(status); }
    return q(sql + " ORDER BY created_at", params);
  });

tool(server, "add_shopping_items",
  "Add things to buy. An item already on the list (same/similar name, still needed) is merged instead of duplicated — the result says which were merged.",
  { items: z.array(z.object({ name: z.string(), qty: z.number().optional(), unit: z.string().optional(), store: z.string().optional(), needed_for: z.string().optional() })) },
  async ({ items }) => {
    const existing = await q("SELECT id,name,qty,unit,needed_for FROM shopping_items WHERE status='needed'");
    const out = [];
    for (const it of items) {
      const match = existing.find((e) => similarity(e.name, it.name) >= 0.8);
      if (match) {
        const qty = it.qty != null ? it.qty : match.qty;
        const nf = [match.needed_for, it.needed_for].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("; ") || null;
        await q("UPDATE shopping_items SET qty=?, unit=COALESCE(?,unit), store=COALESCE(?,store), needed_for=?, updated_at=? WHERE id=?",
          [qty, it.unit ?? null, it.store ?? null, nf, nowSql(), match.id]);
        out.push({ merged: true, id: match.id, name: match.name });
      } else {
        const now = nowSql();
        const r = await q("INSERT INTO shopping_items (name,qty,unit,store,needed_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
          [it.name, it.qty ?? null, it.unit ?? null, it.store ?? null, it.needed_for ?? null, now, now]);
        existing.push({ id: r.insertId, name: it.name });
        out.push({ created: true, id: r.insertId, name: it.name });
      }
    }
    return out;
  });

tool(server, "update_shopping_item", "Mark bought / cancelled, or change quantity. Marking bought also adds it to inventory if tracked there.",
  { id: z.number().int(), status: z.enum(["needed", "bought", "cancelled"]).optional(), qty: z.number().optional(), store: z.string().optional(), needed_for: z.string().optional() },
  async ({ id, ...f }) => {
    const cur = await one("SELECT * FROM shopping_items WHERE id=?", [id]);
    if (!cur) throw new Error(`shopping item ${id} not found`);
    const sets = Object.keys(f).filter((k) => f[k] !== undefined);
    if (sets.length) await q(`UPDATE shopping_items SET ${[...sets.map((k) => `${k}=?`), "updated_at=?"].join(",")} WHERE id=?`, [...sets.map((k) => f[k]), nowSql(), id]);
    if (f.status === "bought") {
      const inv = (await q("SELECT id,name FROM inventory")).find((i) => similarity(i.name, cur.name) >= 0.8);
      if (inv) await q("UPDATE inventory SET qty = qty + ? WHERE id=?", [f.qty ?? cur.qty ?? 1, inv.id]);
    }
    return { updated: "shopping_item", id, fields: sets };
  });

tool(server, "check_inventory", "What is at home and how much. Keywords optional.", { keywords: z.array(z.string()).optional() },
  async ({ keywords }) => {
    const m = keywordMatch(["name", "COALESCE(location,'')"], keywords);
    return q(`SELECT id,name,qty,unit,location,low_threshold,(low_threshold IS NOT NULL AND qty <= low_threshold) AS is_low FROM inventory WHERE ${m.where} ORDER BY name`, m.params);
  });

tool(server, "update_inventory", "Set or change the quantity of something at home (creates the item if new). Use qty_delta for 'used 2' / 'bought 3'.",
  { name: z.string(), qty: z.number().optional(), qty_delta: z.number().optional(), unit: z.string().optional(), location: z.string().optional(), low_threshold: z.number().optional() },
  async ({ name, qty, qty_delta, unit, location, low_threshold }) => {
    const inv = (await q("SELECT * FROM inventory")).find((i) => similarity(i.name, name) >= 0.8);
    if (!inv) {
      const r = await q("INSERT INTO inventory (name,qty,unit,location,low_threshold) VALUES (?,?,?,?,?)", [name, qty ?? Math.max(0, qty_delta ?? 0), unit ?? null, location ?? null, low_threshold ?? null]);
      return { created: "inventory", id: r.insertId };
    }
    const nq = qty != null ? qty : Math.max(0, Number(inv.qty) + (qty_delta ?? 0));
    await q("UPDATE inventory SET qty=?, unit=COALESCE(?,unit), location=COALESCE(?,location), low_threshold=COALESCE(?,low_threshold) WHERE id=?",
      [nq, unit ?? null, location ?? null, low_threshold ?? null, inv.id]);
    return { updated: "inventory", id: inv.id, qty: nq, is_low: inv.low_threshold != null && nq <= Number(inv.low_threshold) };
  });

tool(server, "low_stock", "Items at or below their low threshold that are not already on the shopping list.", {},
  async () => q(`SELECT i.id,i.name,i.qty,i.unit,i.low_threshold FROM inventory i WHERE i.low_threshold IS NOT NULL AND i.qty <= i.low_threshold
    AND NOT EXISTS (SELECT 1 FROM shopping_items s WHERE s.status='needed' AND s.name LIKE CONCAT('%', i.name, '%'))`));

await start(server);
