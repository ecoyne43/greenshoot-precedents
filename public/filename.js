// A photo's file name, when it says something: "Jock Marshall Reserve Nature Walk - Urban Initiatives.jpeg" ->
// "Jock Marshall Reserve Nature Walk - Urban Initiatives". Camera and screenshot names (IMG_1234, DSC0042,
// Screenshot 2026-11-11 at..., image (3), 9f3a2c...) give "". Used by the site, the Mac panel and the server.
export function nameFromFile(name) {
  let s = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\((\d+|copy)\)$/i, "").replace(/\s+(copy|edited|final)$/i, "").replace(/\s+\d{1,2}$/, "").trim();   // "Name 2", "Name (1)"
  if (s.length < 4 || !/[a-z]{3}/i.test(s)) return "";
  if (/^(img|dsc|dscn|dcim|pxl|mvimg|gopr|p\d|photo|image|picture|pic|screenshot|screen shot|scan|untitled|unnamed|download|pasted|file|whatsapp image|signal|telegram|attachment)\b/i.test(s)) return "";
  if (/^[0-9a-f-]{12,}$/i.test(s.replace(/\s/g, ""))) return "";
  if (/^\d[\d\s\-.:]+$/.test(s)) return "";
  return s.slice(0, 200);
}
