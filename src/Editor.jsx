import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToSvg,
  getSceneVersion,
  restoreElements,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Conflict } from "./store.js";
import { toast } from "./toast.jsx";
import {
  FONT,
  boundTextOf,
  byId,
  isNote,
  noteFor,
  touch,
} from "./scapple/elements.js";
import { noteAt, rerouteBound, toggleConnection } from "./scapple/connect.js";
import { row, sameWidth, stack, units } from "./scapple/layout.js";
import { STYLES, applyStyle, fitContainers } from "./scapple/styles.js";
import { outline, selectionOutline } from "./scapple/outline.js";
import { addBackground, carry, contentsOf, isBackground } from "./scapple/background.js";
import { exportScapple } from "./scapple/scap.js";

// Scapple-like defaults: clean lines, a plain font, straight connectors.
const DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT,
  currentItemFontSize: 16,
  currentItemStrokeWidth: 1,
  currentItemArrowType: "sharp",
  currentItemRoundness: "round",
  viewBackgroundColor: "#ffffff",
};
const WRAP = 320; // free text wraps at this width once you stop typing, like a Scapple note
const UI = {
  canvasActions: {
    toggleTheme: false,
    loadScene: false,
    saveToActiveFile: false,
    export: { saveFileToDisk: true },
  },
};
const KEPT_STATE = [
  "viewBackgroundColor",
  "scrollX",
  "scrollY",
  "zoom",
  "gridModeEnabled",
];

/** Notes you can drop onto to connect: text, shapes with text, images. Empty shapes are backgrounds. */
const connectable = (el, map) =>
  el.type === "text" || el.type === "image" || !!boundTextOf(el, map);

function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Editor({ id, store, navigate, signOut }) {
  const [board, setBoard] = useState(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    store
      .get(id)
      .then((b) => (b ? setBoard(b) : setFailed("missing")))
      .catch((e) => setFailed(e.message));
  }, [id, store]);

  if (failed === "missing")
    return (
      <main className="notfound">
        <h1>404</h1>
        <p className="muted">Nothing here.</p>
        <a href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
          Back
        </a>
      </main>
    );
  if (failed) return <div className="loading error">{failed}</div>;
  if (!board) return <div className="loading">Opening</div>;
  return (
    <Canvas
      board={board}
      store={store}
      navigate={navigate}
      signOut={signOut}
    />
  );
}

function Canvas({ board, store, navigate, signOut }) {
  const [api, setApi] = useState(null);
  const [title, setTitle] = useState(board.title);
  const [status, setStatus] = useState("saved"); // saved | saving | offline | conflict
  const [selection, setSelection] = useState({ notes: 0, ids: [] });
  const dropBox = useRef(null); // outline around the note you'd connect to

  const initialData = useMemo(() => {
    const scene = board.scene ?? {};
    return {
      elements: scene.elements ?? [],
      appState: { ...DEFAULTS, ...(scene.appState ?? {}) },
      files: scene.files ?? {},
      scrollToContent: !scene.appState?.scrollX,
    };
  }, [board]);

  // Lets the end-to-end test read the scene.
  useEffect(() => {
    if (import.meta.env.DEV && api) window.__board = api;
  }, [api]);

  /* ---------- saving ---------- */
  const version = useRef(board.version);
  const lastKey = useRef(null);
  const dirty = useRef({ scene: false, title: false });
  const saving = useRef(false);
  const blocked = useRef(false);
  const timer = useRef(null);
  const titleRef = useRef(board.title);

  const flushRef = useRef(() => {});
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 800);
  }, []);

  const serialize = useCallback(() => {
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const all = api.getFiles();
    const files = {};
    for (const el of elements)
      if (el.type === "image" && el.fileId && all[el.fileId])
        files[el.fileId] = all[el.fileId];
    return {
      elements,
      appState: Object.fromEntries(KEPT_STATE.map((k) => [k, appState[k]])),
      files,
    };
  }, [api]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!api || saving.current || blocked.current) return;
    const { scene, title } = dirty.current;
    if (!scene && !title) return;
    dirty.current = { scene: false, title: false };
    saving.current = true;
    setStatus("saving");
    const changes = {};
    if (scene) changes.scene = serialize();
    if (title) changes.title = titleRef.current.trim() || "untitled";
    try {
      const r = await store.save(board.id, changes, version.current);
      version.current = r.version;
      setStatus("saved");
    } catch (e) {
      dirty.current = {
        scene: dirty.current.scene || scene,
        title: dirty.current.title || title,
      };
      if (e instanceof Conflict) {
        blocked.current = true;
        setStatus("conflict");
      } else {
        setStatus("offline");
        timer.current = setTimeout(() => flushRef.current(), 5000);
      }
    } finally {
      saving.current = false;
    }
    if (!blocked.current && (dirty.current.scene || dirty.current.title))
      schedule();
  }, [api, board.id, schedule, serialize, store]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && flush();
    const leave = (e) => {
      if (dirty.current.scene || dirty.current.title || saving.current) {
        flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    addEventListener("beforeunload", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      removeEventListener("beforeunload", leave);
      flush();
    };
  }, [flush]);

  const keepMine = async () => {
    const remote = await store.get(board.id);
    version.current = remote.version;
    blocked.current = false;
    dirty.current = { scene: true, title: true };
    flush();
  };

  /* ---------- scene helpers ---------- */
  const commit = useCallback(
    (next, { measure = false } = {}) => {
      let els = restoreElements(next, null, {
        repairBindings: true,
        refreshDimensions: measure,
      });
      // Text was re-measured: grow shapes to fit, then re-draw connectors against the real sizes.
      if (measure) els = rerouteBound(fitContainers(els), new Set(els.map((e) => e.id)));
      api.updateScene({
        elements: els,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  const selectedIds = () =>
    Object.keys(api.getAppState().selectedElementIds).filter(
      (k) => api.getAppState().selectedElementIds[k],
    );

  // Imported Scapple notes need measuring by the real text renderer once.
  useEffect(() => {
    if (!api || !board.scene?.needsMeasure) return;
    const t = setTimeout(() => {
      commit(api.getSceneElementsIncludingDeleted(), { measure: true });
      api.scrollToContent(undefined, { fitToContent: true });
    }, 300);
    return () => clearTimeout(t);
  }, [api, board.scene, commit]);

  /* ---------- change tracking ---------- */
  const editing = useRef(null);
  const selKey = useRef("");
  const onChange = useCallback(
    (elements, appState, files) => {
      const key = `${getSceneVersion(elements)}:${appState.viewBackgroundColor}:${Object.keys(files).length}:${appState.gridModeEnabled}`;
      if (lastKey.current === null) lastKey.current = key;
      else if (key !== lastKey.current) {
        lastKey.current = key;
        dirty.current.scene = true;
        if (!blocked.current) schedule();
      }

      // When you finish typing a long free-text note, wrap it to a note's width.
      const editingId = appState.editingTextElement?.id ?? null;
      if (editing.current && !editingId) {
        const done = editing.current;
        setTimeout(() => {
          const all = api.getSceneElementsIncludingDeleted();
          const el = all.find((e) => e.id === done);
          if (
            el &&
            el.type === "text" &&
            !el.isDeleted &&
            !el.containerId &&
            el.autoResize !== false &&
            el.width > WRAP
          ) {
            commit(
              all.map((e) =>
                e.id === done
                  ? touch(e, { autoResize: false, width: WRAP })
                  : e,
              ),
              { measure: true },
            );
          }
        });
      }
      editing.current = editingId;

      const ids = Object.keys(appState.selectedElementIds).filter(
        (k) => appState.selectedElementIds[k],
      );
      const sk = ids.sort().join(",") + (editingId ? ":e" : "");
      if (sk !== selKey.current) {
        selKey.current = sk;
        const map = byId(elements);
        const notes = editingId
          ? 0
          : new Set(
              ids
                .map((i) => noteFor(map.get(i), map))
                .filter(isNote)
                .map((n) => n.id),
            ).size;
        setSelection({ notes, ids });
      }
    },
    [api, commit, schedule],
  );

  /* ---------- drop a note onto another to connect ---------- */
  const drag = useRef(null);
  // Move what sits on a dragged background shape by however far the shape has moved.
  // EVENTUALLY folds these updates into the drag's own undo step.
  const moveCarried = (d) => {
    const all = api.getSceneElementsIncludingDeleted();
    const cur = all.find((e) => e.id === d.carry.shape);
    const old = d.snapshot.find((e) => e.id === d.carry.shape);
    const dx = cur.x - old.x;
    const dy = cur.y - old.y;
    if (dx === d.carry.dx && dy === d.carry.dy) return;
    d.carry.dx = dx;
    d.carry.dy = dy;
    api.updateScene({ elements: carry(all, d.snapshot, d.carry.ids, dx, dy), captureUpdate: CaptureUpdateAction.EVENTUALLY });
  };
  // The note under `point` you could connect the dragged notes to, if any.
  const dropTarget = (d, point) => {
    const elements = api.getSceneElements();
    if (!d.exclude) {
      const us = units(elements, selectedIds());
      d.exclude = new Set(us.flatMap((u) => [...u.ids]));
      const map = byId(elements);
      d.from = us.map((u) => u.key).filter((k) => !k.startsWith("g:") && !isBackground(map.get(k)));
    }
    if (!d.from.length) return null;
    const t = noteAt(elements, point, d.exclude);
    return t && connectable(t, byId(elements)) ? t : null;
  };
  const showDrop = (box) => {
    const el = dropBox.current;
    if (!el) return;
    el.hidden = !box;
    if (box)
      Object.assign(el.style, {
        left: `${box.x - 6}px`,
        top: `${box.y - 6}px`,
        width: `${box.w + 12}px`,
        height: `${box.h + 12}px`,
      });
  };
  useEffect(() => {
    if (!api) return;
    const offDown = api.onPointerDown((tool, pds) => {
      drag.current =
        tool.type === "selection"
          ? {
              pds,
              snapshot: structuredClone(api.getSceneElementsIncludingDeleted()),
              exclude: null,
            }
          : null;
    });

    const offUp = api.onPointerUp((tool, pds, event) => {
      const d = drag.current;
      drag.current = null;
      showDrop(null);
      if (
        !d ||
        d.pds !== pds ||
        !pds.drag.hasOccurred ||
        pds.hit.hasBeenDuplicated ||
        pds.resize.isResizing ||
        pds.boxSelection.hasOccurred
      )
        return;
      if (d.carry?.ids.size) {
        moveCarried(d);
        return;
      }
      const target = dropTarget(
        d,
        viewportCoordsToSceneCoords(event, api.getAppState()),
      );
      if (!target || !d.exclude.has(pds.hit.element?.id)) return;
      const arrow = event.metaKey || event.ctrlKey;
      // Put the notes back where they were and connect them, before Excalidraw records the drag,
      // so the whole gesture is one undo step.
      {
        const now = byId(api.getSceneElementsIncludingDeleted());
        let next = d.snapshot.map((old) => {
          const cur = now.get(old.id);
          return cur && cur.version !== old.version
            ? {
                ...old,
                version: cur.version + 1,
                versionNonce: Math.floor(Math.random() * 2 ** 31),
              }
            : (cur ?? old);
        });
        const ids = new Set(next.map((e) => e.id));
        for (const [i, e] of now) if (!ids.has(i)) next.push(e);
        let action;
        for (const from of d.from) {
          const r = toggleConnection(next, from, target.id, { arrow });
          next = r.elements;
          action = r.action;
        }
        commit(next);
        toast(
          action === "connected"
            ? arrow
              ? "Arrow added"
              : "Connected"
            : "Disconnected",
        );
      }
    });

    return () => {
      offDown();
      offUp();
    };
  }, [api, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerUpdate = useCallback(
    ({ pointer, button }) => {
      const d = drag.current;
      if (!api || !d || button !== "down") return;
      const appState = api.getAppState();
      if (!appState.selectedElementsAreBeingDragged) return;
      // Dragging a background shape: the notes on it come along.
      if (!d.carry) {
        const sel = new Set(selectedIds());
        const snap = byId(d.snapshot);
        const shape = [...sel].find((i) => isBackground(snap.get(i)));
        const ids = new Set();
        if (shape) for (const i of contentsOf(d.snapshot, shape)) if (!sel.has(i)) ids.add(i);
        d.carry = { shape, ids };
      }
      if (d.carry.ids.size) return moveCarried(d);
      const t = dropTarget(d, pointer);
      if (!t) return showDrop(null);
      const tl = sceneCoordsToViewportCoords(
        { sceneX: t.x, sceneY: t.y },
        appState,
      );
      const z = appState.zoom.value;
      showDrop({ x: tl.x, y: tl.y, w: t.width * z, h: t.height * z });
    },
    [api], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ---------- actions ---------- */
  const act = (fn) =>
    commit(fn(api.getSceneElementsIncludingDeleted(), selectedIds()));

  const connectChain = () => {
    let els = api.getSceneElementsIncludingDeleted();
    const us = units(els, selectedIds())
      .filter((u) => !u.key.startsWith("g:"))
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    let n = 0;
    for (let i = 1; i < us.length; i++) {
      const r = toggleConnection(els, us[i - 1].key, us[i].key);
      if (r.action === "connected") {
        els = r.elements;
        n++;
      }
    }
    commit(els);
    toast(n ? `Connected ${n + 1} notes` : "Already connected");
  };

  const disconnectAll = () => {
    const els = api.getSceneElementsIncludingDeleted();
    const ids = new Set(units(els, selectedIds()).map((u) => u.key));
    const gone = new Set(
      els
        .filter(
          (e) =>
            e.type === "arrow" &&
            !e.isDeleted &&
            ids.has(e.startBinding?.elementId) &&
            ids.has(e.endBinding?.elementId),
        )
        .map((e) => e.id),
    );
    if (!gone.size) return toast("Nothing to disconnect");
    commit(
      els.map((e) =>
        gone.has(e.id)
          ? touch(e, { isDeleted: true })
          : e.boundElements?.some((b) => gone.has(b.id))
            ? touch(e, {
                boundElements: e.boundElements.filter((b) => !gone.has(b.id)),
              })
            : e,
      ),
    );
    toast("Disconnected");
  };

  const actMeasured = (fn) => commit(fn(api.getSceneElementsIncludingDeleted(), selectedIds()), { measure: true });

  const background = () => {
    const r = addBackground(api.getSceneElementsIncludingDeleted(), selectedIds());
    if (!r.id) return;
    commit(r.elements);
    api.updateScene({ appState: { selectedElementIds: { [r.id]: true } } });
    toast("Background added. Drag it to move its notes");
  };

  const copyText = useCallback(async () => {
    const ids = Object.keys(api.getAppState().selectedElementIds).filter((k) => api.getAppState().selectedElementIds[k]);
    const els = api.getSceneElements();
    const text = ids.length ? selectionOutline(els, ids) : outline(els, titleRef.current);
    try {
      await navigator.clipboard.writeText(text);
      toast(ids.length ? "Copied as text" : "Board copied as text");
    } catch {
      toast("Couldn't reach the clipboard");
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "c") return;
      if (api.getAppState().editingTextElement || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      e.stopPropagation();
      copyText();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [api, copyText]);

  const fullScreen = async () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    api.updateScene({ appState: { zenModeEnabled: true } });
    try {
      await document.documentElement.requestFullscreen();
      toast("Esc to leave full screen");
    } catch {
      toast("Focus mode on. Alt+Z to leave");
    }
  };
  useEffect(() => {
    if (!api) return;
    const off = () => !document.fullscreenElement && api.updateScene({ appState: { zenModeEnabled: false } });
    document.addEventListener("fullscreenchange", off);
    return () => document.removeEventListener("fullscreenchange", off);
  }, [api]);

  const printBoard = async () => {
    const svg = await exportToSvg({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
      files: api.getFiles(),
      exportPadding: 24,
    });
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0";
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(
      `<!doctype html><meta charset="utf-8"><title></title><style>@page{margin:12mm}html,body{margin:0}svg{display:block;width:100%;height:auto;max-height:100vh}</style>`,
    );
    doc.body.append(doc.importNode(svg, true));
    doc.close();
    setTimeout(() => {
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1000);
    }, 300);
  };

  const exportScap = () =>
    download(`${titleRef.current || "board"}.scap`, new Blob([exportScapple(api.getSceneElementsIncludingDeleted())], { type: "application/xml" }));

  const exportOutline = () => {
    const md = outline(api.getSceneElements(), titleRef.current);
    download(
      `${titleRef.current || "board"}.md`,
      new Blob([md], { type: "text/markdown" }),
    );
  };

  const removeBoard = async () => {
    if (!confirm(`Delete “${titleRef.current}”? This can't be undone.`)) return;
    blocked.current = true;
    await store.remove(board.id);
    navigate("/");
  };

  const onTitle = (v) => {
    setTitle(v);
    titleRef.current = v;
    dirty.current.title = true;
    if (!blocked.current) schedule();
  };

  const statusText = {
    saved: "Saved",
    saving: "Saving",
    offline: "Offline, retrying",
    conflict: "Changed elsewhere",
  }[status];

  return (
    <div className="editor">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        theme="light"
        name={title}
        UIOptions={UI}
        renderTopRightUI={(isMobile) =>
          isMobile ? null : (
            <div className="topbar">
              <a
                className="back"
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  flush();
                  navigate("/");
                }}
              >
                ← Boards
              </a>
              <input
                className="title"
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                aria-label="Board name"
                spellCheck={false}
              />
              <span className={"status " + status}>{statusText}</span>
              {status === "conflict" && (
                <>
                  <button className="link" onClick={() => location.reload()}>
                    Reload
                  </button>
                  <button className="link" onClick={keepMine}>
                    Keep mine
                  </button>
                </>
              )}
            </div>
          )
        }
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => (flush(), navigate("/"))}>
            All boards
          </MainMenu.Item>
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.Separator />
          <MainMenu.Item onSelect={fullScreen}>Full screen</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={exportOutline}>Export outline</MainMenu.Item>
          <MainMenu.Item onSelect={exportScap}>Export Scapple file</MainMenu.Item>
          <MainMenu.Item onSelect={copyText} shortcut="⌘⇧C">
            Copy as text
          </MainMenu.Item>
          <MainMenu.Item onSelect={printBoard}>Print</MainMenu.Item>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Item onSelect={removeBoard}>Delete board</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={() => (flush(), navigate("/usage"))}>Usage</MainMenu.Item>
          <MainMenu.Item onSelect={signOut}>Sign out</MainMenu.Item>
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Center>
            <div className="welcome">
              <p>Double-click anywhere to write.</p>
              <p>Drop a note onto another to connect them.</p>
              <p className="muted">
                Hold ⌘ while dropping for an arrow. Drop again to disconnect.
              </p>
              <p className="muted">Select notes to stack them, style them or put a background behind them.</p>
            </div>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>

      <div className="drop-target" ref={dropBox} hidden />

      {selection.notes > 0 && (
        <div className="notebar" role="toolbar" aria-label="Note">
          <div className="swatches">
            {STYLES.map((s) => (
              <button
                key={s.key}
                title={s.label}
                aria-label={`Style: ${s.label}`}
                className={"swatch " + s.key}
                style={s.fill ? { background: s.fill } : undefined}
                onClick={() => act((els, ids) => applyStyle(els, ids, s.key))}
              >
                {s.key === "plain" ? "Aa" : ""}
              </button>
            ))}
          </div>
          {selection.notes > 1 && (
            <>
              <button onClick={() => act(stack)}>Stack</button>
              <button onClick={() => act(row)}>Row</button>
              <button onClick={() => actMeasured(sameWidth)}>Same width</button>
              <button onClick={connectChain}>Connect</button>
              <button onClick={disconnectAll}>Disconnect</button>
            </>
          )}
          <button onClick={background}>Background</button>
          <button onClick={copyText} title="⌘⇧C">
            Copy text
          </button>
        </div>
      )}
    </div>
  );
}
