// Stacking and arranging notes, Scapple style.
import { byId, isNote, noteFor, touch } from "./elements.js";
import { rerouteBound } from "./connect.js";

/**
 * Group a selection into movable units: a group moves as one, a shape moves with its text.
 * Returns [{ key, ids:Set, box }].
 */
export function units(elements, selectedIds) {
  const map = byId(elements);
  const keyOf = (el) => (el.groupIds?.length ? "g:" + el.groupIds[el.groupIds.length - 1] : noteFor(el, map).id);
  const keys = new Set();
  for (const id of selectedIds) {
    const el = map.get(id);
    if (!el || el.isDeleted) continue;
    if (!el.groupIds?.length && !isNote(noteFor(el, map))) continue; // loose arrows/lines don't stack
    keys.add(keyOf(el));
  }
  const out = [];
  for (const key of keys) {
    const members = elements.filter(
      (el) => !el.isDeleted && (keyOf(el) === key || (el.containerId && keyOf(map.get(el.containerId) ?? el) === key)),
    );
    const boxes = members.filter((el) => el.type !== "arrow" && el.type !== "line");
    const src = boxes.length ? boxes : members;
    const x = Math.min(...src.map((e) => e.x));
    const y = Math.min(...src.map((e) => e.y));
    const w = Math.max(...src.map((e) => e.x + e.width)) - x;
    const h = Math.max(...src.map((e) => e.y + e.height)) - y;
    out.push({ key, ids: new Set(members.map((m) => m.id)), box: { x, y, w, h } });
  }
  return out;
}

function moveUnits(elements, moves) {
  const delta = new Map();
  for (const { unit, dx, dy } of moves) for (const id of unit.ids) delta.set(id, { dx, dy });
  const moved = elements.map((el) => {
    const d = delta.get(el.id);
    return d && (d.dx || d.dy) ? touch(el, { x: el.x + d.dx, y: el.y + d.dy }) : el;
  });
  return rerouteBound(moved, new Set(delta.keys()));
}

/** Stack notes in a left-aligned column, top to bottom, in their current vertical order. */
export function stack(elements, selectedIds, gap = 8) {
  const us = units(elements, selectedIds).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  if (us.length < 2) return elements;
  const x0 = Math.min(...us.map((u) => u.box.x));
  let y = us[0].box.y;
  const moves = us.map((unit) => {
    const m = { unit, dx: x0 - unit.box.x, dy: y - unit.box.y };
    y += unit.box.h + gap;
    return m;
  });
  return moveUnits(elements, moves);
}

/** Lay notes out in a row, left to right, top-aligned. */
export function row(elements, selectedIds, gap = 24) {
  const us = units(elements, selectedIds).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  if (us.length < 2) return elements;
  const y0 = Math.min(...us.map((u) => u.box.y));
  let x = us[0].box.x;
  const moves = us.map((unit) => {
    const m = { unit, dx: x - unit.box.x, dy: y0 - unit.box.y };
    x += unit.box.w + gap;
    return m;
  });
  return moveUnits(elements, moves);
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Push notes down until none of them overlap each other, keeping their order. */
export function separate(elements, selectedIds, gap = 8) {
  const us = units(elements, selectedIds).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const placed = [];
  const moves = [];
  for (const unit of us) {
    const box = { ...unit.box };
    for (const p of placed) if (overlaps(box, p)) box.y = p.y + p.h + gap;
    if (box.y !== unit.box.y) moves.push({ unit, dx: 0, dy: box.y - unit.box.y });
    placed.push(box);
  }
  return moves.length ? moveUnits(elements, moves) : elements;
}
