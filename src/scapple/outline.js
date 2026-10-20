// Export a board as a Markdown outline: connected notes nest under the note they hang from.
import { byId, isNote, noteText } from "./elements.js";
import { neighbours } from "./connect.js";

const readingOrder = (a, b) => a.y - b.y || a.x - b.x;

export function outline(elements, title = "") {
  const map = byId(elements);
  const notes = elements.filter((el) => isNote(el) && el.type !== "image" && noteText(el, map).trim());
  const ids = new Set(notes.map((n) => n.id));
  const incoming = new Set();
  const links = new Map();
  for (const n of notes) {
    const ns = neighbours(elements, n.id).filter((x) => ids.has(x.id));
    links.set(n.id, ns);
    if (ns.some((x) => x.kind === "in")) incoming.add(n.id);
  }

  const lines = title ? [`# ${title}`, ""] : [];
  const seen = new Set();
  const write = (n, depth) => {
    seen.add(n.id);
    const [first, ...rest] = noteText(n, map).trim().split("\n");
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${first.trim()}`);
    for (const r of rest) if (r.trim()) lines.push(`${indent}  ${r.trim()}`);
    const kids = links
      .get(n.id)
      .filter((x) => x.kind !== "in" && !seen.has(x.id))
      .map((x) => map.get(x.id))
      .sort(readingOrder);
    for (const k of kids) if (!seen.has(k.id)) write(k, depth + 1);
  };

  // Notes nothing points to come first, in reading order; then anything left (cycles).
  const sorted = [...notes].sort(readingOrder);
  for (const n of sorted) if (!incoming.has(n.id) && !seen.has(n.id)) write(n, 0);
  for (const n of sorted) if (!seen.has(n.id)) write(n, 0);
  return lines.join("\n") + "\n";
}
