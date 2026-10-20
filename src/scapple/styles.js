// Note styles: plain text, a bubble, or a coloured fill. Free text is wrapped in a shape when it needs one.
import { PAD, boundTextOf, byId, newRect, noteFor, touch } from "./elements.js";
import { separate } from "./layout.js";

export const STYLES = [
  { key: "plain", label: "plain" },
  { key: "bubble", label: "bubble", stroke: "#1e1e1e" },
  { key: "yellow", label: "yellow", fill: "#fff3bf" },
  { key: "blue", label: "blue", fill: "#d0ebff" },
  { key: "green", label: "green", fill: "#d3f9d8" },
  { key: "red", label: "red", fill: "#ffe3e3" },
  { key: "grey", label: "grey", fill: "#f1f3f5" },
];

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

/** Put free text inside a rounded rectangle, moving its connections onto the new shape. */
export function wrapText(elements, textId) {
  const map = byId(elements);
  const text = map.get(textId);
  const rect = newRect({
    x: text.x - PAD,
    y: text.y - PAD,
    width: text.width + PAD * 2,
    height: text.height + PAD * 2,
    groupIds: text.groupIds,
    frameId: text.frameId,
    boundElements: [
      { id: text.id, type: "text" },
      ...(text.boundElements ?? []).filter((b) => b.type === "arrow"),
    ],
  });
  const arrows = new Set((text.boundElements ?? []).filter((b) => b.type === "arrow").map((b) => b.id));
  const rebind = (b) => (b?.elementId === text.id ? { ...b, elementId: rect.id } : b);
  const out = [];
  for (const el of elements) {
    if (el.id === text.id) {
      out.push(rect);
      out.push(
        touch(el, {
          containerId: rect.id,
          textAlign: "center",
          verticalAlign: "middle",
          autoResize: true,
          boundElements: null,
        }),
      );
    } else if (arrows.has(el.id)) {
      out.push(touch(el, { startBinding: rebind(el.startBinding), endBinding: rebind(el.endBinding) }));
    } else out.push(el);
  }
  return { elements: out, id: rect.id };
}

/** Apply a named style to every selected note. */
export function applyStyle(elements, selectedIds, key) {
  const style = STYLES.find((s) => s.key === key);
  if (!style) return elements;
  let out = elements;
  const map = byId(out);
  const targets = new Set();
  for (const id of selectedIds) {
    const el = noteFor(map.get(id), map);
    if (el && !el.isDeleted) targets.add(el.id);
  }
  for (const id of targets) {
    let el = byId(out).get(id);
    if (el.type === "text") {
      if (key === "plain") {
        out = out.map((e) => (e.id === id ? touch(e, { strokeColor: "#1e1e1e" }) : e));
        continue;
      }
      const wrapped = wrapText(out, id);
      out = wrapped.elements;
      el = byId(out).get(wrapped.id);
    }
    if (!SHAPES.has(el.type)) continue;
    const changes =
      key === "plain"
        ? { strokeColor: "transparent", backgroundColor: "transparent" }
        : style.fill
          ? { strokeColor: "transparent", backgroundColor: style.fill, fillStyle: "solid" }
          : { strokeColor: style.stroke, backgroundColor: "transparent", strokeWidth: 1 };
    out = out.map((e) => (e.id === el.id ? touch(e, { ...changes, roughness: 0 }) : e));
  }
  // New bubbles are bigger than the text they wrap; don't let them land on each other.
  const restyled = new Set(out.filter((e) => targets.has(e.id) || targets.has(e.boundElements?.find((b) => b.type === "text")?.id)).map((e) => e.id));
  return restyled.size > 1 ? separate(out, [...restyled]) : out;
}

const TEXT_INSET = 5; // Excalidraw's padding for text inside a shape

/** Grow shapes so their text fits with padding (after text was re-measured), and re-seat the text. */
export function fitContainers(elements) {
  const map = byId(elements);
  const fitted = new Map();
  for (const el of elements) {
    if (!SHAPES.has(el.type) || el.isDeleted) continue;
    const t = boundTextOf(el, map);
    if (!t) continue;
    const w = Math.max(el.width, t.width + PAD * 2);
    const h = Math.max(el.height, t.height + PAD * 2);
    const x =
      t.textAlign === "center" ? el.x + (w - t.width) / 2 : t.textAlign === "right" ? el.x + w - TEXT_INSET - t.width : el.x + TEXT_INSET;
    const y = el.y + (h - t.height) / 2;
    if (w !== el.width || h !== el.height) fitted.set(el.id, { width: w, height: h });
    if (x !== t.x || y !== t.y) fitted.set(t.id, { x, y, verticalAlign: "middle" });
  }
  return fitted.size ? elements.map((el) => (fitted.has(el.id) ? touch(el, fitted.get(el.id)) : el)) : elements;
}
