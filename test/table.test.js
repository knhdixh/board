// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { byId, touch } from "../src/scapple/elements.js";
import {
  MONO,
  addColumn,
  addRow,
  clearCells,
  fillCells,
  formatTextTables,
  hasTextTable,
  isCell,
  newTable,
  nextCell,
  relayoutTables,
  removeLine,
  tableOf,
  tableRows,
  tidyTextTable,
} from "../src/scapple/table.js";
import { boxesOf } from "../src/scapple/stacks.js";
import { outline } from "../src/scapple/outline.js";
import { importScapple } from "../src/scapple/scap.js";
import { restack } from "../src/scapple/stacks.js";
import { STYLES, applyStyle } from "../src/scapple/styles.js";
import { DEFAULT_THEME, THEMES, retheme } from "../src/scapple/themes.js";

const cells = (els) => els.filter(isCell);
const at = (els, row, col) => cells(els).find((c) => c.customData.row === row && c.customData.col === col);
const textIn = (els, cell) => byId(els).get(cell.boundElements[0].id);

describe("grid tables", () => {
  it("leaves boards without tables exactly as they are", () => {
    const elements = importScapple(readFileSync("test/fixtures/sample.scap", "utf8"));
    expect(relayoutTables(elements).elements).toBe(elements);
    expect(restack(boxesOf(elements), elements)).toBe(elements);
  });

  it("makes a grouped grid of empty cells, edge to edge", () => {
    const { elements, id } = newTable(100, 50, 2, 3);
    expect(cells(elements)).toHaveLength(6);
    expect(new Set(elements.map((e) => e.groupIds[0]))).toEqual(new Set([id]));
    expect(at(elements, 1, 2)).toMatchObject({ x: 100 + 240, y: 50 + 36 });
    expect(relayoutTables(elements).elements).toBe(elements);
  });

  it("a cell that grows makes its whole row taller and pushes the rows below down", () => {
    let { elements } = newTable(0, 0, 3, 2);
    const c = at(elements, 1, 0);
    elements = elements.map((e) => (e.id === c.id ? touch(e, { height: 80 }) : e));
    const out = relayoutTables(elements).elements;
    expect(at(out, 1, 1).height).toBe(80);
    expect(at(out, 2, 0).y).toBe(36 + 80);
  });

  it("resizing one cell resizes its column, even narrower", () => {
    let { elements } = newTable(0, 0, 3, 2);
    const c = at(elements, 2, 0);
    elements = elements.map((e) => (e.id === c.id ? touch(e, { width: 60 }) : e));
    const r = relayoutTables(elements);
    expect(at(r.elements, 0, 0).width).toBe(60);
    expect(at(r.elements, 0, 1).x).toBe(60);
    expect(r.measure).toBe(true);
  });

  it("adds and removes rows and columns", () => {
    let { elements } = newTable(0, 0, 2, 2);
    const r = addRow(elements, at(elements, 0, 1).id, true);
    elements = r.elements;
    expect(cells(elements)).toHaveLength(6);
    expect(byId(elements).get(r.id).customData).toMatchObject({ row: 1, col: 1 });
    expect(at(elements, 2, 0).y).toBe(72);
    elements = addColumn(elements, at(elements, 0, 0).id, false).elements;
    expect(cells(elements)).toHaveLength(9);
    expect(at(elements, 0, 1).x).toBe(120);
    elements = removeLine(elements, at(elements, 1, 1).id, "row");
    expect(cells(elements)).toHaveLength(6);
    elements = removeLine(elements, at(elements, 0, 0).id, "col");
    expect(cells(elements)).toHaveLength(4);
    expect(at(elements, 0, 1).x).toBe(at(elements, 0, 0).x + at(elements, 0, 0).width); // the rest stays put, still edge to edge
  });

  it("moves through cells in reading order", () => {
    const { elements } = newTable(0, 0, 2, 2);
    expect(nextCell(elements, at(elements, 0, 1).id).id).toBe(at(elements, 1, 0).id);
    expect(nextCell(elements, at(elements, 1, 1).id)).toBeNull();
    expect(nextCell(elements, at(elements, 0, 0).id, -1)).toBeNull();
  });

  it("writes tables as Markdown in the outline, and keeps them out of magnetic stacks", () => {
    let { elements } = newTable(0, 0, 2, 2);
    const id = tableOf(cells(elements)[0]);
    const fill = (row, col, text) => {
      const t = textIn(elements, at(elements, row, col));
      elements = elements.map((e) => (e.id === t.id ? touch(e, { text, originalText: text }) : e));
    };
    fill(0, 0, "Name");
    fill(0, 1, "Age");
    fill(1, 0, "Ann");
    fill(1, 1, "31");
    expect(tableRows(elements, id)).toEqual([["Name", "Age"], ["Ann", "31"]]);
    expect(outline(elements)).toContain("| Name | Age |\n|------|-----|\n| Ann  | 31  |");
    expect(boxesOf(elements).size).toBe(0);
  });
});

describe("tables with the rest of the board", () => {
  it("keeps a copied table apart from the original", () => {
    const { elements } = newTable(0, 0, 2, 2);
    const group = "copy-group";
    const copy = elements.map((e) => ({ ...e, id: e.id + "-copy", x: e.x + 500, groupIds: [group], boundElements: e.boundElements?.map((b) => ({ ...b, id: b.id + "-copy" })), containerId: e.containerId && e.containerId + "-copy" }));
    const both = [...elements, ...copy];
    expect(relayoutTables(both).elements).toBe(both); // neither is pulled onto the other
    const r = addRow(both, at(copy, 0, 0).id, true);
    expect(cells(r.elements).filter((c) => c.groupIds[0] === group)).toHaveLength(6);
    expect(cells(r.elements).filter((c) => c.groupIds[0] !== group)).toHaveLength(4);
  });

  it("a style fills a cell but keeps its border", () => {
    const { elements } = newTable(0, 0, 2, 2, DEFAULT_THEME);
    const c = at(elements, 0, 0);
    const yellow = applyStyle(elements, [c.id], STYLES.find((s) => s.key === "yellow"), DEFAULT_THEME).elements;
    expect(byId(yellow).get(c.id)).toMatchObject({ backgroundColor: DEFAULT_THEME.fills.yellow, strokeColor: c.strokeColor, roundness: null, x: c.x, y: c.y });
    const plain = applyStyle(yellow, [c.id], STYLES.find((s) => s.key === "plain"), DEFAULT_THEME).elements;
    expect(byId(plain).get(c.id)).toMatchObject({ backgroundColor: DEFAULT_THEME.bg, strokeColor: c.strokeColor });
  });

  it("cells are filled with the paper, and follow it to another theme", () => {
    const { elements } = newTable(0, 0, 1, 2, DEFAULT_THEME);
    expect(cells(elements).every((c) => c.backgroundColor === DEFAULT_THEME.bg)).toBe(true);
    const night = THEMES.find((t) => t.key === "night");
    const dark = retheme(elements, night, touch);
    expect(cells(dark).every((c) => c.backgroundColor === night.bg && c.strokeColor === night.line)).toBe(true);
    const old = elements.map((e) => (isCell(e) ? { ...e, backgroundColor: "transparent" } : e));
    expect(cells(fillCells(old, "#abcdef")).every((c) => c.backgroundColor === "#abcdef")).toBe(true);
  });

  it("Delete on a cell empties it and leaves the cell", () => {
    let { elements } = newTable(0, 0, 1, 2);
    const t = textIn(elements, at(elements, 0, 1));
    elements = elements.map((e) => (e.id === t.id ? touch(e, { text: "x", originalText: "x" }) : e));
    const out = clearCells(elements, [at(elements, 0, 1).id]);
    expect(cells(out)).toHaveLength(2);
    expect(textIn(out, at(out, 0, 1)).originalText).toBe("");
  });
});

describe("text tables", () => {
  it("lines up rows typed with pipes, adding a header rule", () => {
    expect(formatTextTables("Plan\nName|Age\nAnn | 31\nafter")).toBe("Plan\n| Name | Age |\n|------|-----|\n| Ann  | 31  |\nafter");
  });

  it("keeps column alignment from the rule and is stable", () => {
    const t = formatTextTables("| a | b |\n|:-:|--:|\n| long cell | 1 |");
    expect(t).toBe("|     a     |   b |\n|:---------:|----:|\n| long cell |   1 |");
    expect(formatTextTables(t)).toBe(t);
  });

  it("leaves single lines with a pipe alone", () => {
    expect(hasTextTable("this | that")).toBe(false);
    expect(formatTextTables("this | that")).toBe("this | that");
  });

  it("switches a note to monospace for its table, and back when the table goes", () => {
    const el = { type: "text", text: "a|b\nc|d", originalText: "a|b\nc|d", fontFamily: 9 };
    const on = tidyTextTable(el);
    expect(on).toMatchObject({ fontFamily: MONO, customData: { textTable: true, font: 9 } });
    expect(tidyTextTable({ ...el, ...on })).toBeNull();
    const off = tidyTextTable({ ...el, ...on, text: "just text", originalText: "just text" });
    expect(off).toMatchObject({ fontFamily: 9, customData: {} });
    expect(tidyTextTable({ type: "text", text: "plain", fontFamily: 9 })).toBeNull();
  });
});
