// GET /api/config  The category lists and fixed lists, plus the token for image addresses.
import { requireAuth, json, imageToken } from "../lib/server.mjs";
import { imageBase } from "../lib/imagestore.mjs";
import { STATUS, SCALE, IMAGE_TYPES, REGIONS, TEXT_FIELDS } from "../lib/vocab.mjs";
import { getFacets } from "../lib/categories.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  return json({ facets: await getFacets(), status: STATUS, scale: SCALE, imageTypes: IMAGE_TYPES, regions: REGIONS, fields: TEXT_FIELDS, token: imageToken(), imgBase: imageBase() });
};
export const config = { path: "/api/config" };
