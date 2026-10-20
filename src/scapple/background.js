// Scapple background shapes: a coloured area behind a group of notes that carries them when moved.
import { bbox, byId, isNote, newRect, touch } from "./elements.js";
import { rerouteBound, routeArrow } from "./connect.js";
import { units } from "./layout.js";
import { DEFAULT_THEME } from "./themes.js";
const PAD = 24;

export const isBackground = (el) => !!el && !el.isDeleted && el.customData?.background === true;

const inside = (inner, outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** A background shape around the selected notes, placed behind everything. */
export function addBackground(elements, selectedIds, theme = DEFAULT_THEME) {
  const us = units(elements, selectedIds);
  if (!us.length) return { elements, id: null };
  const x = Math.min(...us.map((u) => u.box.x)) - PAD;
  const y = Math.min(...us.map((u) => u.box.y)) - PAD;
  const w = Math.max(...us.map((u) => u.box.x + u.box.w)) - x + PAD;
  const h = Math.max(...us.map((u) => u.box.y + u.box.h)) - y + PAD;
  const shape = newRect({
    x,
    y,
    width: w,
    height: h,
    backgroundColor: theme.shape,
    strokeColor: theme.shapeStroke,
    customData: { background: true },
  });
  return { elements: [shape, ...elements], id: shape.id };
}

/**
 * Everything that sits fully on a background shape and should move with it:
 * notes (with their text), smaller shapes, and connectors whose ends are both on it.
 */
export function contentsOf(elements, shapeId) {
  const map = byId(elements);
  const shape = map.get(shapeId);
  if (!isBackground(shape)) return new Set();
  const area = bbox(shape);
  const ids = new Set();
  for (const el of elements) {
    if (el.isDeleted || el.id === shapeId || el.type === "arrow" || el.type === "line") continue;
    if (el.type === "text" && el.containerId) continue; // comes with its container
    if (!(isNote(el) || el.type === "freedraw") || !inside(bbox(el), area)) continue;
    ids.add(el.id);
    for (const b of el.boundElements ?? []) if (b.type === "text") ids.add(b.id);
  }
  for (const el of elements) {
    if (el.isDeleted || (el.type !== "arrow" && el.type !== "line")) continue;
    const s = el.startBinding?.elementId;
    const e = el.endBinding?.elementId;
    const bound = s || e;
    if (bound ? (!s || ids.has(s)) && (!e || ids.has(e)) : inside(bbox(el), area)) ids.add(el.id);
  }
  return ids;
}

/**
 * Move `ids` so they keep their offset from where they were in `before`, shifted by (dx, dy).
 * Connectors from moved notes to notes elsewhere are re-routed.
 */
export function carry(elements, before, ids, dx, dy) {
  const old = byId(before);
  const moved = elements.map((el) => {
    if (!ids.has(el.id)) return el;
    const o = old.get(el.id) ?? el;
    return touch(el, { x: o.x + dx, y: o.y + dy });
  });
  const out = rerouteBound(moved, ids);
  const map = byId(out);
  // Arrows that moved wholesale keep their shape; re-route only the ones still attached outside.
  return out.map((el) => (ids.has(el.id) && el.type === "arrow" && (el.startBinding || el.endBinding) ? routeArrow(el, map) : el));
}
