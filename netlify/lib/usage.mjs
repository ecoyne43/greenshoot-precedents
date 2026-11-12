// What the AI costs: every call to Claude is recorded with its real token counts, priced as an estimate in
// Australian dollars, in the Blobs store "usage". One small entry per call, with everything in its key, so a month's
// summary is one listing (no reading each entry):
//   2026-11/2026-11-12T09:15:02.123Z~check~Ed~0.183~10234~1550~0
//   month / time ~ feature ~ person ~ A$ ~ input tokens ~ output tokens ~ web searches
// Prices (US$, Nov 2026, Claude Sonnet 5.5) and the exchange rate can be changed with environment variables. These
// are estimates: the Claude Console has the actual bill.
import { randomBytes } from "node:crypto";
import { store } from "./blobs.mjs";

const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
export const prices = () => ({
  input: num("PRICE_INPUT_USD_PER_M", 2), output: num("PRICE_OUTPUT_USD_PER_M", 10),
  search: num("PRICE_SEARCH_USD_PER_1000", 10), audPerUsd: num("AUD_PER_USD", 1.45),
});

// What each AI action is called on the costs page.
export const FEATURES = {
  draft: "Drafting a new precedent", check: "Check and fill: checking the fields", research: "Check and fill: web search",
  merge: "Adding to an existing precedent", ask: "Ask Groundwork", similar: "Find similar", brief: "Precedents for a brief",
  sort: "Picking photos from a document", other: "Other",
};

export function costAUD(u) {
  const p = prices();
  const input = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
  const usd = input / 1e6 * p.input + (u.output_tokens || 0) / 1e6 * p.output + (u.searches || 0) * p.search / 1000;
  return usd * p.audPerUsd;
}

// The token counts in an API answer (or a streamed event), merged into a running total.
export function addUsage(total, u) {
  if (!u) return total;
  for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"])
    if (typeof u[k] === "number") total[k] = Math.max(total[k] || 0, u[k]);
  const s = u.server_tool_use?.web_search_requests;
  if (typeof s === "number") total.searches = Math.max(total.searches || 0, s);
  return total;
}

export async function logUsage({ feature = "other", user = "", usage = {} }) {
  try {
    const at = new Date().toISOString(), aud = costAUD(usage);
    const key = [`${at.slice(0, 7)}/${at}`, FEATURES[feature] ? feature : "other", encodeURIComponent(String(user || "someone").slice(0, 40)).replace(/~/g, "%7E"),
      aud.toFixed(4), usage.input_tokens || 0, usage.output_tokens || 0, usage.searches || 0, randomBytes(2).toString("hex")].join("~");
    await store("usage").set(key, "");
    return aud;
  } catch { return 0; }   // never let cost-keeping break the actual work
}

export function parseKey(key) {
  const [head, feature, user, aud, input, output, searches] = key.split("~");
  const at = head.split("/")[1] || "";
  return { at, day: at.slice(0, 10), feature, user: decodeURIComponent(user || ""), aud: Number(aud) || 0, input: +input || 0, output: +output || 0, searches: +searches || 0 };
}

// A Claude stream passed through to the browser untouched, noting the token counts as they go by and recording
// them when it ends. (If Netlify cuts the stream off, the counts so far are recorded.)
export function meterStream(body, ctx) {
  const dec = new TextDecoder();
  let buf = "", usage = {}, logged = false, pending = null;
  const log = () => { if (logged) return Promise.resolve(); logged = true; return logUsage({ ...ctx, usage }); };
  return body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      ctrl.enqueue(chunk);
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          addUsage(usage, ev.message?.usage || ev.usage);
          if (ev.type === "message_delta" && ev.usage) pending = log();   // the final counts: record straight away
        } catch { /* not JSON */ }
      }
    },
    flush: () => pending || log(),
  }));
}
