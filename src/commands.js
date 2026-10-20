// Commands for the palette (⌘/). Each page provides its own; the palette asks for them when it opens,
// so they reflect the selection at that moment.
//
// A command: { id, label, group, run, shortcut?, hint?, keywords?, search? }
// `search` commands (notes, every board) only show once you type.

const sources = new Map();

/** Provide commands under `key`, replacing any earlier ones. Returns a function that withdraws them. */
export function provideCommands(key, fn) {
  sources.set(key, fn);
  return () => sources.get(key) === fn && sources.delete(key);
}

const GROUPS = ["Note", "Table", "Go to", "Create", "Board", "Insert", "View", "Paper", "Export", "Tools", "Notes", "Account"];
const rank = (c) => (GROUPS.includes(c.group) ? GROUPS.indexOf(c.group) : GROUPS.length - 1);

export const allCommands = () =>
  [...sources.values()]
    .flatMap((fn) => fn())
    .sort((a, b) => rank(a) - rank(b));

export const openPalette = () => dispatchEvent(new CustomEvent("board:palette"));

/**
 * How well `query` matches `text`, or 0 for no match. Every word of the query must appear;
 * a word at the start of the text or of one of its words counts for more, and letters in order
 * ("sw" for "same width") count for a little.
 */
export function score(text, query) {
  const t = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i === 0) total += 4;
    else if (i > 0) total += /[\s:/-]/.test(t[i - 1]) ? 3 : 2;
    else if (inOrder(t, w)) total += 1;
    else return 0;
  }
  return total;
}

const inOrder = (t, w) => {
  let j = 0;
  for (const c of t) if (c === w[j] && ++j === w.length) return true;
  return false;
};

/** The commands to show for `query`, best first, keeping groups together when nothing is typed. */
export function filterCommands(commands, query) {
  if (!query.trim()) return commands.filter((c) => !c.search);
  return commands
    .map((c, i) => ({ c, i, s: Math.max(score(c.label, query) * 2, score(`${c.group} ${c.label} ${c.keywords ?? ""}`, query)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
