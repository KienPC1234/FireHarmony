/** Minimal RFC 4180 CSV parser for the offline upload fallback.
 *
 * Handles quoted fields, escaped quotes (""), CRLF/LF, and a UTF-8 BOM.
 * The previous fallback used `split(",")`, which broke on quoted FIRMS
 * metadata and values containing commas (audit P1-15).
 */
export function parseCsv(text: string, limit = 5000): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0].map((c) => c.trim().toLowerCase());
  return rows.slice(1, limit + 1).map((cells) =>
    Object.fromEntries(header.map((c, i) => [c, (cells[i] ?? "").trim()])),
  );
}
