// Import Scapple documents (.scap, plain XML) as Excalidraw elements.
import { INK, LINE_HEIGHT, PAD, byId, newArrow, newRect, newText, touch } from "./elements.js";
import { routeArrow } from "./connect.js";

const num = (s, d = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : d;
};

/** "1, 3-5" → [1, 3, 4, 5] */
export function parseIds(s) {
  if (!s) return [];
  const out = [];
  for (const part of s.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    for (let i = a; i <= b && i - a < 10000; i++) out.push(i);
  }
  return out;
}

/** "0.5 0.25 1.0" (0–1 floats) → "#8040ff" */
export function color(s) {
  if (!s) return null;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return "#" + parts.slice(0, 3).map((p) => Math.round(Math.max(0, Math.min(1, p)) * 255).toString(16).padStart(2, "0")).join("");
}

const PT = 4 / 3; // Scapple measures in points; Excalidraw in pixels

const point = (s) => {
  const [x, y] = (s ?? "").split(",").map((v) => num(v));
  return { x: (x || 0) * PT, y: (y || 0) * PT };
};

const child = (el, name) => [...el.children].find((c) => c.tagName === name) ?? null;
const childText = (el, name) => child(el, name)?.textContent ?? "";

/** Rough text height before Excalidraw measures it properly. */
function estimateHeight(text, width, fontSize) {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * fontSize * LINE_HEIGHT;
}

/**
 * Parse a .scap file. Returns Excalidraw elements: notes (free text, or text in a shape when the
 * note has a border or fill), background shapes behind them, and connections.
 * `parse` is injectable so this runs under node tests too.
 */
export function importScapple(xml, parse = (s) => new DOMParser().parseFromString(s, "application/xml")) {
  const doc = parse(xml);
  const root = doc.documentElement;
  if (!root || root.tagName !== "ScappleDocument") throw new Error("Not a Scapple file");

  const notes = new Map(); // scapple id → element id
  const background = [];
  const front = [];
  const pending = [];

  const shapes = child(root, "BackgroundShapes");
  for (const s of shapes ? [...shapes.children] : []) {
    const pos = point(s.getAttribute("Position"));
    const app = child(s, "Appearance");
    const fill = color(app && childText(app, "Fill"));
    const border = app && child(app, "Border");
    const weight = border ? num(border.getAttribute("Weight"), 1) : 0;
    background.push(
      newRect({
        x: pos.x,
        y: pos.y,
        width: num(s.getAttribute("Width"), 200) * PT,
        height: num(s.getAttribute("Height"), 120) * PT,
        backgroundColor: fill ?? "transparent",
        strokeColor: weight ? color(border.textContent) ?? INK : "transparent",
        roundness: (s.getAttribute("Type") ?? "").includes("Rect") && !(s.getAttribute("Type") ?? "").includes("Rounded") ? null : { type: 3 },
        opacity: fill ? 60 : 100,
      }),
    );
    const title = childText(s, "String").trim();
    if (title) {
      background.push(newText({ x: pos.x + 10, y: pos.y + 8, text: title, originalText: title, fontSize: 14, strokeColor: "#868e96", width: title.length * 8, height: 18 }));
    }
  }

  const list = child(root, "Notes");
  for (const n of list ? [...list.children] : []) {
    if (n.tagName !== "Note") continue;
    const sid = n.getAttribute("ID");
    const pos = point(n.getAttribute("Position"));
    const fontSize = num(n.getAttribute("FontSize"), 12) * PT;
    const text = childText(n, "String");
    // Never narrower than the longest word, so words don't break in the middle.
    const longest = Math.max(0, ...text.split(/\s+/).map((w) => w.length)) * fontSize * 0.62;
    const width = Math.max(num(n.getAttribute("Width"), 200) * PT, longest);
    const app = child(n, "Appearance");
    const align = (app && childText(app, "Alignment").toLowerCase()) || "left";
    const fill = color(app && childText(app, "Fill"));
    const border = app && child(app, "Border");
    const weight = border ? num(border.getAttribute("Weight"), 0) : 0;
    const textColor = color(app && childText(app, "TextColor")) ?? INK;
    const height = estimateHeight(text, width, fontSize);
    const t = newText({
      x: pos.x,
      y: pos.y,
      width,
      height,
      text,
      originalText: text,
      fontSize,
      strokeColor: textColor,
      textAlign: ["left", "center", "right"].includes(align) ? align : "left",
      autoResize: false,
    });
    if (fill || weight) {
      const rect = newRect({
        x: pos.x - PAD,
        y: pos.y - PAD,
        width: width + PAD * 2,
        height: height + PAD * 2,
        backgroundColor: fill ?? "transparent",
        strokeColor: weight ? color(border.textContent) ?? INK : "transparent",
        strokeWidth: Math.max(1, Math.min(4, weight || 1)),
        roundness: (border?.getAttribute("Style") ?? "Rounded") === "Square" ? null : { type: 3 },
        boundElements: [{ id: t.id, type: "text" }],
      });
      front.push(rect, { ...t, containerId: rect.id, verticalAlign: "middle", autoResize: true });
      notes.set(sid, rect.id);
    } else {
      front.push(t);
      notes.set(sid, t.id);
    }
    pending.push({
      from: sid,
      connected: parseIds(childText(n, "ConnectedNoteIDs")).map(String),
      points: new Set(parseIds(childText(n, "PointsToNoteIDs")).map(String)),
    });
  }

  // Each connection is listed on both notes; collapse to one connector per pair.
  const pairs = new Map();
  for (const p of pending) {
    for (const to of p.connected) {
      if (!notes.has(to) || to === p.from) continue;
      const key = [p.from, to].sort().join("|");
      const pair = pairs.get(key) ?? { a: [p.from, to].sort()[0], b: [p.from, to].sort()[1], ab: false, ba: false };
      if (p.points.has(to)) pair[p.from === pair.a ? "ab" : "ba"] = true;
      pairs.set(key, pair);
    }
  }

  let elements = [...background, ...front];
  const arrows = [];
  for (const { a, b, ab, ba } of pairs.values()) {
    const from = notes.get(a);
    const to = notes.get(b);
    const directed = ab || ba;
    arrows.push(
      newArrow({
        strokeColor: directed ? INK : "#868e96",
        strokeStyle: directed ? "solid" : "dotted",
        startArrowhead: ba ? "arrow" : null,
        endArrowhead: ab ? "arrow" : null,
        startBinding: { elementId: from, focus: 0, gap: 6 },
        endBinding: { elementId: to, focus: 0, gap: 6 },
      }),
    );
  }
  const refs = new Map();
  for (const ar of arrows) {
    for (const id of [ar.startBinding.elementId, ar.endBinding.elementId]) {
      refs.set(id, [...(refs.get(id) ?? []), { id: ar.id, type: "arrow" }]);
    }
  }
  elements = elements.map((el) => (refs.has(el.id) ? touch(el, { boundElements: [...(el.boundElements ?? []), ...refs.get(el.id)] }) : el));
  const map = byId(elements);
  // Connectors sit between the background shapes and the notes.
  return [...background, ...arrows.map((ar) => routeArrow(ar, map)), ...elements.slice(background.length)];
}
