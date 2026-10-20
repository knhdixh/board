// Lists while you type: Enter on a "- " or "1. " line starts the next item, Enter on an empty item ends the list.
// Pure: takes the text and caret, returns the edit to make (or null to let Enter be an ordinary new line).

const ITEM = /^(\s*)([-*•+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;

const lineAt = (text, i) => {
  const start = text.lastIndexOf("\n", i - 1) + 1;
  const end = text.indexOf("\n", i);
  return { start, end: end < 0 ? text.length : end };
};

/**
 * What Enter should do at `caret` in `text`: { from, to, insert, caret } replaces text[from, to) with `insert`
 * and puts the caret at `caret`. Numbered items after the new one are renumbered to make room.
 */
export function enterInList(text, caret) {
  const line = lineAt(text, caret);
  const m = text.slice(line.start, line.end).match(ITEM);
  if (!m || caret < line.start + m[0].length) return null; // not a list, or the caret is in the marker
  const [marker, indent, bullet, num, delim, gap, box] = m;
  const rest = text.slice(line.start + marker.length, line.end);
  // Enter on an empty item: drop the marker and stop the list.
  if (!rest.trim()) return { from: line.start, to: line.end, insert: "", caret: line.start };

  const next = num !== undefined ? `${Number(num) + 1}${delim}` : bullet;
  const insert = `\n${indent}${next}${gap}${box ? "[ ] " : ""}`;
  if (num === undefined) return { from: caret, to: caret, insert, caret: caret + insert.length };

  // Renumber the items that follow at the same depth: 1. 2. 3. → Enter after 1. → 1. 2. 3. 4.
  let to = line.end;
  let tail = text.slice(caret, line.end);
  let n = Number(num) + 1;
  let pos = line.end;
  while (pos < text.length) {
    const l = lineAt(text, pos + 1);
    const lm = text.slice(l.start, l.end).match(ITEM);
    if (!lm) break;
    if (lm[1].length > indent.length) {
      tail += "\n" + text.slice(l.start, l.end); // a nested item: keep it, keep going
    } else if (lm[1] === indent && lm[3] !== undefined) {
      n++;
      tail += "\n" + indent + `${n}${lm[4]}` + text.slice(l.start + lm[1].length + lm[3].length + 1, l.end);
    } else break;
    to = l.end;
    pos = l.end;
  }
  return { from: caret, to, insert: insert + tail, caret: caret + insert.length };
}
