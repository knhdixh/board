// End-to-end check of the app in headless Chrome, signed in as a throwaway user.
// Run it through scripts/e2e-cloud.mjs, which creates that user (see the README).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173";
const SHOTS = process.argv[3] ?? os.tmpdir();
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "board-e2e-"));
const chrome = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const dialogs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
    if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push(m.params.type);
      ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        console.log(`(timeout: ${method} ${JSON.stringify(params).slice(0, 80)})`);
        r({});
      }, 10000);
      pending.set(i, (m) => (clearTimeout(timer), r(m)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (expr, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) {
      if (await js(expr)) return true;
      await sleep(100);
    }
    return false;
  };
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const click = async (x, y, extra) => {
    await mouse("mousePressed", x, y, extra);
    await mouse("mouseReleased", x, y, extra);
  };
  const dblclick = async (x, y) => {
    await click(x, y);
    await mouse("mousePressed", x, y, { clickCount: 2 });
    await mouse("mouseReleased", x, y, { clickCount: 2 });
  };
  const drag = async (x1, y1, x2, y2, modifiers = 0) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
    await mouse("mousePressed", x1, y1, { modifiers });
    for (let i = 1; i <= 12; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / 12, y: y1 + ((y2 - y1) * i) / 12, button: "left", buttons: 1, modifiers });
      await sleep(16);
    }
    await mouse("mouseReleased", x2, y2, { modifiers });
    await sleep(300);
  };
  const type = async (text) => {
    for (const ch of text) await send("Input.dispatchKeyEvent", { type: "char", text: ch });
  };
  const key = async (k, code = k) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: k === "Escape" ? 27 : 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
  };
  const shot = async (name) => {
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(result.data, "base64"));
  };
  const byIdMap = (els) => new Map(els.map((e) => [e.id, e]));
  const scene = () => js(`JSON.stringify(window.__board.getSceneElements())`).then(JSON.parse);
  const texts = async () => (await scene()).filter((e) => e.type === "text");
  const arrows = async () => (await scene()).filter((e) => e.type === "arrow");

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/" });
  const signIn = async (session) => {
    const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
    await until(`!!document.body`);
    await js(`localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(session)})`);
    await send("Page.navigate", { url: BASE + "/" });
  };
  // Someone who isn't on the allow-list gets nothing.
  if (process.env.E2E_DENIED_SESSION) {
    await signIn(process.env.E2E_DENIED_SESSION);
    check("strangers are turned away", await until(`document.body.innerText.includes("This board is private")`, 10000));
    await js(`localStorage.clear()`);
  }
  await signIn(process.env.E2E_SESSION);
  check("owner signs in", await until(`document.body.innerText.includes("Sign out")`, 10000));
  await until(`!!document.querySelector("form.signin, .rows, .actions .primary")`);
  await sleep(1500);
  await shot("board-home.png");

  // New board
  await until(`[...document.querySelectorAll("button")].some(b => b.textContent === "New board")`);
  await js(`[...document.querySelectorAll("button")].find(b => b.textContent === "New board").click()`);
  check("editor opens", await until(`!!window.__board`, 15000));
  check("new boards are cream paper", (await js(`window.__board.getAppState().viewBackgroundColor`)) === "#fffcf1");
  await sleep(1500);

  // Two notes by double-clicking
  await dblclick(400, 300);
  await sleep(300);
  await type("First idea");
  await key("Escape");
  await sleep(300);
  await dblclick(800, 300);
  await sleep(300);
  await type("Second idea");
  await key("Escape");
  await sleep(300);
  await click(600, 650); // deselect
  const t = await texts();
  check("double-click creates notes", t.length === 2, t.map((x) => x.text).join(", "));
  const first = t.find((x) => x.text === "First idea");
  const second = t.find((x) => x.text === "Second idea");
  const fx = first.x;
  const fy = first.y;

  // Drag first onto second → connected, first goes back
  const z = await js(`window.__board.getAppState().zoom.value`);
  const st = await js(`(() => { const s = window.__board.getAppState(); return { sx: s.scrollX, sy: s.scrollY, ox: s.offsetLeft, oy: s.offsetTop }; })()`);
  const toScreen = (e) => ({ x: (e.x + e.width / 2 + st.sx) * z + st.ox, y: (e.y + e.height / 2 + st.sy) * z + st.oy });
  const a = toScreen(first);
  const b = toScreen(second);
  // Hold over the target first: the dashed outline and the "connect this note…" line show.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y });
  await mouse("mousePressed", a.x, a.y);
  for (let i = 1; i <= 12; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, button: "left", buttons: 1 });
    await sleep(16);
  }
  await sleep(100);
  check("dragging over a note outlines it", await js(`!document.querySelector(".drop-target").hidden`));
  check("and draws a dashed line to it", await js(`document.querySelector(".drop-line").style.display === "block"`));
  await shot("board-drop-preview.png");
  await mouse("mouseReleased", b.x, b.y);
  await sleep(300);
  check("the preview goes away on drop", await js(`document.querySelector(".drop-target").hidden && document.querySelector(".drop-line").style.display === "none"`));
  await sleep(400);
  let ar = await arrows();
  check("drop onto a note connects them", ar.length === 1, `${ar.length} arrows`);
  check("connection is a dotted line", ar[0]?.strokeStyle === "dotted" && !ar[0]?.endArrowhead);
  const back = (await texts()).find((x) => x.id === first.id);
  check("dragged note returns to its place", Math.abs(back.x - fx) < 1 && Math.abs(back.y - fy) < 1, `${back.x},${back.y} vs ${fx},${fy}`);
  check("toast says connected", await until(`document.querySelector(".toast")?.textContent === "Connected"`, 2000));
  await click(600, 650);
  await shot("board-connected.png");

  // Drop again → disconnected
  await drag(a.x, a.y, b.x, b.y);
  await sleep(400);
  ar = await arrows();
  check("dropping again disconnects", ar.length === 0, `${ar.length} arrows`);

  // Undo brings the connection back (history works with our updates)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90, commands: ["undo"] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
  await sleep(300);
  check("undo restores the connection", (await arrows()).length === 1);
  const undone = (await texts()).find((x) => x.id === first.id);
  check("undo leaves the note in its place", Math.abs(undone.x - fx) < 1 && Math.abs(undone.y - fy) < 1, `${undone.x},${undone.y}`);

  // Plain drag elsewhere just moves
  await click(600, 650);
  await drag(a.x, a.y, a.x, a.y + 200);
  const moved = (await texts()).find((x) => x.id === first.id);
  check("dragging to empty space moves the note", moved.y > fy + 150);
  check("connector follows the moved note", (await arrows()).length === 1);

  // Select both (shift-click), stack them, then style
  const m = toScreen(moved);
  await click(m.x, m.y);
  await click(b.x, b.y, { modifiers: 8 });
  check("note bar appears for a selection", await until(`!!document.querySelector(".notebar")`, 2000));
  await js(`[...document.querySelectorAll(".notebar button")].find(b => b.textContent === "Stack").click()`);
  await sleep(300);
  const s1 = (await texts()).sort((p, q) => p.y - q.y);
  check("stack puts notes in a left-aligned column", s1.length === 2 && Math.abs(s1[0].x - s1[1].x) < 1 && s1[1].y > s1[0].y && s1[1].y - (s1[0].y + s1[0].height) < 20);
  await js(`document.querySelector(".swatch.yellow").click()`);
  await sleep(400);
  const all = await scene();
  const rects = all.filter((e) => e.type === "rectangle");
  check("yellow style wraps notes in filled bubbles", rects.length === 2 && rects.every((r) => r.backgroundColor === "#fdf0b4"));
  const arr = all.find((e) => e.type === "arrow");
  check("connection moved onto the bubbles", rects.some((r) => r.id === arr?.startBinding?.elementId) && rects.some((r) => r.id === arr?.endBinding?.elementId));
  await click(600, 700);
  await sleep(300);
  await shot("board-styled.png");

  // Background shape: wrap both bubbles, then drag it; the notes come along, and undo brings all back
  {
    const before = await scene();
    const bubbles = before.filter((e) => e.type === "rectangle");
    const sx = (x) => (x + st.sx) * z + st.ox;
    const sy = (y) => (y + st.sy) * z + st.oy;
    const minX = Math.min(...bubbles.map((b) => b.x)) - 20;
    const minY = Math.min(...bubbles.map((b) => b.y)) - 20;
    const maxX = Math.max(...bubbles.map((b) => b.x + b.width)) + 20;
    const maxY = Math.max(...bubbles.map((b) => b.y + b.height)) + 20;
    await drag(sx(minX), sy(minY), sx(maxX), sy(maxY)); // box-select
    check("note bar offers a background", await until(`[...document.querySelectorAll(".notebar button")].some(b => b.textContent === "Background")`, 2000));
    await js(`[...document.querySelectorAll(".notebar button")].find(b => b.textContent === "Background").click()`);
    await sleep(400);
    const bg = (await scene()).find((e) => e.customData?.background);
    check("background shape sits behind the notes", !!bg && (await scene())[0].id === bg.id);
    await click(600, 760);
    await drag(sx(bg.x + 6), sy(bg.y + 6), sx(bg.x + 6) + 200, sy(bg.y + 6) + 40);
    await sleep(400);
    const after = byIdMap(await scene());
    const shifted = bubbles.every((b) => Math.abs(after.get(b.id).x - (b.x + 200 / z)) < 2 && Math.abs(after.get(b.id).y - (b.y + 40 / z)) < 2);
    check("dragging the background carries its notes", shifted);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90, commands: ["undo"] });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
    await sleep(400);
    const undone = byIdMap(await scene());
    check("one undo puts background and notes back", bubbles.every((b) => Math.abs(undone.get(b.id).x - b.x) < 2) && Math.abs(undone.get(bg.id).x - bg.x) < 2);
    await click(600, 760);
  }

  // Copy as text (what you'd paste into Scrivener)
  await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: BASE });
  await js(`[...document.querySelectorAll(".excalidraw button")].length`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "C", code: "KeyC", modifiers: 12, windowsVirtualKeyCode: 67 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "C", code: "KeyC", modifiers: 12 });
  const copied = await until(`navigator.clipboard.readText().then(t => t.includes("First idea") && t.includes("Second idea"))`, 3000);
  check("⌘⇧C copies the board as text", copied);

  // ---------- Scapple flow ----------
  const view = async () => {
    const v = await js(`(() => { const s = window.__board.getAppState(); return { z: s.zoom.value, sx: s.scrollX, sy: s.scrollY, ox: s.offsetLeft, oy: s.offsetTop }; })()`);
    return { center: (e) => ({ x: (e.x + e.width / 2 + v.sx) * v.z + v.ox, y: (e.y + e.height / 2 + v.sy) * v.z + v.oy }), point: (x, y) => ({ x: (x + v.sx) * v.z + v.ox, y: (y + v.sy) * v.z + v.oy }), z: v.z };
  };
  // New, empty area for these checks: scroll the board well away from the earlier notes.
  await js(`window.__board.updateScene({ appState: { scrollX: -3000, scrollY: -3000 } })`);
  await sleep(300);
  let v = await view();

  // ⌘-double-click writes a note that's already connected to the selected one
  await dblclick(300, 200);
  await sleep(300);
  await type("Parent");
  await key("Escape");
  await sleep(400);
  const parent = (await texts()).find((x) => x.text === "Parent");
  const pc = (await view()).center(parent);
  await click(pc.x, pc.y);
  await sleep(200);
  await click(700, 200, { modifiers: 4 });
  await mouse("mousePressed", 700, 200, { clickCount: 2, modifiers: 4 });
  await mouse("mouseReleased", 700, 200, { clickCount: 2, modifiers: 4 });
  await sleep(400);
  await type("Child");
  await key("Escape");
  await sleep(700);
  const child = (await texts()).find((x) => x.text === "Child");
  const link = (await arrows()).find((x) => [x.startBinding?.elementId, x.endBinding?.elementId].includes(child?.id));
  check("⌘-double-click makes a connected note", !!child && !!link, child ? "" : "no child note");

  // Magnetic stack: notes written under one another move when one grows
  await click(600, 760);
  await dblclick(300, 400);
  await sleep(300);
  await type("Top");
  await key("Escape");
  await sleep(300);
  await dblclick(300, 470);
  await sleep(300);
  await type("Under");
  await key("Escape");
  await sleep(300);
  let top = (await texts()).find((x) => x.text === "Top");
  let under = (await texts()).find((x) => x.text === "Under");
  v = await view();
  let tc = v.center(top);
  let uc = v.center(under);
  await drag(tc.x - 30, tc.y - 30, uc.x + 60, uc.y + 30); // box-select both
  await js(`[...document.querySelectorAll(".notebar button")].find(b => b.textContent === "Stack").click()`);
  await sleep(300);
  await click(600, 760);
  top = (await texts()).find((x) => x.text === "Top");
  under = (await texts()).find((x) => x.text === "Under");
  const gapBefore = under.y - (top.y + top.height);
  tc = (await view()).center(top);
  await dblclick(tc.x, tc.y); // edit the top note
  await sleep(300);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await type("second line");
  await key("Escape");
  await sleep(600);
  const top2 = (await texts()).find((x) => x.id === top.id);
  const under2 = (await texts()).find((x) => x.id === under.id);
  check("a growing note pushes its stack down", top2.height > top.height && Math.abs(under2.y - (top2.y + top2.height) - gapBefore) < 2, `gap ${gapBefore} → ${under2.y - (top2.y + top2.height)}`);

  // Dragging a connecting line moves both notes
  const pNow = (await texts()).find((x) => x.id === parent.id);
  const cNow = (await texts()).find((x) => x.id === child.id);
  const lineNow = (await arrows()).find((x) => x.id === link.id);
  v = await view();
  const mid = v.point(lineNow.x + lineNow.points[1][0] / 2, lineNow.y + lineNow.points[1][1] / 2);
  await click(600, 760);
  await drag(mid.x, mid.y, mid.x, mid.y + 120);
  await sleep(400);
  const pAfter = (await texts()).find((x) => x.id === parent.id);
  const cAfter = (await texts()).find((x) => x.id === child.id);
  const lineAfter = (await arrows()).find((x) => x.id === link.id);
  check(
    "dragging a connection moves both notes",
    pAfter.y - pNow.y > 60 && cAfter.y - cNow.y > 60 && lineAfter?.startBinding && lineAfter?.endBinding,
    `${Math.round(pAfter.y - pNow.y)} / ${Math.round(cAfter.y - cNow.y)}`,
  );
  await click(600, 760);

  // Notes panel: count in the footer opens a list you can search and jump from
  const countText = await js(`document.querySelector(".note-count")?.textContent`);
  check("footer counts the notes", /^\d+ notes$/.test(countText ?? ""), countText);
  check("note count is on screen", await js(`(() => { const r = document.querySelector(".note-count").getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width > 0 && r.bottom <= innerHeight && top?.classList.contains("note-count"); })()`));
  await js(`document.querySelector(".note-count").click()`);
  check("notes panel opens", await until(`document.querySelectorAll(".notes-panel .panel-list li .panel-row").length > 5`, 3000));
  await js(`(() => { const i = document.querySelector('.notes-panel input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "Child"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  check("find narrows the list", (await js(`document.querySelectorAll(".notes-panel .panel-list:not(.styles) .panel-row").length`)) === 1);
  await js(`(() => { const i = [...document.querySelectorAll('.notes-panel .replace input')][0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "Kid"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await js(`document.querySelector(".notes-panel .replace .link").click()`);
  await sleep(500);
  check("replace changes the note", (await texts()).some((x) => x.text === "Kid"));
  await js(`(() => { const i = document.querySelector('.notes-panel input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "Kid"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  await js(`document.querySelector(".notes-panel .panel-list:not(.styles) .panel-row").click()`);
  await sleep(500);
  check("clicking a note selects it", await js(`Object.keys(window.__board.getAppState().selectedElementIds).length === 1`));
  await shot("board-notes-panel.png");
  await js(`window.__board.toggleSidebar({ name: "notes", force: false })`);
  await click(600, 760);

  // QuickZoom: hold Z to see everything, let go to zoom back
  const z0 = (await view()).z;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90 });
  await sleep(500);
  const zOut = (await view()).z;
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90 });
  await sleep(300);
  check("hold Z zooms out to the whole board", zOut < z0, `${z0} → ${zOut}`);
  check("letting go zooms back in", Math.abs((await view()).z - z0) < 0.01);

  // Themes: Night paper recolours the board's text and lines
  await js(`document.querySelector(".main-menu-trigger").click()`);
  await until(`!!document.querySelector(".theme-swatch")`, 2000);
  await shot("board-menu.png");
  await js(`document.querySelector('.theme-swatch[aria-label="Night theme"]').click()`);
  await sleep(500);
  const night = await scene();
  check("night paper changes the canvas", (await js(`window.__board.getAppState().viewBackgroundColor`)) === "#1b1b1d");
  check("text turns light", night.filter((e) => e.type === "text" && !e.containerId).every((e) => e.strokeColor === "#ececec"));
  check("lines follow", night.filter((e) => e.type === "arrow" && e.strokeStyle === "dotted").every((e) => e.strokeColor === "#8d8d92"));
  await key("Escape");
  await js(`window.__board.scrollToContent(undefined, { fitToContent: true })`);
  await sleep(400);
  await shot("board-night.png");
  // The menu stays open while you try themes.
  if (!(await js(`!!document.querySelector(".theme-swatch")`))) await js(`document.querySelector(".main-menu-trigger").click()`);
  await until(`!!document.querySelector(".theme-swatch")`, 2000);
  await js(`document.querySelector('.theme-swatch[aria-label="Paper theme"]').click()`);
  await sleep(500);
  check("back to paper", (await scene()).filter((e) => e.type === "text" && !e.containerId).every((e) => e.strokeColor === "#262420"));
  await shot("board-paper.png");
  await js(`window.__board.updateScene({ appState: { scrollX: 0, scrollY: 0 } })`);

  // Long text wraps at note width
  await dblclick(300, 600);
  await sleep(300);
  await type("This is a much longer note that keeps going so it should wrap at a sensible width rather than run on forever");
  await key("Escape");
  await sleep(600);
  const long = (await texts()).find((x) => x.text.replace(/\n/g, " ").startsWith("This is a much"));
  check("long notes wrap", long && long.width <= 321 && long.text.includes("\n"), long && `${Math.round(long.width)}px`);

  // Command palette: ⌘/ opens ours (not Excalidraw's), type to filter, Enter runs, Esc closes
  const palette = async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "/", code: "Slash", modifiers: 4, windowsVirtualKeyCode: 191 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "/", code: "Slash", modifiers: 4 });
    return until(`document.activeElement?.classList.contains("pal-input")`, 3000);
  };
  check("⌘/ opens the palette", await palette());
  check("Excalidraw's own palette stays shut", !(await js(`!!document.querySelector(".command-palette-dialog")`)));
  const palItems = await js(`[...document.querySelectorAll(".pal-item .pal-label")].map(e => e.textContent)`);
  check("palette lists boards and board commands", ["New board", "Zoom to fit", "Outline"].every((l) => palItems.includes(l)), palItems.slice(0, 6).join(", "));
  await sleep(700);
  await shot("board-palette.png");
  await type("grid");
  await sleep(100);
  check("palette filters as you type", (await js(`document.querySelector(".pal-item.on .pal-label")?.textContent`)) === "Grid");
  const gridBefore = await js(`window.__board.getAppState().gridModeEnabled`);
  await key("Enter");
  check("Enter runs the command", await until(`window.__board.getAppState().gridModeEnabled === ${!gridBefore}`, 2000));
  check("and closes the palette", !(await js(`!!document.querySelector(".pal")`)));
  await palette();
  await type("longer note");
  await sleep(100);
  check("palette finds notes", (await js(`document.querySelector(".pal-item.on .pal-hint")?.textContent`)) === "Notes");
  await key("Enter");
  check("picking a note selects it", await until(`(() => { const ids = Object.keys(window.__board.getAppState().selectedElementIds); return ids.length === 1 && window.__board.getSceneElements().find(e => e.id === ids[0])?.text?.startsWith("This is a much"); })()`, 2000));
  await palette();
  await key("Escape");
  check("Esc closes the palette", await until(`!document.querySelector(".pal")`, 1000));
  await js(`window.__board.updateScene({ appState: { gridModeEnabled: ${gridBefore}, selectedElementIds: {} } })`);

  // Tables: one on the canvas from the palette, filled in with Tab; one typed into a note
  await js(`window.__board.updateScene({ appState: { scrollX: -4000, scrollY: 0 } })`);
  await palette();
  await type("table");
  await sleep(100);
  check("palette offers a table", (await js(`document.querySelector(".pal-item.on .pal-label")?.textContent`)) === "Table");
  await key("Enter");
  check("table starts with its first cell open", await until(`window.__board.getAppState().editingTextElement?.containerId && window.__board.getSceneElements().find(e => e.id === window.__board.getAppState().editingTextElement.containerId)?.customData?.table`, 3000));
  const tab = async (shift) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(250);
  };
  const words = ["Name", "Age", "City", "Ann", "31", "Oulu", "Bo", "a much longer cell that wraps", "Turku", "Cy"];
  for (const [i, w] of words.entries()) {
    await type(w);
    if (i < words.length - 1) await tab();
  }
  await key("Escape");
  await sleep(800);
  const tableScene = await scene();
  const tableCells = tableScene.filter((e) => e.customData?.table);
  const cellText = (r, c) => {
    const cell = tableCells.find((e) => e.customData.row === r && e.customData.col === c);
    return cell && tableScene.find((t) => t.containerId === cell.id)?.originalText;
  };
  check("Tab fills the cells in order", cellText(0, 0) === "Name" && cellText(1, 2) === "Oulu" && cellText(2, 1) === "a much longer cell that wraps");
  check("Tab in the last cell adds a row", tableCells.length === 12 && cellText(3, 0) === "Cy", `${tableCells.length} cells`);
  const rowOf = (r) => tableCells.filter((e) => e.customData.row === r);
  check("a tall cell makes its row tall", new Set(rowOf(2).map((e) => e.height)).size === 1 && rowOf(2)[0].height > 40, rowOf(2).map((e) => Math.round(e.height)).join(","));
  check("rows stay edge to edge", Math.abs(rowOf(3)[0].y - (rowOf(2)[0].y + rowOf(2)[0].height)) < 1);
  check("a table counts as one note", /^\d+ notes$/.test(await js(`document.querySelector(".note-count").textContent`)));
  const look = async (filter) => {
    await js(`window.__board.scrollToContent(window.__board.getSceneElements().filter(${filter}), { fitToViewport: true, viewportZoomFactor: 0.5 })`);
    await sleep(400);
  };
  await look(`(e) => e.customData?.table || e.containerId`);
  await shot("board-table.png");

  // Add a column from the note bar
  const anyCell = rowOf(0)[0];
  await js(`window.__board.updateScene({ appState: { selectedElementIds: { ${JSON.stringify(anyCell.id)}: true }, editingGroupId: ${JSON.stringify(anyCell.groupIds[0])} } })`);
  check("note bar shows table buttons", await until(`[...document.querySelectorAll(".notebar button")].some(b => b.textContent === "+ Column")`, 2000));
  await js(`[...document.querySelectorAll(".notebar button")].find(b => b.textContent === "+ Column").click()`);
  await sleep(500);
  const wider = (await scene()).filter((e) => e.customData?.table);
  check("+ Column adds a cell to every row", wider.length === 16 && new Set(wider.filter((e) => e.customData.col === 1).map((e) => e.x)).size === 1);

  await look(`(e) => e.customData?.table`);
  await shot("board-table-wider.png");

  // Clicking: inside a cell picks the table, double-clicking a cell writes in it, Delete empties a cell
  const onScreen = async (r, c) =>
    js(`(() => { const a = window.__board.getAppState(), z = a.zoom.value; const e = window.__board.getSceneElements().find(e => e.customData?.table && e.customData.row === ${r} && e.customData.col === ${c}); return { x: (e.x + e.width / 2 + a.scrollX) * z + a.offsetLeft, y: (e.y + e.height / 2 + a.scrollY) * z + a.offsetTop, id: e.id }; })()`);
  const barHas = (label) => js(`[...document.querySelectorAll(".notebar button")].some(b => b.textContent === ${JSON.stringify(label)})`);
  await js(`window.__board.updateScene({ appState: { selectedElementIds: {}, editingGroupId: null } })`);
  await sleep(200);
  const cell32 = await onScreen(3, 2);
  await click(cell32.x, cell32.y);
  await sleep(300);
  check("clicking inside a cell picks the table", (await js(`Object.keys(window.__board.getAppState().selectedElementIds).length`)) >= 16 && (await barHas("+ Row")) && !(await barHas("Stack")));
  await js(`[...document.querySelectorAll(".notebar button")].find(b => b.textContent === "+ Row").click()`);
  await sleep(500);
  check("+ Row on the table adds one at the bottom", (await scene()).filter((e) => e.customData?.table && e.customData.row === 4).length === 4);
  await dblclick(cell32.x, cell32.y);
  await sleep(400);
  check("double-clicking a cell writes in it", await until(`window.__board.getSceneElements().find(e => e.id === window.__board.getAppState().editingTextElement?.containerId)?.customData?.row === 3`, 2000));
  await type("Dee");
  await key("Escape");
  await sleep(500);
  check("the cell is picked after writing, with its row and column buttons", (await barHas("− Row")) && (await barHas("+ Column")));
  await key("Backspace");
  await sleep(400);
  const cleared = await scene();
  const deeCell = cleared.find((e) => e.id === cell32.id);
  check("Delete empties the cell and keeps it", !!deeCell && !deeCell.isDeleted && !cleared.find((t) => t.containerId === cell32.id)?.originalText); // Excalidraw drops the empty text
  await js(`window.__board.updateScene({ appState: { selectedElementIds: {}, editingGroupId: null } })`);

  // The Table tool next to the shapes: pick it, click the board, and a table starts there
  check("Table tool sits in the toolbar right after the shapes", await js(`document.querySelector('[data-testid="toolbar-table"]')?.closest(".table-tool-slot")?.previousElementSibling?.querySelector('[data-testid="toolbar-eraser"]') != null`));
  const before = (await scene()).filter((e) => e.customData?.table).length;
  await js(`document.querySelector('[data-testid="toolbar-table"]').click()`);
  await sleep(200);
  check("picking it arms the table tool", (await js(`window.__board.getAppState().activeTool.customType`)) === "table" && (await js(`document.querySelector('[data-testid="toolbar-table"]').checked`)));
  await click(700, 650);
  await sleep(600);
  const placed = (await scene()).filter((e) => e.customData?.table);
  const p0 = await js(`(() => { const a = window.__board.getAppState(), z = a.zoom.value; const id = a.editingTextElement?.containerId; const e = window.__board.getSceneElements().find(e => e.id === id); return e && { x: (e.x + a.scrollX) * z + a.offsetLeft, y: (e.y + a.scrollY) * z + a.offsetTop }; })()`);
  check("clicking the board drops a table there, ready to write", placed.length === before + 9 && p0 && Math.abs(p0.x - 700) < 3 && Math.abs(p0.y - 650) < 3, JSON.stringify(p0));
  check("and the tool lets go", (await js(`window.__board.getAppState().activeTool.type`)) === "selection");
  await key("Escape");
  await sleep(300);

  // A table typed in a note lines up in a monospace font
  await js(`window.__board.updateScene({ appState: { selectedElementIds: {}, editingGroupId: null, scrollX: -4000, scrollY: -1200 } })`);
  await dblclick(300, 400);
  await sleep(300);
  await send("Input.insertText", { text: "Plan\nName|Age\nAnn|31" });
  await key("Escape");
  await sleep(800);
  const tnote = (await texts()).find((x) => x.originalText?.startsWith("Plan"));
  check("a text table lines up", tnote?.originalText === "Plan\n| Name | Age |\n|------|-----|\n| Ann  | 31  |", JSON.stringify(tnote?.originalText));
  check("in a monospace font, without wrapping", tnote?.fontFamily === 3 && tnote.text === tnote.originalText);
  await sleep(500);
  const measured = (await texts()).find((x) => x.originalText?.startsWith("Plan"));
  check("the note is as wide as its table", measured.width >= 15 * 16 * 0.5, `${Math.round(measured.width)}px`);
  // Lists: Enter continues bullets and numbers, Enter on an empty item ends the list, ⇧Enter is a plain line
  await js(`window.__board.updateScene({ appState: { selectedElementIds: {}, scrollX: -4000, scrollY: -2400 } })`);
  await dblclick(300, 400);
  await sleep(300);
  const enterKey = async (modifiers = 0) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers });
    await sleep(80);
  };
  await type("Todo");
  await enterKey();
  await type("- milk");
  await enterKey();
  await type("eggs");
  await enterKey();
  await enterKey(); // empty item: drops the marker, so you carry on writing on that line
  await type("1. first");
  await enterKey();
  await type("second");
  await enterKey(8); // ⇧Enter
  await type("more");
  await key("Escape");
  await sleep(600);
  const list = (await texts()).find((x) => x.originalText?.startsWith("Todo"));
  check("Enter continues lists", list?.originalText === "Todo\n- milk\n- eggs\n1. first\n2. second\nmore", JSON.stringify(list?.originalText));

  await look(`(e) => e.originalText?.startsWith("Plan")`);
  await shot("board-text-table.png");
  await js(`window.__board.updateScene({ appState: { scrollX: 0, scrollY: 0, selectedElementIds: {} } })`);

  // Drop an image onto the board: it lands where it was dropped and goes up to Storage
  await js(`(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 120, height: 80 });
    const g = c.getContext("2d"); g.fillStyle = "#0d52ff"; g.fillRect(0, 0, 120, 80); g.fillStyle = "#fff"; g.fillRect(20, 20, 40, 40);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const target = document.querySelector(".excalidraw canvas.interactive");
    for (const type of ["dragenter", "dragover", "drop"])
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: 900, clientY: 600, bubbles: true, cancelable: true }));
  })()`);
  check("dropped image lands on the board", await until(`window.__board.getSceneElements().some(e => e.type === "image" && window.__board.getFiles()[e.fileId])`, 5000));
  const imageId = await js(`window.__board.getSceneElements().find(e => e.type === "image")?.fileId`);
  await sleep(3000); // upload, then the save without the image data

  // Saved: wait for the status and reload
  await sleep(1500);
  check("saves", await until(`document.querySelector(".topbar .status")?.textContent === "Saved"`, 5000));
  const savedScene = await scene();
  await send("Page.reload");
  await until(`!!window.__board`, 15000);
  await sleep(1500);
  const after = await scene();
  check("no unsaved-changes prompt after saving", dialogs.length === 0, dialogs.join(","));
  const sig = (els) => els.filter((e) => e.type === "text").map((e) => e.text).sort().join("|") + "#" + els.filter((e) => e.type === "arrow").length;
  check("board survives a reload", sig(after) === sig(savedScene), `${sig(after).length} vs ${sig(savedScene).length}`);
  check("image comes back after a reload", await until(`!!window.__board.getFiles()[${JSON.stringify(imageId)}]?.dataURL`, 8000));
  const savedFile = await js(`(async () => {
    const token = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith("-auth-token")))).access_token;
    const r = await fetch(${JSON.stringify(process.env.VITE_SUPABASE_URL)} + "/rest/v1/boards?select=scene&id=eq." + location.pathname.split("/").pop(),
      { headers: { apikey: ${JSON.stringify(process.env.VITE_SUPABASE_KEY)}, Authorization: "Bearer " + token } });
    return (await r.json())[0].scene.files[${JSON.stringify(imageId)}];
  })()`);
  check("image is kept in Storage, not in the board", savedFile?.stored === true && !savedFile.dataURL, savedFile ? Object.keys(savedFile).join(",") : "missing");

  // Import a Scapple file from the home page
  await send("Page.navigate", { url: BASE + "/" });
  await until(`!!document.querySelector('input[type=file]')`);
  const scap = fs.readFileSync(new URL("../test/fixtures/sample.scap", import.meta.url), "utf8");
  await js(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(scap)}], "Ideas.scap")); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await until(`!!window.__board && location.pathname.startsWith("/b/")`, 15000);
  await sleep(2500);
  const imp = await scene();
  const impTexts = imp.filter((e) => e.type === "text");
  check("imports a .scap file", impTexts.length === 3 && imp.filter((e) => e.type === "arrow").length === 2);
  const bubbled = impTexts.find((e) => e.text.includes("Main"));
  const box = imp.find((e) => e.id === bubbled?.containerId);
  check("imported bubble fits its text", box && box.height >= bubbled.height + 16 && bubbled.y > box.y && bubbled.y + bubbled.height < box.y + box.height);
  check("imported board is named after the file", (await js(`document.querySelector(".topbar .title").value`)) === "ideas");
  await shot("board-imported.png");

  // Usage dashboard
  await send("Page.navigate", { url: BASE + "/usage" });
  check("usage dashboard loads", await until(`document.querySelectorAll(".usage-row").length >= 7`, 10000));
  const usageText = await js(`document.body.innerText`);
  check("dashboard shows the limits", ["500 MB", "5.00 GB", "100.00 GB", "Idle time", "Vercel cron"].every((t) => usageText.includes(t)));
  await sleep(2500);
  await shot("board-usage.png");

  // Phone width: no horizontal scroll on the home page
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload");
  await until(`!!window.__board`, 15000);
  await sleep(1500);
  check("phone editor fits the screen", !(await js(`[...document.querySelectorAll(".App-toolbar, .App-bottom-bar, .mobile-misc-tools-container")].some(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; })`)));
  await shot("board-editor-phone.png");
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(2500);
  check("no horizontal scroll at 390px", !(await js(`document.documentElement.scrollWidth > innerWidth`)));
  await send("Page.navigate", { url: BASE + "/usage" });
  await until(`document.querySelectorAll(".usage-row").length >= 7`, 10000);
  await sleep(2500);
  check("usage page fits at 390px", !(await js(`document.documentElement.scrollWidth > innerWidth`)));
  await shot("board-usage-phone.png");
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(2500);
  await shot("board-home-phone.png");

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
