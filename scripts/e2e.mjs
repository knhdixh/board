// End-to-end check of the Scapple features in headless Chrome, using guest mode (no sign-in).
// Usage: npm run dev, then: node scripts/e2e.mjs [http://localhost:5173] [shot-dir]
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
  const scene = () => js(`JSON.stringify(window.__board.getSceneElements())`).then(JSON.parse);
  const texts = async () => (await scene()).filter((e) => e.type === "text");
  const arrows = async () => (await scene()).filter((e) => e.type === "arrow");

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/" });
  // Signed-in run: E2E_SESSION is a Supabase session (JSON) for a throwaway user.
  if (process.env.E2E_SESSION) {
    const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
    await until(`!!document.body`);
    await js(`localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(process.env.E2E_SESSION)})`);
    await send("Page.navigate", { url: BASE + "/" });
    check("signed in", await until(`document.body.innerText.includes("Sign out")`, 10000));
  }
  await until(`!!document.querySelector("form.signin, .rows, .actions .primary")`);
  await sleep(1500);
  await shot("board-home.png");

  // Guest mode → new board
  if (!process.env.E2E_SESSION) await js(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("without account"))?.click()`);
  await until(`[...document.querySelectorAll("button")].some(b => b.textContent === "New board")`);
  await js(`[...document.querySelectorAll("button")].find(b => b.textContent === "New board").click()`);
  check("editor opens", await until(`!!window.__board`, 15000));
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
  await drag(a.x, a.y, b.x, b.y);
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
  check("yellow style wraps notes in filled bubbles", rects.length === 2 && rects.every((r) => r.backgroundColor === "#fff3bf"));
  const arr = all.find((e) => e.type === "arrow");
  check("connection moved onto the bubbles", rects.some((r) => r.id === arr?.startBinding?.elementId) && rects.some((r) => r.id === arr?.endBinding?.elementId));
  await click(600, 700);
  await sleep(300);
  await shot("board-styled.png");

  // Long text wraps at note width
  await dblclick(300, 600);
  await sleep(300);
  await type("This is a much longer note that keeps going so it should wrap at a sensible width rather than run on forever");
  await key("Escape");
  await sleep(600);
  const long = (await texts()).find((x) => x.text.replace(/\n/g, " ").startsWith("This is a much"));
  check("long notes wrap", long && long.width <= 321 && long.text.includes("\n"), long && `${Math.round(long.width)}px`);

  // Saved: wait for the status and reload
  await sleep(1500);
  check("saves", await until(`document.querySelector(".topbar .status")?.textContent === "Saved"`, 5000));
  await send("Page.reload");
  await until(`!!window.__board`, 15000);
  await sleep(1500);
  const after = await scene();
  check("no unsaved-changes prompt after saving", dialogs.length === 0, dialogs.join(","));
  check("board survives a reload", after.filter((e) => e.type === "text").length === 3 && after.filter((e) => e.type === "arrow").length === 1);

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
  check("imported bubble fits its text", box && box.height >= bubbled.height + 20 && bubbled.y > box.y && bubbled.y + bubbled.height < box.y + box.height);
  check("imported board is named after the file", (await js(`document.querySelector(".topbar .title").value`)) === "ideas");
  await shot("board-imported.png");

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
  await shot("board-home-phone.png");

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
