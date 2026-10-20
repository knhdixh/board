// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { byId, newRect, newText } from "../src/scapple/elements.js";
import { exitPoint, findConnector, noteAt, rerouteBound, toggleConnection } from "../src/scapple/connect.js";
import { row, separate, stack, units } from "../src/scapple/layout.js";
import { STYLES, applyStyle, fitContainers, styleFromNote } from "../src/scapple/styles.js";
import { DEFAULT_THEME, THEMES, retheme, themeFor } from "../src/scapple/themes.js";
import { PAD, touch } from "../src/scapple/elements.js";
const style = (k) => STYLES.find((s) => s.key === k);
const paint = (els, ids, k, theme = DEFAULT_THEME) => applyStyle(els, ids, style(k), theme).elements;
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
    expect(arrow.strokeColor).toBe(DEFAULT_THEME.line);
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
    els = paint(els, [a.id], "yellow");
    const map = byId(els);
    const text = map.get(a.id);
    const rect = map.get(text.containerId);
    expect(rect.type).toBe("rectangle");
    expect(rect.backgroundColor).toBe(DEFAULT_THEME.fills.yellow);
    const arrow = els.find((e) => e.type === "arrow");
    expect(arrow.startBinding.elementId).toBe(rect.id);
    expect(rect.boundElements.map((x) => x.id)).toContain(arrow.id);
    // Applying again restyles the same bubble rather than nesting another one.
    const again = paint(els, [a.id], "bubble");
    expect(live(again).filter((e) => e.type === "rectangle")).toHaveLength(1);
    expect(byId(again).get(rect.id).strokeColor).toBe(DEFAULT_THEME.ink);
  });

  it("keeps bubbles of stacked notes from overlapping", () => {
    const a = note("a", 0, 0);
    const b = note("b", 0, 28);
    const els = paint([a, b], [a.id, b.id], "bubble");
    const [r1, r2] = live(els).filter((e) => e.type === "rectangle").sort((p, q) => p.y - q.y);
    expect(r2.y).toBeGreaterThanOrEqual(r1.y + r1.height);
    const t2 = byId(els).get(r2.boundElements.find((x) => x.type === "text").id);
    expect(t2.y - r2.y).toBe(PAD); // text moved with its bubble
  });

  it("grows a shape to fit re-measured text and centres it", () => {
    const box = newRect({ x: 0, y: 0, width: 50, height: 30 });
    const t = newText({ text: "long", x: 0, y: 0, width: 100, height: 40, containerId: box.id, textAlign: "center" });
    box.boundElements = [{ id: t.id, type: "text" }];
    const out = byId(fitContainers([box, t]));
    expect(out.get(box.id)).toMatchObject({ width: 100 + PAD * 2, height: 40 + PAD * 2 });
    expect(out.get(t.id)).toMatchObject({ x: PAD, y: PAD });
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

describe("background shapes", () => {
  it("wraps selected notes in a magnetic shape behind them", async () => {
    const { addBackground, contentsOf, isBackground } = await import("../src/scapple/background.js");
    const a = note("a", 100, 100);
    const b = note("b", 300, 100);
    const outside = note("far", 900, 900);
    let els = toggleConnection([a, b, outside], a.id, b.id).elements;
    const { elements, id } = addBackground(els, [a.id, b.id]);
    expect(elements[0].id).toBe(id); // at the back
    expect(isBackground(elements[0])).toBe(true);
    expect(elements[0]).toMatchObject({ x: 76, y: 76, width: 328, height: 68 });
    const inside = contentsOf(elements, id);
    expect(inside.has(a.id) && inside.has(b.id)).toBe(true);
    expect(inside.has(outside.id)).toBe(false);
    expect(inside.has(elements.find((e) => e.type === "arrow").id)).toBe(true);
  });

  it("carries its notes when moved and re-routes links to notes elsewhere", async () => {
    const { addBackground, carry, contentsOf } = await import("../src/scapple/background.js");
    const a = note("a", 100, 100);
    const far = note("far", 100, 600);
    let els = toggleConnection([a, far], a.id, far.id).elements;
    const r = addBackground(els, [a.id]);
    els = r.elements;
    const ids = contentsOf(els, r.id);
    const moved = byId(carry(els, els, ids, 200, 0));
    expect(moved.get(a.id).x).toBe(300);
    expect(moved.get(far.id).x).toBe(100);
    const arrow = [...moved.values()].find((e) => e.type === "arrow");
    expect(arrow.x).toBeGreaterThan(250); // starts at the moved note now
  });

  it("imported Scapple shapes are magnetic", () => {
    const els = importScapple(SCAP);
    expect(els[0].customData).toEqual({ background: true });
  });
});

describe("same width", () => {
  it("gives notes the widest width", async () => {
    const { sameWidth } = await import("../src/scapple/layout.js");
    const a = note("a", 0, 0, 50);
    const b = note("b", 0, 100, 140);
    const out = byId(sameWidth([a, b], [a.id, b.id]));
    expect(out.get(a.id)).toMatchObject({ width: 140, autoResize: false });
  });
});

describe("scapple export", () => {
  it("round-trips notes, fills, arrows and background shapes", async () => {
    const { exportScapple } = await import("../src/scapple/scap.js");
    const xml = exportScapple(importScapple(SCAP));
    const again = importScapple(xml);
    const texts = again.filter((e) => e.type === "text").map((t) => t.text).sort();
    expect(texts).toEqual(["Consequence", "Main idea", "Side thought"]);
    const arrows = again.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(2);
    expect(arrows.filter((a) => a.endArrowhead || a.startArrowhead)).toHaveLength(1);
    expect(again.find((e) => e.customData?.background)).toMatchObject({ x: expect.closeTo(80 * 4 / 3, 0), width: expect.closeTo(500 * 4 / 3, 0) });
    const main = again.find((e) => e.text === "Main idea");
    expect(byId(again).get(main.containerId).backgroundColor).toBe("#fff2bf");
  });

  it("escapes text", async () => {
    const { exportScapple } = await import("../src/scapple/scap.js");
    const xml = exportScapple([note("a < b & \"c\"", 0, 0)]);
    expect(importScapple(xml).find((e) => e.type === "text").text).toBe('a < b & "c"');
  });
});

describe("copy as text", () => {
  it("outlines only the selection", async () => {
    const { selectionOutline } = await import("../src/scapple/outline.js");
    const a = note("parent", 0, 0);
    const b = note("child", 0, 100);
    const c = note("not selected", 0, 200);
    const els = toggleConnection([a, b, c], a.id, b.id, { arrow: true }).elements;
    expect(selectionOutline(els, [a.id, b.id])).toBe("- parent\n  - child\n");
  });
});

describe("usage dashboard", () => {
  it("compares usage with free-tier limits", async () => {
    const { rows, bytes, pctLabel } = await import("../src/usageRows.js");
    const now = Date.parse("2026-10-20T12:00:00Z");
    const r = rows(
      {
        db_bytes: 50 * 1024 * 1024,
        active_users_30d: 1,
        storage_bytes: 0,
        month: { supabase_bytes: 512 * 1024 * 1024, vercel_bytes: 0, visits: 3 },
        heartbeats: { "vercel-cron": { at: "2026-10-20T06:00:00Z", count: 4 }, app: { at: "2026-10-19T12:00:00Z", count: 9 } },
      },
      now,
    );
    const db = r.supabase.find((x) => x.label === "Database");
    expect(db.p).toBe(10);
    expect(db.used).toBe("50 MB");
    expect(r.supabase.find((x) => x.label === "Egress").p).toBe(10);
    const idle = r.supabase.find((x) => x.label === "Idle time");
    expect(idle.used).toBe("0.3 d"); // the newest ping counts
    expect(idle.note).toBe("last ping 6 h ago");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(pctLabel(0.002)).toBe("<0.1%");
  });

  it("treats a project with no pings as about to pause", async () => {
    const { rows } = await import("../src/usageRows.js");
    const r = rows({ db_bytes: 0, active_users_30d: 0, storage_bytes: 0, month: { supabase_bytes: 0, vercel_bytes: 0, visits: 0 }, heartbeats: {} });
    expect(r.supabase.find((x) => x.label === "Idle time").p).toBe(100);
  });
});

describe("themes", () => {
  it("defaults to cream paper and finds presets by colour", () => {
    expect(DEFAULT_THEME.bg).toBe("#fffcf1");
    expect(themeFor("#1D3557").key).toBe("blueprint");
  });

  it("gives any custom colour readable text", () => {
    expect(themeFor("#101418").ink).toBe(THEMES.find((t) => t.key === "night").ink);
    expect(themeFor("#ffe8f0").ink).toBe(DEFAULT_THEME.ink);
  });

  it("recolours theme colours and keeps colours you chose", () => {
    const a = note("a", 0, 0);
    a.strokeColor = "#1e1e1e"; // Excalidraw's default ink = the white theme's
    const b = note("b", 300, 0);
    b.strokeColor = "#e8590c"; // picked by hand
    let els = toggleConnection([a, b], a.id, b.id, { theme: THEMES[1] }).elements;
    els = paint(els, [a.id], "yellow", THEMES[1]);
    const night = THEMES.find((t) => t.key === "night");
    const out = retheme(els, night, touch);
    const map = byId(out);
    expect(map.get(a.id).strokeColor).toBe(night.ink);
    expect(map.get(b.id).strokeColor).toBe("#e8590c");
    expect(out.find((e) => e.type === "arrow").strokeColor).toBe(night.line);
    expect(map.get(map.get(a.id).containerId).backgroundColor).toBe(night.fills.yellow);
    expect(retheme(out, night, touch)).toBe(out); // nothing left to change
  });

  it("tells a background shape's fill from a grey note with the same colour", async () => {
    const { addBackground } = await import("../src/scapple/background.js");
    const white = THEMES[1];
    const a = note("a", 0, 0);
    let els = paint([a], [a.id], "grey", white);
    els = addBackground(els, [a.id], white).elements;
    const sage = THEMES.find((t) => t.key === "sage");
    const out = retheme(els, sage, touch);
    expect(out[0].backgroundColor).toBe(sage.shape);
    expect(out.find((e) => e.type === "rectangle" && !e.customData).backgroundColor).toBe(sage.fills.grey);
  });
});

describe("styles", () => {
  it("title and faded change the text but keep the shape", () => {
    const a = note("a", 0, 0);
    const r = applyStyle([a], [a.id], style("title"), DEFAULT_THEME);
    expect(r.measure).toBe(true);
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0].fontSize).toBe(28);
    const f = paint([a], [a.id], "faded");
    expect(f[0].strokeColor).toBe(DEFAULT_THEME.line);
  });

  it("saves a note's look as a style and applies it elsewhere", () => {
    const a = note("a", 0, 0);
    let els = paint([a], [a.id], "dashed");
    const saved = styleFromNote(els, a.id, "My dashed");
    expect(saved.resolved.shape.strokeStyle).toBe("dashed");
    const b = note("b", 0, 200);
    const out = applyStyle([...els, b], [b.id], saved, THEMES[4]).elements;
    const bt = byId(out).get(b.id);
    expect(byId(out).get(bt.containerId).strokeStyle).toBe("dashed");
  });
});

describe("magnetic stacks", () => {
  it("pushes the notes below down when a note grows, and pulls them up when one is deleted", async () => {
    const { boxesOf, restack } = await import("../src/scapple/stacks.js");
    const a = note("a", 0, 0, 80, 20);
    const b = note("b", 0, 28, 80, 20);
    const c = note("c", 0, 56, 80, 20);
    const side = note("side", 300, 30, 80, 20);
    const before = boxesOf([a, b, c, side]);
    const grown = restack(before, [{ ...a, height: 60 }, b, c, side]);
    const g = byId(grown);
    expect(g.get(b.id).y).toBe(68);
    expect(g.get(c.id).y).toBe(96);
    expect(g.get(side.id).y).toBe(30);

    const gone = byId(restack(before, [a, { ...b, isDeleted: true }, c, side]));
    expect(gone.get(c.id).y).toBe(28);
  });

  it("leaves notes alone when one is just dragged", async () => {
    const { boxesOf, restack } = await import("../src/scapple/stacks.js");
    const a = note("a", 0, 0, 80, 20);
    const b = note("b", 0, 28, 80, 20);
    const els = [{ ...a, x: 400, height: 60 }, b];
    expect(restack(boxesOf([a, b]), els)).toBe(els);
  });
});

describe("notes list", () => {
  it("lists notes in reading order and replaces text", async () => {
    const { listNotes, findNotes, replaceInNotes } = await import("../src/scapple/notes.js");
    const a = note("Second Coffee", 0, 100);
    const b = note("first coffee", 0, 0);
    const els = toggleConnection([a, b], a.id, b.id).elements;
    const list = listNotes(els);
    expect(list.map((n) => n.text)).toEqual(["first coffee", "Second Coffee"]);
    expect(list[0].links).toBe(1);
    expect(findNotes(list, "SECOND")).toHaveLength(1);
    const r = replaceInNotes(els, "coffee", "tea");
    expect(r.count).toBe(2);
    expect(listNotes(r.elements).map((n) => n.text)).toEqual(["first tea", "Second tea"]);
  });
});
