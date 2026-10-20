import { importScapple } from "./scapple/scap.js";

export const BOARD_FILES = ".scap,.excalidraw,.json";

/** Read a .scap or .excalidraw file into { title, scene }. */
export async function readBoardFile(file) {
  const text = await file.text();
  const title = file.name.replace(/\.(scap|excalidraw|json)$/i, "").toLowerCase() || "imported";
  if (/^\s*</.test(text)) return { title, scene: { elements: importScapple(text), needsMeasure: true } };
  const data = JSON.parse(text);
  if (data?.type !== "excalidraw") throw new Error("Not a board file");
  return {
    title,
    scene: { elements: data.elements ?? [], appState: { viewBackgroundColor: data.appState?.viewBackgroundColor }, files: data.files ?? {} },
  };
}
