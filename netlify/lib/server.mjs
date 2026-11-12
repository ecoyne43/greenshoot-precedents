// Shared server helpers: password check, responses, the data file in GitHub, Claude calls, image addresses.
// For local testing set LOCAL_DATA_DIR (data file read and written in that folder instead of GitHub) and
// ANTHROPIC_BASE_URL (a fake Claude). See dev/mock-server.mjs.
import { timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logUsage, addUsage, meterStream } from "./usage.mjs";

export const env = (k, fallback) => process.env[k] ?? fallback;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function requireAuth(req) {
  const expected = (env("APP_PASSWORD") || "").trim();
  if (!expected) return json({ error: "APP_PASSWORD is not set in Netlify environment variables" }, 500);
  const given = (req.headers.get("x-app-password") || "").trim();
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: "Wrong password" }, 401);
  return null;
}

// Who is doing something: the name each person enters once in their browser, sent with every request.
export const userName = req => decodeURIComponent(req.headers.get("x-user-name") || "").trim().slice(0, 80) || "Unknown";

// Em dashes never go into the library (Ed's rule): turn them into commas.
export const tidy = v => (typeof v === "string" ? v.replace(/\s*—\s*/g, ", ").trim() : v);

// ---------- data file (GitHub contents API, or a local folder for tests) ----------
export const DATA_PATH = () => env("DATA_PATH", "precedents.json");

function ghConfig() {
  const repo = env("GITHUB_REPO"), token = env("GITHUB_TOKEN");
  if (!repo || !token) throw new Error("GITHUB_REPO and GITHUB_TOKEN must be set");
  return { repo, token, branch: env("GITHUB_BRANCH", "main") };
}
const ghHeaders = (token, accept) => ({
  authorization: `Bearer ${token}`, accept, "x-github-api-version": "2022-11-28", "user-agent": "groundworked-precedents",
});

// Returns { data, sha }. A missing file gives { data: fallback, sha: null }.
export async function readJSON(path, fallback) {
  const local = env("LOCAL_DATA_DIR");
  if (local) {
    const p = join(local, path);
    if (!existsSync(p)) return { data: fallback, sha: null };
    const text = readFileSync(p, "utf8");
    return { data: JSON.parse(text), sha: createHash("sha1").update(text).digest("hex") };
  }
  const { repo, token, branch } = ghConfig();
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const meta = await fetch(url, { headers: ghHeaders(token, "application/vnd.github+json") });
  if (meta.status === 404) return { data: fallback, sha: null };
  if (!meta.ok) throw new Error(`GitHub read of ${path} failed (${meta.status}): ${await meta.text()}`);
  const { sha } = await meta.json();
  const raw = await fetch(url, { headers: ghHeaders(token, "application/vnd.github.raw+json") });
  if (!raw.ok) throw new Error(`GitHub raw read of ${path} failed (${raw.status})`);
  return { data: JSON.parse(await raw.text()), sha };
}

// Throws an error with .conflict when the file changed since it was read.
export async function writeJSON(path, data, sha, message) {
  const text = JSON.stringify(data, null, 1) + "\n";
  const local = env("LOCAL_DATA_DIR");
  if (local) {
    const p = join(local, path);
    mkdirSync(local, { recursive: true });
    const cur = existsSync(p) ? createHash("sha1").update(readFileSync(p, "utf8")).digest("hex") : null;
    if (cur !== sha) { const e = new Error("conflict"); e.conflict = true; throw e; }
    writeFileSync(p, text);
    const log = join(local, "_commits.log");
    writeFileSync(log, (existsSync(log) ? readFileSync(log, "utf8") : "") + message.split("\n")[0] + "\n");
    return { sha: createHash("sha1").update(text).digest("hex"), commitUrl: "" };
  }
  const { repo, token, branch } = ghConfig();
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(token, "application/vnd.github+json"), "content-type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), ...(sha ? { sha } : {}), branch }),
  });
  if (res.status === 409 || res.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
  if (!res.ok) throw new Error(`GitHub write of ${path} failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return { sha: body.content.sha, commitUrl: body.commit?.html_url };
}

// ---------- Claude ----------
const CLAUDE_URL = () => env("ANTHROPIC_BASE_URL", "https://api.anthropic.com") + "/v1/messages";

// One Claude call. With `schema`, the answer is JSON matching it and comes back parsed.
// feature and user: for the AI costs page (every call's tokens are recorded, see usage.mjs).
export async function claude({ system, content, schema, maxTokens = 4000, tools, feature = "other", user = "" }) {
  if (!env("ANTHROPIC_API_KEY")) throw Object.assign(new Error("ANTHROPIC_API_KEY is not set"), { status: 500 });
  const res = await fetch(CLAUDE_URL(), {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("CLAUDE_MODEL", "claude-sonnet-5-5"), max_tokens: maxTokens, system,
      messages: [{ role: "user", content }],
      ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
      ...(tools ? { tools } : {}),
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Claude error ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: 502 });
  const out = await res.json();
  await logUsage({ feature, user, usage: addUsage({}, out.usage) });
  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  if (!schema) return text;
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("Claude's answer could not be read"), { status: 502 }); }
}

// Claude with a JSON answer, streamed straight back to the browser as it is written. For answers that can take a
// while (Check and fill): Netlify cuts off a function that waits too long before replying, but not one that is
// already streaming. The page reads the text with readWebText and parses the JSON.
export async function streamJSON({ system, content, schema, maxTokens = 4000, feature = "other", user = "" }) {
  if (!env("ANTHROPIC_API_KEY")) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  const res = await fetch(CLAUDE_URL(), {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("CLAUDE_MODEL", "claude-sonnet-5-5"), max_tokens: maxTokens, stream: true, system,
      messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema } },
    }),
  });
  if (!res.ok) return json({ error: `Claude API error (${res.status}): ${(await res.text()).slice(0, 300)}` }, 502);
  return new Response(meterStream(res.body, { feature, user }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

// Claude with web search, streamed back to the browser (long searches would time out otherwise).
export async function streamWithSearch({ system, content, maxUses = 6, maxTokens = 5000, feature = "research", user = "" }) {
  if (!env("ANTHROPIC_API_KEY")) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  const res = await fetch(CLAUDE_URL(), {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("CLAUDE_MODEL", "claude-sonnet-5-5"), max_tokens: maxTokens, stream: true, system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }],
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const hint = /web.?search/i.test(text) ? " Web search may need to be switched on for this API key in the Claude Console." : "";
    return json({ error: `Claude API error (${res.status}): ${text.slice(0, 400)}${hint}` }, 502);
  }
  return new Response(meterStream(res.body, { feature, user }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

// ---------- images ----------
// <img> tags cannot send the password header, so image addresses carry a token derived from the password.
export const imageToken = () => createHash("sha256").update("precedents-images:" + (env("APP_PASSWORD") || "").trim()).digest("hex").slice(0, 32);

export function checkToken(t) {
  const a = Buffer.from(t || ""), b = Buffer.from(imageToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only fetch ordinary public web addresses (no local or private network addresses).
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (env("ALLOW_LOCAL_FETCH")) return u;   // local tests only
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(":")) return null;
  return u;
}

export const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Groundworked/1.0",
  "accept-language": "en-AU,en;q=0.9",
};

export const handle = fn => async req => {
  try { return await fn(req); } catch (e) { return json({ error: e.message || String(e) }, e.status || (e.conflict ? 409 : 500)); }
};
