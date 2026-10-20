// Note styles. A style says what the note's shape looks like (none, a bubble, a fill…) and how its text looks.
// Built-in styles take their colours from the board's theme; saved styles keep the colours they were saved with.
import { PAD, boundTextOf, byId, newRect, noteFor, touch } from "./elements.js";
import { separate } from "./layout.js";
import { isCell } from "./table.js";

/** Built-in styles. `shape: null` = no visible shape, `"keep"` = leave the shape alone. */
export const STYLES = [
  { key: "plain", label: "Plain", shape: null, text: { color: "ink" } },
  { key: "bubble", label: "Bubble", shape: { stroke: "ink" }, text: { color: "ink" } },
  { key: "box", label: "Box", shape: { stroke: "ink", square: true }, text: { color: "ink" } },
  { key: "dashed", label: "Dashed", shape: { stroke: "line", strokeStyle: "dashed" }, text: { color: "ink" } },
  { key: "yellow", label: "Yellow", shape: { fill: "fill:yellow" }, text: { color: "ink" } },
  { key: "blue", label: "Blue", shape: { fill: "fill:blue" }, text: { color: "ink" } },
  { key: "green", label: "Green", shape: { fill: "fill:green" }, text: { color: "ink" } },
  { key: "red", label: "Red", shape: { fill: "fill:red" }, text: { color: "ink" } },
  { key: "grey", label: "Grey", shape: { fill: "fill:grey" }, text: { color: "ink" } },
  { key: "title", label: "Title", shape: "keep", text: { color: "ink", fontSize: 28 } },
  { key: "faded", label: "Faded", shape: "keep", text: { color: "line" } },
];

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

const colour = (role, theme) => {
  if (!role) return "transparent";
  if (role.startsWith("#") || role === "transparent") return role;
  return role.startsWith("fill:") ? theme.fills[role.slice(5)] : theme[role];
};

/** Turn a style (built-in or saved) into concrete element properties for this theme. */
export function resolveStyle(style, theme) {
  if (style.resolved) return style.resolved; // saved styles store concrete values
  const shape =
    style.shape === null || style.shape === "keep"
      ? style.shape
      : {
          strokeColor: style.shape.stroke ? colour(style.shape.stroke, theme) : "transparent",
          backgroundColor: style.shape.fill ? colour(style.shape.fill, theme) : "transparent",
          fillStyle: "solid",
          strokeStyle: style.shape.strokeStyle ?? "solid",
          strokeWidth: 1,
          roundness: style.shape.square ? null : { type: 3 },
        };
  const text = { strokeColor: colour(style.text.color, theme), ...(style.text.fontSize ? { fontSize: style.text.fontSize } : {}) };
  return { shape, text };
}

/** Capture a note's look as a reusable style. */
export function styleFromNote(elements, id, label) {
  const map = byId(elements);
  const note = noteFor(map.get(id), map);
  if (!note) return null;
  const text = note.type === "text" ? note : boundTextOf(note, map);
  const shape = SHAPES.has(note.type)
    ? {
        strokeColor: note.strokeColor,
        backgroundColor: note.backgroundColor,
        fillStyle: note.fillStyle,
        strokeStyle: note.strokeStyle,
        strokeWidth: note.strokeWidth,
        roundness: note.roundness,
      }
    : null;
  return {
    key: "saved:" + Math.random().toString(36).slice(2, 9),
    label,
    resolved: { shape, text: text ? { strokeColor: text.strokeColor, fontSize: text.fontSize, textAlign: text.textAlign } : {} },
  };
}

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
    boundElements: [{ id: text.id, type: "text" }, ...(text.boundElements ?? []).filter((b) => b.type === "arrow")],
  });
  const arrows = new Set((text.boundElements ?? []).filter((b) => b.type === "arrow").map((b) => b.id));
  const rebind = (b) => (b?.elementId === text.id ? { ...b, elementId: rect.id } : b);
  const out = [];
  for (const el of elements) {
    if (el.id === text.id) {
      out.push(rect);
      out.push(touch(el, { containerId: rect.id, textAlign: "center", verticalAlign: "middle", autoResize: true, boundElements: null }));
    } else if (arrows.has(el.id)) {
      out.push(touch(el, { startBinding: rebind(el.startBinding), endBinding: rebind(el.endBinding) }));
    } else out.push(el);
  }
  return { elements: out, id: rect.id };
}

/**
 * Apply a style to every selected note. Returns { elements, measure } where `measure` says the text
 * size changed, so the editor should re-measure text afterwards.
 */
export function applyStyle(elements, selectedIds, style, theme) {
  const { shape, text } = resolveStyle(style, theme);
  let out = elements;
  const map = byId(out);
  const targets = new Set();
  for (const id of selectedIds) {
    const el = noteFor(map.get(id), map);
    if (el && !el.isDeleted && !el.customData?.background) targets.add(el.id);
  }
  let measure = false;
  for (const id of targets) {
    let el = byId(out).get(id);
    if (isCell(el)) {
      // A table cell keeps its borders: a style only changes its fill (none = the paper colour) and text.
      if (shape !== "keep") {
        const fill = shape?.backgroundColor && shape.backgroundColor !== "transparent" ? shape.backgroundColor : theme.bg;
        out = out.map((e) => (e.id === el.id ? touch(e, { backgroundColor: fill }) : e));
      }
    } else if (el.type === "text" && shape && shape !== "keep") {
      const wrapped = wrapText(out, id);
      out = wrapped.elements;
      el = byId(out).get(wrapped.id);
    }
    if (SHAPES.has(el.type) && shape !== "keep" && !isCell(el)) {
      const changes = shape === null ? { strokeColor: "transparent", backgroundColor: "transparent" } : shape;
      out = out.map((e) => (e.id === el.id ? touch(e, { ...changes, roughness: 0 }) : e));
    }
    const t = el.type === "text" ? el : boundTextOf(el, byId(out));
    if (t && text) {
      if (text.fontSize && text.fontSize !== t.fontSize) measure = true;
      out = out.map((e) => (e.id === t.id ? touch(e, text) : e));
    }
  }
  // New bubbles are bigger than the text they wrap; don't let them land on each other.
  const restyled = new Set(
    out.filter((e) => !isCell(e) && (targets.has(e.id) || targets.has(e.boundElements?.find((b) => b.type === "text")?.id))).map((e) => e.id),
  );
  return { elements: restyled.size > 1 ? separate(out, [...restyled]) : out, measure };
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
