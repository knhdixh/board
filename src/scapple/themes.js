// Paper themes: a canvas colour with text, line and note colours chosen to go with it.
// Switching theme recolours everything that still uses a theme colour; colours you picked yourself stay.

const FILL_KEYS = ["yellow", "blue", "green", "red", "grey"];

export const THEMES = [
  {
    key: "paper",
    label: "Paper",
    bg: "#fffcf1",
    ink: "#262420",
    line: "#8f887a",
    shape: "#efe9d6",
    shapeStroke: "#b9b19c",
    fills: { yellow: "#fdf0b4", blue: "#dbe8f5", green: "#dcefd6", red: "#f7dcd8", grey: "#eeeadf" },
  },
  {
    key: "white",
    label: "White",
    bg: "#ffffff",
    ink: "#1e1e1e",
    line: "#868e96",
    shape: "#f1f3f5",
    shapeStroke: "#ced4da",
    fills: { yellow: "#fff3bf", blue: "#d0ebff", green: "#d3f9d8", red: "#ffe3e3", grey: "#f1f3f5" },
  },
  {
    key: "sage",
    label: "Sage",
    bg: "#eef2ea",
    ink: "#1f2b24",
    line: "#7a8d80",
    shape: "#dde6d6",
    shapeStroke: "#a9baa9",
    fills: { yellow: "#f4ecc4", blue: "#d5e5ea", green: "#cfe3c7", red: "#efd8d0", grey: "#e2e8dc" },
  },
  {
    key: "sky",
    label: "Sky",
    bg: "#eef4fa",
    ink: "#1b2735",
    line: "#7b90a8",
    shape: "#dde8f3",
    shapeStroke: "#a7bad0",
    fills: { yellow: "#f6edc6", blue: "#cfe1f3", green: "#d4ebdf", red: "#f2dadf", grey: "#e2e9f0" },
  },
  {
    key: "blueprint",
    label: "Blueprint",
    bg: "#1d3557",
    ink: "#edf3fb",
    line: "#8fb0d6",
    shape: "#26456e",
    shapeStroke: "#4f77a6",
    fills: { yellow: "#5b5232", blue: "#2c5a8c", green: "#2e5c4b", red: "#6a3a44", grey: "#2b4a72" },
  },
  {
    key: "night",
    label: "Night",
    bg: "#1b1b1d",
    ink: "#ececec",
    line: "#8d8d92",
    shape: "#28282b",
    shapeStroke: "#4a4a4f",
    fills: { yellow: "#4d4426", blue: "#223a52", green: "#243f2e", red: "#4f2a2c", grey: "#2e2e31" },
  },
];

export const DEFAULT_THEME = THEMES[0];

const hexLum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * The theme for a canvas colour. A colour that isn't a preset (picked in Excalidraw's own colour picker)
 * borrows the colours of Paper or Night depending on how dark it is, so text always stays readable.
 */
export function themeFor(bg) {
  const exact = THEMES.find((t) => t.bg.toLowerCase() === (bg ?? "").toLowerCase());
  if (exact) return exact;
  const base = hexLum(bg) < 0.18 ? THEMES.find((t) => t.key === "night") : DEFAULT_THEME;
  return { ...base, key: "custom", label: "Custom", bg };
}

// Every theme colour, by the roles it plays, so a board can move between any two themes.
// (White's grey fill and its background-shape fill are the same colour, hence a list.)
const ROLES = new Map();
const add = (colour, role) => {
  const k = colour.toLowerCase();
  ROLES.set(k, [...(ROLES.get(k) ?? []), role]);
};
for (const t of THEMES) {
  add(t.ink, "ink");
  add(t.line, "line");
  add(t.shape, "shape");
  add(t.shapeStroke, "shapeStroke");
  for (const k of FILL_KEYS) add(t.fills[k], "fill:" + k);
}

const colourFor = (role, theme) => (role.startsWith("fill:") ? theme.fills[role.slice(5)] : theme[role]);

const swap = (colour, theme, onBackground) => {
  if (!colour || colour === "transparent") return colour;
  const roles = ROLES.get(colour.toLowerCase());
  if (!roles) return colour;
  const shapeRoles = roles.filter((r) => r === "shape" || r === "shapeStroke");
  const role = onBackground && shapeRoles.length ? shapeRoles[0] : roles.find((r) => !shapeRoles.includes(r)) ?? roles[0];
  return colourFor(role, theme);
};

const PAPERS = new Set(THEMES.map((t) => t.bg.toLowerCase()));

/** Recolour elements that use theme colours for `theme`. Returns the same array if nothing changed. */
export function retheme(elements, theme, touch) {
  let changed = false;
  const out = elements.map((el) => {
    if (el.isDeleted) return el;
    const background = el.customData?.background;
    const strokeColor = swap(el.strokeColor, theme, background);
    // Table cells are filled with the paper colour (so they can be clicked), and follow it.
    const paper = el.customData?.table && PAPERS.has(el.backgroundColor?.toLowerCase());
    const backgroundColor = paper ? theme.bg : swap(el.backgroundColor, theme, background);
    if (strokeColor === el.strokeColor && backgroundColor === el.backgroundColor) return el;
    changed = true;
    return touch(el, { strokeColor, backgroundColor });
  });
  return changed ? out : elements;
}

/** App-state defaults so new notes and arrows drawn with Excalidraw's tools match the theme. */
export const themeAppState = (theme) => ({
  viewBackgroundColor: theme.bg,
  currentItemStrokeColor: theme.ink,
  currentItemBackgroundColor: "transparent",
});
