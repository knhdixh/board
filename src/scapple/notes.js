// The notes on a board as a list (for the Notes panel), and find & replace across them.
import { byId, isNote, noteText, touch } from "./elements.js";
import { neighbours } from "./connect.js";

/** Every note with text, in reading order, with how many connections it has. */
export function listNotes(elements) {
  const map = byId(elements);
  return elements
    .filter((el) => isNote(el) && !el.customData?.background)
    .map((el) => ({ id: el.id, text: noteText(el, map).trim() || (el.type === "image" ? "Image" : ""), x: el.x, y: el.y, links: neighbours(elements, el.id).length }))
    .filter((n) => n.text)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Notes whose text contains `query` (ignoring case). */
export const findNotes = (notes, query) => {
  const q = query.trim().toLowerCase();
  return q ? notes.filter((n) => n.text.toLowerCase().includes(q)) : notes;
};

/**
 * Replace `find` with `replacement` in every note's text (ignoring case).
 * Returns { elements, count }; text must be re-measured afterwards.
 */
export function replaceInNotes(elements, find, replacement) {
  if (!find) return { elements, count: 0 };
  const re = new RegExp(escape(find), "gi");
  let count = 0;
  const out = elements.map((el) => {
    if (el.type !== "text" || el.isDeleted) return el;
    const original = el.originalText ?? el.text;
    const hits = original.match(re)?.length ?? 0;
    if (!hits) return el;
    count += hits;
    const next = original.replace(re, replacement);
    return touch(el, { originalText: next, text: next });
  });
  return { elements: count ? out : elements, count };
}
