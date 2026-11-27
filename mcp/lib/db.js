import mysql from "mysql2/promise";
import { loadSettings } from "./config.js";

let pool;
export function db() {
  if (!pool) {
    const { db: c } = loadSettings();
    pool = mysql.createPool({ ...c, charset: "utf8mb4", dateStrings: true, connectionLimit: 4, timezone: "+07:00" });
  }
  return pool;
}

export async function q(sql, params = []) {
  const [rows] = await db().query(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

/** Build a WHERE fragment that matches any keyword in any of the columns, plus a score expression. */
export function keywordMatch(columns, keywords) {
  const kws = (keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 8);
  if (!kws.length) return { where: "1=1", score: "0", params: [], scoreParams: [] };
  const parts = [], scoreParts = [], params = [], scoreParams = [];
  for (const k of kws) {
    for (const c of columns) {
      parts.push(`${c} LIKE ?`); params.push(`%${k}%`);
      scoreParts.push(`(${c} LIKE ?)`); scoreParams.push(`%${k}%`);
    }
  }
  return { where: `(${parts.join(" OR ")})`, score: scoreParts.join(" + "), params, scoreParams };
}

export async function close() { if (pool) await pool.end(); pool = null; }
