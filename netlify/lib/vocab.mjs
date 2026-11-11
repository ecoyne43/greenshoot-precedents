// The precedents library's categories (facets) and fixed lists. Every record picks values only from these lists,
// so search and filters stay consistent. Change a list here and the interface, the AI drafting and the checks all
// follow. Renaming a value: also rename it in existing records (see README, "Changing the categories").

export const FACETS = [
  { key: "project_type", label: "Project type", hint: "What kind of place it is", values: [
    "Civic + Cultural", "Education", "Health + Care", "Residential", "Workplace + Commercial", "Sport + Stadium",
    "Park + Open Space", "Streetscape + Urban Design", "Bridge + Infrastructure", "Waterway + Wetland", "Playspace",
    "Memorial + Commemorative"] },
  { key: "design_element", label: "Design element", hint: "Which part of the design", values: [
    "Facade", "Roof + Ceiling + Soffit", "Skylight", "Interior", "Ground Plane + Paving", "Furniture", "Screen",
    "Shelter + Pavilion", "Boardwalk + Path", "Bridge", "Entry + Threshold", "Planting", "Water Feature", "Lighting"] },
  { key: "cultural_expression", label: "Cultural expression", hint: "How culture shows up", values: [
    "Public Art", "Light + Projection", "Soundscape", "Naming + Language", "Wayfinding + Interpretive Signage",
    "Pattern + Graphics", "Artefact + Display", "Performance", "Acknowledgement of Country"] },
  { key: "dwc_themes", label: "Designing with Country themes", hint: "Themes the project responds to", values: [
    "Caring for Country", "Truth Telling", "Knowledge Systems", "Ceremony", "Gathering Place", "Cultural Safety",
    "Identity + Significant Figures", "Relationships + Community Involvement", "Learning on Country",
    "Healing + Wellbeing", "Cultural Fire"] },
  { key: "environment", label: "Environment + sustainability", hint: "Environmental moves", values: [
    "WSUD", "Wetlands", "Flora + Fauna + Habitat", "Cultural Burning", "Nature Play", "Sustainable Design",
    "Climate + Resilience"] },
  // Materials are groups, for filtering; the exact material goes in the record's "specific materials" (material_details:
  // "Corten steel", "Spotted gum", "Bluestone"), which can be anything.
  { key: "materials", label: "Materials", hint: "Main material groups (the exact materials go below)", values: [
    "Timber", "Stone", "Earth + Rammed Earth", "Brick", "Concrete", "Metal", "Glass", "Ceramic + Tile",
    "Fibre + Weaving", "Textile + Fabric", "Plastic + Resin", "Paint + Pigment", "Recycled + Reclaimed",
    "Living Materials", "Water"] },
  { key: "medium", label: "Medium + technique", hint: "How the work is made", values: [
    "Mural + Painting", "Sculpture", "Carving + Engraving", "Etching + Sandblasting", "Laser + CNC Cutting",
    "Casting", "Weaving + Fibre Art", "Mosaic + Inlay", "Ceramics", "Printed Graphics + Film",
    "Projection + Digital", "Lighting Design", "Planting Design", "Installation"] },
  { key: "programme", label: "Programme + activation", hint: "How the place is used and activated", values: [
    "Public Programs + Events", "Enterprise + Commerce", "Performing Arts", "Sport", "Education Programs",
    "Ceremony Space"] },
  { key: "involvement", label: "First Peoples involvement", hint: "How First Peoples shaped the project", values: [
    "First Peoples-led design", "Co-designed with Traditional Owners", "First Peoples artist commission", "Consulted",
    "Not documented"] },
];

// Old values that were renamed: records with them are read as the new value.
export const ALIASES = { materials: { Steel: "Metal" } };

// The base lists plus values the team added on the Categories page (categories.json in the data repo).
// added: { materials: [{ value, by, at }], ... }
export function withAdded(added = {}) {
  return FACETS.map(f => {
    const extra = (added[f.key] || []).map(x => (typeof x === "string" ? { value: x } : x)).filter(x => x.value && !f.values.includes(x.value));
    return { ...f, values: [...f.values, ...extra.map(x => x.value)], added: extra };
  });
}

export function aliasFacets(facets = {}) {
  const o = { ...facets };
  for (const [k, map] of Object.entries(ALIASES)) if (Array.isArray(o[k])) o[k] = [...new Set(o[k].map(v => map[v] || v))];
  return o;
}

// A record with renamed values: the new value in its categories, and the old one kept as a specific material (so a
// precedent tagged "Steel" becomes Metal, with "Steel" in its specific materials, and still turns up for "steel").
export function aliasRecord(r) {
  const details = [...(r.material_details || [])];
  for (const [k, map] of Object.entries(ALIASES)) for (const v of r.facets?.[k] || [])
    if (map[v] && k === "materials" && !details.some(d => d.toLowerCase() === v.toLowerCase())) details.push(v);
  return { ...r, facets: aliasFacets(r.facets || {}), material_details: details };
}

// Record depth: "full" (Greenshoot projects and precedents with First Peoples involvement: summary, why it matters,
// description) or "short" (everything else: the facts, a sentence or two, the images, categories and materials).
export const DEPTHS = ["full", "short"];
export const isFirstPeoples = r => (r.facets?.involvement || []).some(v => v !== "Not documented") || !!r.greenshoot_project;

export const STATUS = ["Built", "Under construction", "Unbuilt", "Competition", "Concept"];
export const SCALE = ["Object", "Building", "Precinct", "Landscape"];
export const IMAGE_TYPES = ["Photo", "Aerial", "Plan", "Section", "Detail", "Render", "Diagram"];
export const REGIONS = ["Victoria", "Australia (other states)", "International"];

// Text fields on a record, in the order the form shows them. `long` fields get a text box.
export const TEXT_FIELDS = [
  { key: "name", label: "Project name" },
  { key: "also_known_as", label: "Also known as" },
  { key: "location_text", label: "Location" },
  { key: "city", label: "City or town" },
  { key: "state", label: "State or region" },
  { key: "country", label: "Country (nation)" },
  { key: "country_to", label: "Country / Traditional Owners" },
  { key: "year_completed", label: "Year completed" },
  { key: "architect", label: "Architect" },
  { key: "landscape_architect", label: "Landscape architect" },
  { key: "artists", label: "Artists" },
  { key: "first_peoples_collaborators", label: "First Peoples collaborators" },
  { key: "client", label: "Client" },
  { key: "other_team", label: "Other team" },
  { key: "awards", label: "Awards" },
  { key: "summary", label: "Summary", long: true, hint: "60 to 90 words, plain and factual" },
  { key: "why_it_matters", label: "Why it matters for Greenshoot", long: true, hint: "What it does well and what we can learn from it" },
  { key: "description", label: "Description", long: true },
];

export const ID_PREFIX = "PR";
export const facetKeys = FACETS.map(f => f.key);
