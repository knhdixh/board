import { describe, expect, it } from "vitest";
import { filterCommands, score } from "../src/commands.js";

const cmds = [
  { id: "a", group: "Note", label: "Same width" },
  { id: "b", group: "Note", label: "Stack" },
  { id: "c", group: "Paper", label: "Night", keywords: "theme" },
  { id: "d", group: "Notes", label: "shopping list", search: true },
];

describe("palette search", () => {
  it("shows everything but search-only commands when nothing is typed", () => {
    expect(filterCommands(cmds, " ").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("prefers matches at the start of a word", () => {
    expect(score("same width", "wid")).toBeGreaterThan(score("same width", "idth"));
    expect(filterCommands(cmds, "st").map((c) => c.id)[0]).toBe("b");
  });
  it("matches letters in order, groups and keywords", () => {
    expect(filterCommands(cmds, "sw").map((c) => c.id)).toContain("a");
    expect(filterCommands(cmds, "theme").map((c) => c.id)).toEqual(["c"]);
    expect(filterCommands(cmds, "shop").map((c) => c.id)).toEqual(["d"]);
  });
  it("needs every word", () => {
    expect(filterCommands(cmds, "same zebra")).toEqual([]);
  });
});
