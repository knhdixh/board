// Export a board as a Markdown outline: connected notes nest under the note they hang from.
import { byId, isNote, noteText } from "./elements.js";
import { neighbours } from "./connect.js";
import { isCell, markdownTable, tableRows } from "./table.js";

const readingOrder = (a, b) => a.y - b.y || a.x - b.x;

export function outline(elements, title = "") {
  const map = byId(elements);
  // A table is one entry, written as a Markdown table, standing in for all its cells (its first cell carries it).
  const tables = new Map();
  for (const el of elements) {
    if (!isCell(el)) continue;
    const t = tables.get(el.customData.table);
    if (!t || el.customData.row < t.customData.row || (el.customData.row === t.customData.row && el.customData.col < t.customData.col))
      tables.set(el.customData.table, el);
  }
  const tableText = new Map();
  for (const [table, first] of tables) {
    const rows = tableRows(elements, table);
    if (rows.some((r) => r.some(Boolean))) tableText.set(first.id, markdownTable(rows));
  }
  const notes = elements.filter((el) => isNote(el) && el.type !== "image" && (isCell(el) ? tableText.has(el.id) : noteText(el, map).trim()));
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
    const indent = "  ".repeat(depth);
    if (tableText.has(n.id)) {
      lines.push("", ...tableText.get(n.id).split("\n").map((l) => indent + l), "");
      return;
    }
    const [first, ...rest] = noteText(n, map).trim().split("\n");
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

/** Outline of just the selected notes (and the connections between them), for copying elsewhere. */
export function selectionOutline(elements, selectedIds) {
  const map = byId(elements);
  const keep = new Set();
  for (const id of selectedIds) {
    const el = map.get(id);
    if (!el) continue;
    const note = el.type === "text" && el.containerId ? map.get(el.containerId) : el;
    if (!note) continue;
    keep.add(note.id);
    for (const b of note.boundElements ?? []) if (b.type === "text") keep.add(b.id);
  }
  const subset = elements.filter(
    (el) => keep.has(el.id) || (el.type === "arrow" && keep.has(el.startBinding?.elementId) && keep.has(el.endBinding?.elementId)),
  );
  return outline(subset);
}
