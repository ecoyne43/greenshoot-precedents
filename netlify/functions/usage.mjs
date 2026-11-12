// /api/usage  The AI costs page: what Groundwork has cost (estimated, A$) this month and before.
//   GET  ?month=2026-11   -> { month, total, calls, projected, byFeature, byUser, byDay, months: [{ month, total, calls }],
//                            budget, prices, features }
//   GET  ?summary=1        -> { month, total, budget } (for the header)
//   POST { budget }        a monthly heads-up amount in A$ (0 for none): over it, the header turns amber
import { requireAuth, json, handle } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";
import { parseKey, prices, FEATURES } from "../lib/usage.mjs";

const round = n => Math.round(n * 100) / 100;

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  const settings = store("usage-settings");
  if (req.method === "POST") {
    const { budget } = await req.json().catch(() => ({}));
    const b = Math.max(0, Math.min(100000, Number(budget) || 0));
    await settings.setJSON("budget", { budget: b });
    return json({ budget: b });
  }
  const q = new URL(req.url).searchParams;
  const now = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(q.get("month") || "") ? q.get("month") : now;
  const budget = (await settings.get("budget", { type: "json" }).catch(() => null))?.budget || 0;
  const u = store("usage");
  const rows = (await u.list({ prefix: `${month}/` })).blobs.map(b => parseKey(b.key));
  const total = rows.reduce((a, r) => a + r.aud, 0);
  if (q.get("summary")) return json({ month, total: round(total), budget });

  const group = key => {
    const g = {};
    for (const r of rows) { const k = r[key]; g[k] ||= { calls: 0, total: 0, input: 0, output: 0, searches: 0 }; g[k].calls++; g[k].total += r.aud; g[k].input += r.input; g[k].output += r.output; g[k].searches += r.searches; }
    return Object.entries(g).map(([k, v]) => ({ key: k, ...v, total: round(v.total), average: round(v.total / v.calls) })).sort((a, b) => b.total - a.total);
  };
  // Months: the totals of every month with any AI use.
  const all = (await u.list()).blobs.map(b => b.key).filter(k => /^\d{4}-\d{2}\//.test(k));
  const months = {};
  for (const k of all) { const m = k.slice(0, 7); months[m] ||= { month: m, total: 0, calls: 0 }; months[m].total += parseKey(k).aud; months[m].calls++; }
  // A rough projection for the current month, from the spend so far.
  const d = new Date(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const projected = month === now && d.getDate() >= 3 ? round(total / d.getDate() * days) : null;
  return json({
    month, total: round(total), calls: rows.length, projected, budget,
    byFeature: group("feature").map(x => ({ ...x, label: FEATURES[x.key] || x.key })),
    byUser: group("user"), byDay: group("day").sort((a, b) => a.key.localeCompare(b.key)),
    months: Object.values(months).map(m => ({ ...m, total: round(m.total) })).sort((a, b) => b.month.localeCompare(a.month)),
    prices: prices(), features: FEATURES,
  });
});

export const config = { path: "/api/usage" };
