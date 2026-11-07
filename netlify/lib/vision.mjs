// Reverse image search with Google Cloud Vision "web detection": finds web pages that show the same image, plus
// Google's best guess at what it is. Used only when a precedent comes in as an image with no web page to go on.
// Optional: set GOOGLE_VISION_KEY in Netlify (an API key restricted to the Cloud Vision API). Without it, Groundwork
// still looks at the image and searches from what it sees. Pricing (Nov 2026): first 1,000 images a month free,
// then US$3.50 per 1,000.
import { env } from "./server.mjs";

export const visionOn = () => !!env("GOOGLE_VISION_KEY");

// Returns a short text summary for Claude, or "" if nothing was found or the search failed.
export async function reverseImageSearch(buf) {
  if (!visionOn()) return "";
  const base = env("GOOGLE_VISION_URL", "https://vision.googleapis.com");
  try {
    const res = await fetch(`${base}/v1/images:annotate?key=${encodeURIComponent(env("GOOGLE_VISION_KEY"))}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: Buffer.from(buf).toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 10 }] }] }),
    });
    if (!res.ok) return "";
    const w = (await res.json()).responses?.[0]?.webDetection;
    if (!w) return "";
    const lines = [];
    const guess = (w.bestGuessLabels || []).map(l => l.label).filter(Boolean);
    if (guess.length) lines.push(`Google's best guess: ${guess.join("; ")}`);
    const ents = (w.webEntities || []).filter(e => e.description && e.score > 0.4).slice(0, 8).map(e => e.description);
    if (ents.length) lines.push(`Related terms: ${ents.join("; ")}`);
    const pages = (w.pagesWithMatchingImages || []).slice(0, 8).map(p => `${(p.pageTitle || "").replace(/<[^>]+>/g, "")} ${p.url}`.trim());
    if (pages.length) lines.push(`Pages showing this image:\n${pages.map(p => `- ${p}`).join("\n")}`);
    return lines.join("\n");
  } catch { return ""; }
}
