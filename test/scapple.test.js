// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { byId, newRect, newText } from "../src/scapple/elements.js";
import { exitPoint, findConnector, noteAt, rerouteBound, toggleConnection } from "../src/scapple/connect.js";
import { row, separate, stack, units } from "../src/scapple/layout.js";
import { applyStyle, fitContainers } from "../src/scapple/styles.js";
import { color, importScapple, parseIds } from "../src/scapple/scap.js";
import { outline } from "../src/scapple/outline.js";

const note = (text, x, y, w = 80, h = 20) => newText({ text, originalText: text, x, y, width: w, height: h });
const live = (els) => els.filter((e) => !e.isDeleted);

describe("connections", () => {
  it("finds the topmost note under a point, skipping excluded and bound text", () => {
    const a = note("a", 0, 0);
    const box = newRect({ x: 200, y: 0, width: 100, height: 60 });
    const inner = newText({ text: "in", x: 210, y: 10, width: 40, height: 20, containerId: box.id });
    const els = [a, box, inner];
    expect(noteAt(els, { x: 10, y: 10 })?.id).toBe(a.id);
    expect(noteAt(els, { x: 215, y: 15 })?.id).toBe(box.id); // text → its shape
    expect(noteAt(els, { x: 10, y: 10 }, new Set([a.id]))).toBeNull();
    expect(noteAt(els, { x: 150, y: 10 })).toBeNull();
  });

  it("connects two notes with a dotted line, then disconnects on the second drop", () => {
    const a = note("a", 0, 0);
    const b = note("b", 300, 0);
    const first = toggleConnection([a, b], a.id, b.id);
    expect(first.action).toBe("connected");
    const arrow = first.elements.find((e) => e.type === "arrow");
    expect(arrow.strokeStyle).toBe("dotted");
    expect(arrow.endArrowhead).toBeNull();
    expect(arrow.startBinding.elementId).toBe(a.id);
    expect(arrow.endBinding.elementId).toBe(b.id);
    const map = byId(first.elements);
    expect(map.get(a.id).boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
    expect(map.get(b.id).boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
    // The line runs between the boxes, not through them.
    expect(arrow.x).toBeGreaterThanOrEqual(80);
    expect(arrow.x + arrow.points[1][0]).toBeLessThanOrEqual(300);

    // Dropping b onto a removes the same connection.
    const second = toggleConnection(first.elements, b.id, a.id);
    expect(second.action).toBe("disconnected");
    expect(live(second.elements).some((e) => e.type === "arrow")).toBe(false);
    expect(byId(second.elements).get(a.id).boundElements).toEqual([]);
  });

  it("draws a solid arrow when asked", () => {
    const a = note("a", 0, 0);
    const b = note("b", 0, 200);
    const { elements } = toggleConnection([a, b], a.id, b.id, { arrow: true });
    const arrow = elements.find((e) => e.type === "arrow");
    expect(arrow.endArrowhead).toBe("arrow");
    expect(arrow.strokeStyle).toBe("solid");
    expect(findConnector(elements, b.id, a.id)?.id).toBe(arrow.id);
  });

  it("exitPoint leaves the box on the side facing the target", () => {
    const p = exitPoint({ x: 0, y: 0, w: 100, h: 20 }, { x: 500, y: 10 }, 0);
    expect(p).toEqual({ x: 100, y: 10 });
  });

  it("re-routes arrows when a note moves", () => {
    const a = note("a", 0, 0);
    const b = note("b", 300, 0);
    let els = toggleConnection([a, b], a.id, b.id).elements;
    els = els.map((e) => (e.id === b.id ? { ...e, y: 400 } : e));
    els = rerouteBound(els, new Set([b.id]));
    const arrow = els.find((e) => e.type === "arrow");
    const endY = arrow.y + arrow.points[1][1];
    expect(endY).toBeGreaterThan(300);
  });
});

describe("layout", () => {
  it("stacks notes into a left-aligned column in vertical order", () => {
    const a = note("a", 50, 100);
    const b = note("b", 10, 0);
    const c = note("c", 90, 300);
    const out = byId(stack([a, b, c], [a.id, b.id, c.id]));
    expect(out.get(b.id)).toMatchObject({ x: 10, y: 0 });
    expect(out.get(a.id)).toMatchObject({ x: 10, y: 28 });
    expect(out.get(c.id)).toMatchObject({ x: 10, y: 56 });
  });

  it("moves a shape together with its text", () => {
    const box = newRect({ x: 0, y: 500, width: 100, height: 40 });
    const inner = newText({ text: "x", x: 10, y: 510, width: 20, height: 20, containerId: box.id });
    box.boundElements = [{ id: inner.id, type: "text" }];
    const a = note("a", 0, 0);
    expect(units([a, box, inner], [box.id, a.id])).toHaveLength(2);
    const out = byId(stack([a, box, inner], [a.id, inner.id]));
    expect(out.get(box.id).y).toBe(28);
    expect(out.get(inner.id).y).toBe(38);
  });

  it("separates overlapping notes downwards", () => {
    const a = note("a", 0, 0);
    const b = note("b", 10, 5);
    const out = byId(separate([a, b], [a.id, b.id]));
    expect(out.get(b.id).y).toBe(28);
    expect(out.get(a.id).y).toBe(0);
  });

  it("lays notes out in a row", () => {
    const a = note("a", 0, 0);
    const b = note("b", 500, 90);
    const out = byId(row([a, b], [a.id, b.id]));
    expect(out.get(b.id)).toMatchObject({ x: 104, y: 0 });
  });
});

describe("styles", () => {
  it("wraps free text in a bubble and moves its connections to the bubble", () => {
    const a = note("a", 0, 0);
    const b = note("b", 300, 0);
    let els = toggleConnection([a, b], a.id, b.id).elements;
    els = applyStyle(els, [a.id], "yellow");
    const map = byId(els);
    const text = map.get(a.id);
    const rect = map.get(text.containerId);
    expect(rect.type).toBe("rectangle");
    expect(rect.backgroundColor).toBe("#fff3bf");
    const arrow = els.find((e) => e.type === "arrow");
    expect(arrow.startBinding.elementId).toBe(rect.id);
    expect(rect.boundElements.map((x) => x.id)).toContain(arrow.id);
    // Applying again restyles the same bubble rather than nesting another one.
    const again = applyStyle(els, [a.id], "bubble");
    expect(live(again).filter((e) => e.type === "rectangle")).toHaveLength(1);
    expect(byId(again).get(rect.id).strokeColor).toBe("#1e1e1e");
  });

  it("keeps bubbles of stacked notes from overlapping", () => {
    const a = note("a", 0, 0);
    const b = note("b", 0, 28);
    const els = applyStyle([a, b], [a.id, b.id], "bubble");
    const [r1, r2] = live(els).filter((e) => e.type === "rectangle").sort((p, q) => p.y - q.y);
    expect(r2.y).toBeGreaterThanOrEqual(r1.y + r1.height);
    const t2 = byId(els).get(r2.boundElements.find((x) => x.type === "text").id);
    expect(t2.y - r2.y).toBe(12); // text moved with its bubble
  });

  it("grows a shape to fit re-measured text and centres it", () => {
    const box = newRect({ x: 0, y: 0, width: 50, height: 30 });
    const t = newText({ text: "long", x: 0, y: 0, width: 100, height: 40, containerId: box.id, textAlign: "center" });
    box.boundElements = [{ id: t.id, type: "text" }];
    const out = byId(fitContainers([box, t]));
    expect(out.get(box.id)).toMatchObject({ width: 124, height: 64 });
    expect(out.get(t.id)).toMatchObject({ x: 12, y: 12 });
  });
});

const SCAP = readFileSync("test/fixtures/sample.scap", "utf8");

describe("scapple import", () => {
  it("parses id ranges and colours", () => {
    expect(parseIds("1, 3-5,7")).toEqual([1, 3, 4, 5, 7]);
    expect(parseIds("")).toEqual([]);
    expect(color("1.0 0.5 0.0")).toBe("#ff8000");
    expect(color("nope")).toBeNull();
  });

  it("imports notes, bubbles, background shapes and one connector per pair", () => {
    const els = importScapple(SCAP);
    const map = byId(els);
    const texts = els.filter((e) => e.type === "text");
    expect(texts.map((t) => t.text).sort()).toEqual(["Consequence", "Main idea", "Side thought"]);
    const main = texts.find((t) => t.text === "Main idea");
    const bubble = map.get(main.containerId);
    expect(bubble.backgroundColor).toBe("#fff2bf");
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(2);
    const pointed = arrows.find((a) => a.endArrowhead === "arrow");
    expect(pointed.startBinding.elementId).toBe(bubble.id);
    expect(map.get(pointed.endBinding.elementId).text).toBe("Consequence");
    expect(arrows.find((a) => a !== pointed).strokeStyle).toBe("dotted");
    // Background shape is first (behind everything).
    const pt = 4 / 3;
    expect(els[0]).toMatchObject({ type: "rectangle", x: 80 * pt, y: 20 * pt, width: 500 * pt, height: 320 * pt });
    // Notes are at least as wide as their longest word.
    const side = texts.find((t) => t.text === "Side thought");
    expect(side.width).toBeGreaterThanOrEqual(7 * 16 * 0.62);
  });

  it("rejects other XML", () => {
    expect(() => importScapple("<svg/>")).toThrow(/Scapple/);
  });
});

describe("outline", () => {
  it("nests notes under what they hang from", () => {
    const els = importScapple(SCAP);
    expect(outline(els, "ideas")).toBe("# ideas\n\n- Main idea\n  - Side thought\n  - Consequence\n");
  });

  it("lists unconnected notes in reading order", () => {
    const md = outline([note("second", 0, 100), note("first\nmore", 0, 0)]);
    expect(md).toBe("- first\n  more\n- second\n");
  });
});
