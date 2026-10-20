// Magnetic stacks: notes written under one another move up or down when one of them grows, shrinks or goes away.
import { byId, isNote, touch } from "./elements.js";
import { rerouteBound } from "./connect.js";

const ALIGN = 3; // left edges this close count as one column
const GAP = 16; // a note this close under another is part of its stack

const stackable = (el) => isNote(el) && !el.customData?.background && el.type !== "image";

/** Where every note is, so the next change can be compared against it. */
export function boxesOf(elements) {
  const boxes = new Map();
  for (const el of elements) if (stackable(el)) boxes.set(el.id, { x: el.x, y: el.y, w: el.width, h: el.height });
  return boxes;
}

/** The notes stacked directly under `box`, top to bottom, following the column down. */
function below(boxes, id, box, skip) {
  const chain = [];
  let cur = box;
  for (;;) {
    let next = null;
    for (const [oid, b] of boxes) {
      if (oid === id || skip.has(oid) || chain.some((c) => c.id === oid)) continue;
      const gap = b.y - (cur.y + cur.h);
      if (Math.abs(b.x - cur.x) <= ALIGN && gap >= -1 && gap <= GAP && (!next || b.y < next.b.y)) next = { id: oid, b };
    }
    if (!next) return chain;
    chain.push(next);
    cur = next.b;
  }
}

/**
 * Compare notes with where they were (`before`, from boxesOf). When a note in a column changed height or was
 * deleted, shift the notes under it by the difference. Notes that moved themselves (dragged) are left alone.
 * Returns the same array when nothing needed to move.
 */
export function restack(before, elements) {
  const map = byId(elements);
  const shifts = new Map();
  for (const [id, old] of before) {
    const el = map.get(id);
    const gone = !el || el.isDeleted;
    if (!gone && (el.x !== old.x || el.y !== old.y)) continue; // it moved; that's not a stack edit
    let delta;
    if (gone) {
      const chain = below(before, id, old, new Set());
      if (!chain.length) continue;
      delta = old.y - chain[0].b.y; // close the gap it leaves
    } else if (el.height !== old.h) delta = el.height - old.h;
    else continue;
    for (const { id: cid } of below(before, id, old, new Set())) {
      const c = map.get(cid);
      const cb = before.get(cid);
      if (!c || c.isDeleted || c.x !== cb.x || c.y !== cb.y) continue;
      shifts.set(cid, (shifts.get(cid) ?? 0) + delta);
    }
  }
  if (!shifts.size) return elements;
  const moved = new Set();
  const out = elements.map((el) => {
    const d = shifts.get(el.id) ?? (el.containerId ? shifts.get(el.containerId) : undefined);
    if (!d) return el;
    moved.add(el.id);
    return touch(el, { y: el.y + d });
  });
  return rerouteBound(out, moved);
}
