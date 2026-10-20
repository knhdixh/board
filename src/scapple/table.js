// Tables, two ways.
// On the canvas: a grid of cells (boxes with text), grouped so it moves as one. Every cell knows its
// table, row and column, so the grid keeps itself lined up when a cell grows or is resized.
// In a note: Markdown-style rows ("a | b | c") that line up in a monospace font once you stop typing.
import { FONT, LINE_HEIGHT, byId, newRect, newText, randomId, touch } from "./elements.js";

export const CELL_W = 120;
export const CELL_H = 36;
export const MONO = 3; // Cascadia: a monospace font Excalidraw bundles, so text tables line up
const TEXT_INSET = 5; // Excalidraw's padding for text inside a shape

/* ---------- grid tables ---------- */

export const isCell = (el) => !!el && !el.isDeleted && !!el.customData?.table;

/** A new rows × cols table with its top-left corner at (x, y). Returns { elements, id }. */
export function newTable(x, y, rows = 3, cols = 3, theme) {
  const table = randomId();
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(...newCell(table, r, c, x + c * CELL_W, y + r * CELL_H, CELL_W, CELL_H, theme));
  return { elements: out, id: table };
}

function newCell(table, row, col, x, y, width, height, theme, groupIds = [table]) {
  const rect = newRect({
    x,
    y,
    width,
    height,
    roundness: null,
    strokeColor: theme?.line ?? "#868e96",
    backgroundColor: "transparent",
    groupIds,
    customData: { table, row, col },
  });
  const text = newText({
    text: "",
    originalText: "",
    x: x + TEXT_INSET,
    y: y + height / 2 - 10,
    width: 0,
    height: 20,
    strokeColor: theme?.ink ?? "#1e1e1e",
    containerId: rect.id,
    verticalAlign: "middle",
    groupIds,
  });
  rect.boundElements = [{ id: text.id, type: "text" }];
  return [rect, text];
}

/** The cells of a table, by id, and its size. */
function cellsOf(elements, table) {
  const cells = elements.filter((e) => isCell(e) && e.customData.table === table);
  const rows = cells.length ? Math.max(...cells.map((c) => c.customData.row)) + 1 : 0;
  const cols = cells.length ? Math.max(...cells.map((c) => c.customData.col)) + 1 : 0;
  return { cells, rows, cols };
}

/** The table cell an element belongs to (a cell, or the text inside one). */
export function cellFor(el, map) {
  const c = el?.type === "text" && el.containerId ? map.get(el.containerId) : el;
  return isCell(c) ? c : null;
}

/**
 * The size most cells in a line share, unless one was changed: then that one wins, so resizing any
 * cell resizes its whole column or row. Ties go to the bigger size.
 */
function pick(sizes) {
  const counts = new Map();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size === 1) return sizes[0];
  return [...counts].sort((a, b) => a[1] - b[1] || b[0] - a[0])[0][0];
}

const near = (a, b) => Math.abs(a - b) < 0.5;

/**
 * Line every table back up: same width down a column, same height along a row (tall enough for the
 * tallest text), cells edge to edge from the first cell's corner. Returns { elements, measure }, with
 * the same array when nothing moved; `measure` means text has to re-wrap to a new cell width.
 */
export function relayoutTables(elements) {
  const tables = new Set(elements.filter(isCell).map((e) => e.customData.table));
  if (!tables.size) return { elements, measure: false };
  const map = byId(elements);
  const changes = new Map();
  let measure = false;
  for (const table of tables) {
    const { cells, rows, cols } = cellsOf(elements, table);
    const widths = [];
    const heights = [];
    for (let c = 0; c < cols; c++) {
      const col = cells.filter((e) => e.customData.col === c);
      widths[c] = col.length ? Math.max(24, pick(col.map((e) => e.width))) : CELL_W;
    }
    for (let r = 0; r < rows; r++) {
      const row = cells.filter((e) => e.customData.row === r);
      const fit = Math.max(0, ...row.map((e) => (textOf(e, map)?.height ?? 0) + TEXT_INSET * 2));
      heights[r] = row.length ? Math.max(fit, pick(row.map((e) => e.height))) : CELL_H;
    }
    const first = [...cells].sort((a, b) => a.customData.row - b.customData.row || a.customData.col - b.customData.col)[0];
    const sum = (arr, n) => arr.slice(0, n).reduce((s, v) => s + v, 0);
    const x0 = first.x - sum(widths, first.customData.col);
    const y0 = first.y - sum(heights, first.customData.row);
    for (const cell of cells) {
      const { row, col } = cell.customData;
      const want = { x: x0 + sum(widths, col), y: y0 + sum(heights, row), width: widths[col], height: heights[row] };
      const t = textOf(cell, map);
      if (!["x", "y", "width", "height"].every((k) => near(cell[k], want[k]))) changes.set(cell.id, want);
      if (!t) continue;
      const widthChanged = !near(cell.width, want.width);
      if (widthChanged) measure = true;
      const tw = widthChanged ? Math.min(t.width, want.width - TEXT_INSET * 2) : t.width;
      const tx =
        t.textAlign === "center" ? want.x + (want.width - tw) / 2 : t.textAlign === "right" ? want.x + want.width - TEXT_INSET - tw : want.x + TEXT_INSET;
      const ty = want.y + (want.height - t.height) / 2;
      if (widthChanged) changes.set(t.id, { x: tx, y: ty, width: tw, text: t.originalText ?? t.text });
      else if (!near(t.x, tx) || !near(t.y, ty)) changes.set(t.id, { x: tx, y: ty });
    }
  }
  if (!changes.size) return { elements, measure: false };
  return { elements: elements.map((e) => (changes.has(e.id) ? touch(e, changes.get(e.id)) : e)), measure };
}

const textOf = (cell, map) => {
  const ref = cell.boundElements?.find((b) => b.type === "text");
  const t = ref && map.get(ref.id);
  return t && !t.isDeleted ? t : null;
};

/** Renumber a table's cells in one direction (`axis` "row" or "col") with `fn(index) → new index | null`; null deletes. */
function renumber(elements, table, axis, fn) {
  const map = byId(elements);
  const gone = new Set();
  const moved = new Map();
  for (const el of elements) {
    if (!isCell(el) || el.customData.table !== table) continue;
    const n = fn(el.customData[axis]);
    if (n === null) {
      gone.add(el.id);
      const t = textOf(el, map);
      if (t) gone.add(t.id);
    } else if (n !== el.customData[axis]) moved.set(el.id, n);
  }
  return elements.map((el) =>
    gone.has(el.id)
      ? touch(el, { isDeleted: true })
      : moved.has(el.id)
        ? touch(el, { customData: { ...el.customData, [axis]: moved.get(el.id) } })
        : el,
  );
}

/** Add a row above or below the cell's row (`after` = below). Returns { elements, id } with the new cell under the old one. */
export function addRow(elements, cellId, after = true, theme) {
  const map = byId(elements);
  const cell = cellFor(map.get(cellId), map);
  if (!cell) return { elements, id: null };
  const { table, row } = cell.customData;
  const at = after ? row + 1 : row;
  let out = renumber(elements, table, "row", (r) => (r >= at ? r + 1 : r));
  const { cells, cols } = cellsOf(out, table);
  const ref = cells.filter((c) => c.customData.row === row + (after ? 0 : 1));
  let id = null;
  for (let c = 0; c < cols; c++) {
    const above = ref.find((e) => e.customData.col === c);
    const x = above?.x ?? cell.x;
    const y = after ? cell.y + cell.height : cell.y;
    const made = newCell(table, at, c, x, y, above?.width ?? CELL_W, CELL_H, theme, cell.groupIds);
    if (c === cell.customData.col) id = made[0].id;
    out = [...out, ...made];
  }
  return { elements: relayoutTables(out).elements, id };
}

/** Add a column left or right of the cell's column (`after` = right). */
export function addColumn(elements, cellId, after = true, theme) {
  const map = byId(elements);
  const cell = cellFor(map.get(cellId), map);
  if (!cell) return { elements, id: null };
  const { table, col } = cell.customData;
  const at = after ? col + 1 : col;
  let out = renumber(elements, table, "col", (c) => (c >= at ? c + 1 : c));
  const { cells, rows } = cellsOf(out, table);
  const ref = cells.filter((c) => c.customData.col === col + (after ? 0 : 1));
  let id = null;
  for (let r = 0; r < rows; r++) {
    const beside = ref.find((e) => e.customData.row === r);
    const x = after ? cell.x + cell.width : cell.x;
    const made = newCell(table, r, at, x, beside?.y ?? cell.y, CELL_W, beside?.height ?? CELL_H, theme, cell.groupIds);
    if (r === cell.customData.row) id = made[0].id;
    out = [...out, ...made];
  }
  return { elements: relayoutTables(out).elements, id };
}

/** Delete the cell's row or column (`axis` "row" | "col"). The last one deletes the whole table. */
export function removeLine(elements, cellId, axis) {
  const map = byId(elements);
  const cell = cellFor(map.get(cellId), map);
  if (!cell) return elements;
  const { table } = cell.customData;
  const at = cell.customData[axis];
  return relayoutTables(renumber(elements, table, axis, (n) => (n === at ? null : n > at ? n - 1 : n))).elements;
}

/** The cell next to `cellId` in reading order (`step` 1 or -1), or null at either end. */
export function nextCell(elements, cellId, step = 1) {
  const map = byId(elements);
  const cell = cellFor(map.get(cellId), map);
  if (!cell) return null;
  const { cells } = cellsOf(elements, cell.customData.table);
  const order = cells.sort((a, b) => a.customData.row - b.customData.row || a.customData.col - b.customData.col);
  return order[order.findIndex((c) => c.id === cell.id) + step] ?? null;
}

/** A table's text as rows of cells, for outlines and copying. */
export function tableRows(elements, table) {
  const map = byId(elements);
  const { cells, rows, cols } = cellsOf(elements, table);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(""));
  for (const c of cells) grid[c.customData.row][c.customData.col] = (textOf(c, map)?.originalText ?? "").replace(/\n/g, " ").trim();
  return grid;
}

/* ---------- text tables inside a note ---------- */

const isRow = (line) => line.includes("|");
const isRule = (cells) => cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));

const split = (line) => {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
};

/** Whether the text has a table: two or more lines in a row with a "|" in them. */
export const hasTextTable = (text) => {
  const lines = text.split("\n");
  return lines.some((l, i) => isRow(l) && i + 1 < lines.length && isRow(lines[i + 1]));
};

/** Format rows of cells as an aligned Markdown table (with a rule under the first row). */
export function markdownTable(rows, aligns = []) {
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => [...r, ...Array(cols - r.length).fill("")]);
  const w = Array.from({ length: cols }, (_, c) => Math.max(3, ...grid.map((r) => [...r[c]].length)));
  const pad = (s, c) => {
    const gap = w[c] - [...s].length;
    if (aligns[c] === "right") return " ".repeat(gap) + s;
    if (aligns[c] === "center") return " ".repeat(gap >> 1) + s + " ".repeat(gap - (gap >> 1));
    return s + " ".repeat(gap);
  };
  const line = (r) => `| ${r.map(pad).join(" | ")} |`;
  const rule = `|${w.map((n, c) => (aligns[c] === "center" ? `:${"-".repeat(n)}:` : aligns[c] === "right" ? `${"-".repeat(n + 1)}:` : "-".repeat(n + 2))).join("|")}|`;
  return [line(grid[0]), rule, ...grid.slice(1).map(line)].join("\n");
}

/** Line up every table in a note's text. Returns the same string when there's nothing to change. */
export function formatTextTables(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && isRow(lines[j])) j++;
    if (j - i < 2) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const rows = lines.slice(i, j).map(split);
    const ruleAt = rows.findIndex(isRule);
    const aligns =
      ruleAt >= 0
        ? rows[ruleAt].map((c) => {
            const t = c.trim();
            return t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : "left";
          })
        : [];
    out.push(markdownTable(rows.filter((r) => !isRule(r)), aligns));
    i = j;
  }
  const next = out.join("\n");
  return next === text ? text : next;
}

/** A blank rows × cols text table, ready to fill in. */
export const blankTextTable = (rows = 3, cols = 3) =>
  markdownTable([Array.from({ length: cols }, (_, c) => `Col ${c + 1}`), ...Array.from({ length: rows - 1 }, () => Array(cols).fill(""))]);

/**
 * Tidy a note's text table after editing: align it, switch the note to the monospace font so it
 * lines up, and back to the normal font when the table is gone. Returns the changes for the text element, or null.
 */
export function tidyTextTable(el) {
  const original = el.originalText ?? el.text ?? "";
  const table = hasTextTable(original);
  if (!table && !el.customData?.textTable) return null;
  const text = table ? formatTextTables(original) : original;
  const fontFamily = table ? MONO : el.customData?.font ?? FONT;
  if (text === original && fontFamily === el.fontFamily && !!el.customData?.textTable === table) return null;
  const { textTable: _t, font: _f, ...rest } = el.customData ?? {};
  return {
    text,
    originalText: text,
    fontFamily,
    lineHeight: LINE_HEIGHT,
    customData: table ? { ...rest, textTable: true, font: el.customData?.font ?? el.fontFamily } : rest,
  };
}

/** Roughly how wide a monospace line is, so a note can be made wide enough for its table. */
export const monoWidth = (text, fontSize) => Math.max(...text.split("\n").map((l) => [...l].length)) * fontSize * 0.6;
