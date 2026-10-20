// Small helpers for building and reading Excalidraw elements without the editor.
// Everything here is pure: it takes element arrays and returns new ones.

export const randomId = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const randomInt = () => Math.floor(Math.random() * 2 ** 31);

export const PAD = 8; // space between a note's text and its bubble (Scapple bubbles sit close)
export const FONT = 9; // Liberation Sans: Helvetica's metrics, like Scapple, and bundled so notes look the same everywhere
export const INK = "#1e1e1e";
export const LINE_HEIGHT = 1.25;

const base = (type, props) => ({
  id: randomId(),
  type,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0,
  strokeColor: INK,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: randomInt(),
  version: 1,
  versionNonce: randomInt(),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
  ...props,
});

export const newText = (props) =>
  base("text", {
    text: "",
    originalText: props.text ?? "",
    fontSize: 16,
    fontFamily: FONT,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...props,
  });

export const newRect = (props) => base("rectangle", { roundness: { type: 3 }, ...props });

export const newArrow = (props) =>
  base("arrow", {
    points: [[0, 0], [1, 1]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
    roundness: null,
    ...props,
  });

/** Return a copy with the changes applied and the version bumped, like Excalidraw's newElementWith. */
export const touch = (el, changes = {}) => ({
  ...el,
  ...changes,
  version: (el.version ?? 1) + 1,
  versionNonce: randomInt(),
  updated: Date.now(),
});

export const byId = (elements) => new Map(elements.map((e) => [e.id, e]));

const NOTE_TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "image", "embeddable", "iframe"]);

/** A note is anything you can write on or connect: shapes, free text, images. Bound text belongs to its container. */
export const isNote = (el) =>
  !!el && !el.isDeleted && NOTE_TYPES.has(el.type) && !(el.type === "text" && el.containerId);

/** The note an element belongs to (bound text → its container). */
export const noteFor = (el, map) =>
  el?.type === "text" && el.containerId ? map.get(el.containerId) ?? el : el;

export const boundTextOf = (el, map) => {
  const ref = el.boundElements?.find((b) => b.type === "text");
  const t = ref && map.get(ref.id);
  return t && !t.isDeleted ? t : null;
};

export const bbox = (el) => ({ x: el.x, y: el.y, w: el.width, h: el.height });

export const contains = (box, p, slack = 0) =>
  p.x >= box.x - slack && p.x <= box.x + box.w + slack && p.y >= box.y - slack && p.y <= box.y + box.h + slack;

/** The text of a note (free text, or the text bound inside a shape). */
export const noteText = (el, map) => {
  if (el.type === "text") return el.originalText ?? el.text ?? "";
  const t = boundTextOf(el, map);
  return t ? t.originalText ?? t.text ?? "" : "";
};
