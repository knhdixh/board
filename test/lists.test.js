import { describe, expect, it } from "vitest";
import { enterInList } from "../src/scapple/lists.js";

// Press Enter where "|" is; returns the text with "|" at the new caret, or null for a plain new line.
const enter = (s) => {
  const caret = s.indexOf("|");
  const text = s.replace("|", "");
  const r = enterInList(text, caret);
  if (!r) return null;
  const out = text.slice(0, r.from) + r.insert + text.slice(r.to);
  return out.slice(0, r.caret) + "|" + out.slice(r.caret);
};

describe("lists while typing", () => {
  it("continues bullets, keeping the indent", () => {
    expect(enter("- milk|")).toBe("- milk\n- |");
    expect(enter("Shopping\n  * eggs|")).toBe("Shopping\n  * eggs\n  * |");
    expect(enter("• one|")).toBe("• one\n• |");
  });

  it("counts numbered items up", () => {
    expect(enter("1. first|")).toBe("1. first\n2. |");
    expect(enter("9) ninth|")).toBe("9) ninth\n10) |");
  });

  it("continues checklists with an empty box", () => {
    expect(enter("- [x] done|")).toBe("- [x] done\n- [ ] |");
  });

  it("splits an item where the caret is", () => {
    expect(enter("- milk| and eggs")).toBe("- milk\n- | and eggs");
  });

  it("ends the list on an empty item", () => {
    expect(enter("- milk\n- |")).toBe("- milk\n|");
    expect(enter("1. a\n2. |")).toBe("1. a\n|");
  });

  it("renumbers the items after a new one, skipping nested ones", () => {
    expect(enter("1. a|\n2. b\n   - sub\n3. c\nafter")).toBe("1. a\n2. |\n3. b\n   - sub\n4. c\nafter");
  });

  it("leaves other lines alone", () => {
    expect(enter("plain text|")).toBeNull();
    expect(enter("-not a bullet|")).toBeNull();
    expect(enter("2026. a year|")).toBe("2026. a year\n2027. |"); // looks like a list, so it is one
    expect(enter("|- milk")).toBeNull(); // caret before the marker
  });
});
