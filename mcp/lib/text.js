// Text similarity that works for Thai (no spaces between words): Dice coefficient on character bigrams.
export function norm(s) {
  return String(s ?? "").toLowerCase().replace(/[\s\-_.,:;!?'"()\[\]{}\/\\]+/gu, "");
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
  for (const [, n] of B) total += n;
  return (2 * inter) / total;
}

/** Share of the shorter text's bigrams found in the longer one (1 = short text is "inside" the long one). */
export function overlap(a, b) {
  const x = norm(a), y = norm(b);
  if (x.length < 4 || y.length < 4) return 0;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  const S = bigrams(s), L = bigrams(l);
  let inter = 0, total = 0;
  for (const [g, n] of S) { inter += Math.min(n, L.get(g) || 0); total += n; }
  return inter / total;
}

export function mostSimilar(title, rows, field = "title", threshold = 0.6) {
  return rows
    .map((r) => ({ ...r, similarity: Number(similarity(title, r[field]).toFixed(2)) }))
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}
