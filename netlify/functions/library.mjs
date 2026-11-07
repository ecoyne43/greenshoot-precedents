// GET /api/library  All precedents: { records }.
import { requireAuth, json, handle } from "../lib/server.mjs";
import { readLibrary } from "../lib/library.mjs";

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { records } = await readLibrary();
  return json({ records });
});
export const config = { path: "/api/library" };
