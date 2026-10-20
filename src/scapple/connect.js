// Scapple-style connections: drop one note onto another to connect them, drop it again to disconnect.
import { bbox, byId, contains, isNote, newArrow, noteFor, touch } from "./elements.js";

const GAP = 6;

/** Topmost note under a scene point, ignoring `exclude` ids (and anything inside them). */
export function noteAt(elements, point, exclude = new Set()) {
  const map = byId(elements);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = noteFor(elements[i], map);
    if (!isNote(el) || exclude.has(el.id) || el.locked) continue;
    if (contains(bbox(el), point, 2)) return el;
  }
  return null;
}

const isConnector = (el) => el.type === "arrow" && !el.isDeleted;

/** The arrow joining two notes, in either direction. */
export function findConnector(elements, aId, bId) {
  return elements.find(
    (el) =>
      isConnector(el) &&
      ((el.startBinding?.elementId === aId && el.endBinding?.elementId === bId) ||
        (el.startBinding?.elementId === bId && el.endBinding?.elementId === aId)),
  );
}

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where the segment from the box's centre towards `to` leaves the box (grown by `gap`). */
export function exitPoint(box, to, gap = GAP) {
  const c = center(box);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = box.w / 2 + gap;
  const hh = box.h / 2 + gap;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * Math.min(t, 1), y: c.y + dy * Math.min(t, 1) };
}

/** Re-draw an arrow as a straight segment between the two notes it binds. */
export function routeArrow(arrow, map) {
  const a = arrow.startBinding && map.get(arrow.startBinding.elementId);
  const b = arrow.endBinding && map.get(arrow.endBinding.elementId);
  if (!a && !b) return arrow;
  const pts = arrow.points.map(([px, py]) => ({ x: arrow.x + px, y: arrow.y + py }));
  let start = pts[0];
  let end = pts[pts.length - 1];
  const nextToStart = pts.length > 2 ? pts[1] : b ? center(bbox(b)) : end;
  const nextToEnd = pts.length > 2 ? pts[pts.length - 2] : a ? center(bbox(a)) : start;
  if (a) start = exitPoint(bbox(a), nextToStart);
  if (b) end = exitPoint(bbox(b), nextToEnd);
  const abs = [start, ...pts.slice(1, -1), end];
  const xs = abs.map((p) => p.x);
  const ys = abs.map((p) => p.y);
  return touch(arrow, {
    x: start.x,
    y: start.y,
    points: abs.map((p) => [p.x - start.x, p.y - start.y]),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
}

/** Re-route every arrow bound to one of `ids`. */
export function rerouteBound(elements, ids) {
  const map = byId(elements);
  return elements.map((el) =>
    isConnector(el) && (ids.has(el.startBinding?.elementId) || ids.has(el.endBinding?.elementId))
      ? routeArrow(el, map)
      : el,
  );
}

const addBound = (el, ref) =>
  touch(el, { boundElements: [...(el.boundElements ?? []).filter((b) => b.id !== ref.id), ref] });
const dropBound = (el, id) =>
  touch(el, { boundElements: (el.boundElements ?? []).filter((b) => b.id !== id) });

/**
 * Connect `fromId` to `toId`, or remove the connection if there already is one.
 * Lines are dotted with no arrowheads (like Scapple); `arrow: true` draws a solid arrow from → to.
 */
export function toggleConnection(elements, fromId, toId, { arrow = false } = {}) {
  const existing = findConnector(elements, fromId, toId);
  if (existing) {
    const out = elements.map((el) => {
      if (el.id === existing.id) return touch(el, { isDeleted: true });
      if (el.id === fromId || el.id === toId) return dropBound(el, existing.id);
      return el;
    });
    return { elements: out, action: "disconnected", id: existing.id };
  }
  const map = byId(elements);
  const from = map.get(fromId);
  const to = map.get(toId);
  let connector = newArrow({
    strokeColor: arrow ? "#1e1e1e" : "#868e96",
    strokeStyle: arrow ? "solid" : "dotted",
    endArrowhead: arrow ? "arrow" : null,
    startBinding: { elementId: fromId, focus: 0, gap: GAP },
    endBinding: { elementId: toId, focus: 0, gap: GAP },
    frameId: from.frameId && from.frameId === to.frameId ? from.frameId : null,
  });
  connector = routeArrow(connector, map);
  const ref = { id: connector.id, type: "arrow" };
  // New connectors go to the back so they never cover a note.
  const out = [
    connector,
    ...elements.map((el) => (el.id === fromId || el.id === toId ? addBound(el, ref) : el)),
  ];
  return { elements: out, action: "connected", id: connector.id };
}

/** Notes directly connected to `id`, with direction. */
export function neighbours(elements, id) {
  const out = [];
  for (const el of elements) {
    if (!isConnector(el)) continue;
    const s = el.startBinding?.elementId;
    const e = el.endBinding?.elementId;
    const directed = !!el.endArrowhead !== !!el.startArrowhead;
    const forward = !!el.endArrowhead;
    if (s === id && e) out.push({ id: e, kind: !directed ? "line" : forward ? "out" : "in" });
    else if (e === id && s) out.push({ id: s, kind: !directed ? "line" : forward ? "in" : "out" });
  }
  return out;
}
