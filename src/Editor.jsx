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
import { Conflict, images, settings } from "./store.js";
import NotesPanel from "./NotesPanel.jsx";
import { toast } from "./toast.jsx";
import {
  FONT,
  PAD,
  boundTextOf,
  byId,
  isNote,
  newText,
  noteFor,
  touch,
} from "./scapple/elements.js";
import { exitPoint, noteAt, rerouteBound, routeArrow, toggleConnection } from "./scapple/connect.js";
import { row, sameWidth, stack, units } from "./scapple/layout.js";
import { STYLES, applyStyle, fitContainers, styleFromNote } from "./scapple/styles.js";
import { DEFAULT_THEME, THEMES, retheme, themeAppState, themeFor } from "./scapple/themes.js";
import { boxesOf, restack } from "./scapple/stacks.js";
import { listNotes, replaceInNotes } from "./scapple/notes.js";
import { openPalette, provideCommands } from "./commands.js";
import { outline, selectionOutline } from "./scapple/outline.js";
import { addBackground, carry, contentsOf, isBackground } from "./scapple/background.js";
import { exportScapple } from "./scapple/scap.js";
import { enterInList } from "./scapple/lists.js";
import {
  addColumn,
  addRow,
  blankTextTable,
  cellFor,
  isCell,
  monoWidth,
  newTable,
  nextCell,
  relayoutTables,
  removeLine,
  tidyTextTable,
} from "./scapple/table.js";

// Scapple-like defaults: clean lines, a plain font, straight connectors.
const DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT,
  currentItemFontSize: 16,
  currentItemStrokeWidth: 1,
  currentItemArrowType: "sharp",
  currentItemRoundness: "round",
  ...themeAppState(DEFAULT_THEME),
};
const QUICK = new Set(["plain", "bubble", "dashed", "yellow", "blue", "green", "red"]); // in the note bar
const MONO_FAMILY = "Cascadia"; // the font Excalidraw registers for text tables (see MONO)
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
  const [selection, setSelection] = useState({ notes: 0, ids: [], cell: null });
  const dropBox = useRef(null); // outline around the note you'd connect to
  const preview = useRef(null); // dashed line from the dragged note to that note
  const [theme, setTheme] = useState(() => themeFor(board.scene?.appState?.viewBackgroundColor ?? DEFAULT_THEME.bg));
  const themeRef = useRef(theme);
  const bgRef = useRef(theme.bg);
  const [noteCount, setNoteCount] = useState(0);
  const [prefs, setPrefs] = useState({ styles: [], defaultStyle: "plain" });
  const prefsRef = useRef(prefs);

  const initialData = useMemo(() => {
    const scene = board.scene ?? {};
    return {
      elements: scene.elements ?? [],
      appState: { ...DEFAULTS, ...(scene.appState ?? {}), ...themeAppState(themeFor(scene.appState?.viewBackgroundColor ?? DEFAULT_THEME.bg)) },
      // Images kept in Storage arrive later (see below); only embedded ones can be shown straight away.
      files: Object.fromEntries(Object.entries(scene.files ?? {}).filter(([, f]) => f.dataURL)),
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
      if (el.type === "image" && el.fileId)
        if (stored.current.has(el.fileId)) files[el.fileId] = stored.current.get(el.fileId);
        else if (all[el.fileId]) files[el.fileId] = all[el.fileId];
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

  /* ---------- images ---------- */
  // Images live in Storage; the board only keeps a note of each one. Files that are
  // in Storage, by id, as saved in the board (no data URL).
  const stored = useRef(
    new Map(Object.values(board.scene?.files ?? {}).filter((f) => f.stored).map((f) => [f.id, f])),
  );
  const uploading = useRef(new Set());

  useEffect(() => {
    if (!api) return;
    const missing = [...stored.current.values()];
    if (!missing.length) return;
    let live = true;
    Promise.allSettled(missing.map((f) => images.download(f))).then((rs) => {
      if (!live) return;
      const got = rs.filter((r) => r.status === "fulfilled").map((r) => r.value);
      if (got.length) api.addFiles(got);
      if (got.length < rs.length) toast(`${rs.length - got.length} images couldn't load`);
    });
    return () => {
      live = false;
    };
  }, [api]);

  // New images (dropped, pasted, or embedded in an older board) go up to Storage once.
  const uploadNew = useCallback(
    (elements, files) => {
      for (const el of elements) {
        const f = el.type === "image" && !el.isDeleted && files[el.fileId];
        if (!f?.dataURL || stored.current.has(f.id) || uploading.current.has(f.id)) continue;
        uploading.current.add(f.id);
        images
          .upload(f)
          .then(() => {
            stored.current.set(f.id, { id: f.id, mimeType: f.mimeType, created: f.created, stored: true });
            dirty.current.scene = true; // re-save without the image data
            if (!blocked.current) schedule();
          })
          .catch(() => {}) // stays embedded in the board, so nothing is lost
          .finally(() => uploading.current.delete(f.id));
      }
    },
    [schedule],
  );

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

  // Line tables up; when a column changed width its text re-wraps, which can make rows taller, so go again.
  const settleTables = (all) => {
    let r = relayoutTables(all);
    for (let i = 0; i < 3 && r.measure; i++)
      r = relayoutTables(restoreElements(r.elements, null, { repairBindings: true, refreshDimensions: true }));
    return r.elements;
  };

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
  const boxes = useRef(null);
  const known = useRef(new Set());
  const isNew = useRef(false);
  const connectFrom = useRef(null); // notes a ⌘-double-clicked note should connect to
  const lastNotes = useRef(null); // the last selected notes, and when they were deselected

  const finishNote = (id, fresh, from) => {
    let all = api.getSceneElementsIncludingDeleted();
    let el = all.find((e) => e.id === id);
    if (!el || el.isDeleted || el.type !== "text") return;
    let measure = false;
    let changed = false;
    // "a | b" rows: line them up in a monospace font, and give the note room so they don't wrap.
    const tidy = tidyTextTable(el);
    if (tidy) {
      el = touch(el, tidy.customData.textTable && !el.containerId ? { ...tidy, autoResize: true } : tidy);
      all = all.map((e) => (e.id === id ? el : e));
      if (tidy.customData.textTable) all = roomForTable(all, el);
      measure = changed = true;
    }
    if (!el.containerId && el.autoResize !== false && el.width > WRAP && !el.customData?.textTable) {
      all = all.map((e) => (e.id === id ? touch(e, { autoResize: false, width: WRAP }) : e));
      measure = changed = true;
    }
    if (fresh && !el.containerId) {
      const style = [...STYLES, ...prefsRef.current.styles].find((s) => s.key === prefsRef.current.defaultStyle);
      if (style && style.key !== "plain") {
        const r = applyStyle(all, [id], style, themeRef.current);
        all = r.elements;
        measure = true;
        changed = true;
      }
    }
    if (fresh && from?.length) {
      const map = byId(all);
      const target = noteFor(map.get(id), map).id;
      for (const f of from) if (map.get(f) && !map.get(f).isDeleted) all = toggleConnection(all, f, target, { theme: themeRef.current }).elements;
      changed = true;
      toast("Connected");
    }
    if (changed) commit(all, { measure });
    if (tidy) remeasureMono();
  };

  // Text tables use a font that loads on first use; measured before it arrives, the note comes out too narrow.
  const remeasureMono = () =>
    document.fonts
      .load(`16px ${MONO_FAMILY}`)
      .then((loaded) => {
        if (!loaded.length) return;
        const all = api.getSceneElementsIncludingDeleted();
        const els = restoreElements(all, null, { repairBindings: true, refreshDimensions: true });
        api.updateScene({ elements: fitContainers(els), captureUpdate: CaptureUpdateAction.EVENTUALLY });
      })
      .catch(() => {});
  useEffect(() => {
    document.fonts?.load(`16px ${MONO_FAMILY}`).catch(() => {});
  }, []);

  // A shape whose text is a table gets wide enough for it (text in a shape wraps to the shape).
  const roomForTable = (all, text) => {
    if (!text.containerId || isCell(byId(all).get(text.containerId))) return all;
    const need = monoWidth(text.originalText, text.fontSize) + PAD * 2 + 10;
    return all.map((e) => (e.id === text.containerId && e.width < need ? touch(e, { width: need }) : e));
  };

  // ⌘-double-click: the new note gets connected to the note(s) you had selected.
  useEffect(() => {
    if (!api) return;
    const onDbl = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.target.tagName !== "CANVAS") return;
      const ln = lastNotes.current;
      if (!ln || (ln.at && Date.now() - ln.at > 2000)) return;
      const map = byId(api.getSceneElements());
      connectFrom.current = [...new Set(ln.ids.map((i) => noteFor(map.get(i), map)?.id).filter(Boolean))];
      // Excalidraw ignores ⌘-double-click, so replay it as a plain one: that starts a new note here.
      e.stopPropagation();
      e.preventDefault();
      const { clientX, clientY } = e;
      e.target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, view: window }));
    };
    const root = document.querySelector(".editor");
    root?.addEventListener("dblclick", onDbl, true);
    return () => root?.removeEventListener("dblclick", onDbl, true);
  }, [api]);
  const onChange = useCallback(
    (elements, appState, files) => {
      const key = `${getSceneVersion(elements)}:${appState.viewBackgroundColor}:${Object.keys(files).length}:${appState.gridModeEnabled}`;
      if (lastKey.current === null) {
        lastKey.current = key;
        uploadNew(elements, files);
      } else if (key !== lastKey.current) {
        lastKey.current = key;
        uploadNew(elements, files);
        dirty.current.scene = true;
        if (!blocked.current) schedule();
      }

      // Canvas colour changed in Excalidraw's own picker: bring text, lines and fills along.
      if (appState.viewBackgroundColor !== bgRef.current) {
        bgRef.current = appState.viewBackgroundColor;
        const t = themeFor(appState.viewBackgroundColor);
        themeRef.current = t;
        setTheme(t);
        setTimeout(() => {
          const all = api.getSceneElementsIncludingDeleted();
          const next = retheme(all, t, touch);
          api.updateScene({
            ...(next !== all ? { elements: next } : {}),
            appState: { currentItemStrokeColor: t.ink },
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
        });
      }

      // Magnetic stacks: a note in a column grew, shrank or went away, so the notes under it follow.
      if (boxes.current && !appState.selectedElementsAreBeingDragged) {
        const before = boxes.current;
        if (restack(before, elements) !== elements)
          setTimeout(() => {
            const all = api.getSceneElementsIncludingDeleted();
            const next = restack(before, all);
            if (next !== all) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.EVENTUALLY });
          });
      }
      boxes.current = boxesOf(elements);

      // Tables: a cell grew or was resized, so its row and column follow.
      if (!appState.selectedElementsAreBeingDragged && !appState.resizingElement && !appState.editingTextElement && relayoutTables(elements).elements !== elements)
        setTimeout(() => {
          const all = api.getSceneElementsIncludingDeleted();
          const next = settleTables(all);
          if (next !== all) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.EVENTUALLY });
        });

      let count = 0;
      const tables = new Set();
      for (const el of elements)
        if (isCell(el)) tables.add(el.customData.table);
        else if (isNote(el) && !el.customData?.background) count++;
      setNoteCount(count + tables.size);

      // A note just finished editing: wrap long text, connect it if it was ⌘-double-clicked,
      // and give brand-new notes your default style.
      const editingId = appState.editingTextElement?.id ?? null;
      if (!editing.current && editingId) {
        isNew.current = !known.current.has(editingId);
      }
      if (editing.current && !editingId) {
        const done = editing.current;
        const fresh = isNew.current;
        const from = connectFrom.current;
        connectFrom.current = null;
        setTimeout(() => finishNote(done, fresh, from));
      }
      editing.current = editingId;
      known.current = new Set(elements.map((e) => e.id));

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
        const cells = editingId ? [] : [...new Set(ids.map((i) => cellFor(map.get(i), map)?.id).filter(Boolean))];
        setSelection({ notes, ids, cell: cells.length === 1 ? cells[0] : null });
        if (notes) lastNotes.current = { ids, at: 0 };
        else if (lastNotes.current && !lastNotes.current.at) lastNotes.current.at = Date.now();
      }
    },
    [api, commit, schedule, uploadNew], // eslint-disable-line react-hooks/exhaustive-deps
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
  // A dragged connector must stay attached to the notes it carried along.
  const keepConnected = (d) => {
    const all = api.getSceneElementsIncludingDeleted();
    const c = d.carry.connector;
    const fixed = all.map((e) =>
      e.id === c.id
        ? touch(e, { startBinding: c.startBinding, endBinding: c.endBinding })
        : (e.id === c.startBinding.elementId || e.id === c.endBinding.elementId) && !e.boundElements?.some((b) => b.id === c.id)
          ? touch(e, { boundElements: [...(e.boundElements ?? []), { id: c.id, type: "arrow" }] })
          : e,
    );
    const map = byId(fixed);
    api.updateScene({ elements: fixed.map((e) => (e.id === c.id ? routeArrow(e, map) : e)), captureUpdate: CaptureUpdateAction.EVENTUALLY });
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
  const showDrop = (box, line) => {
    const el = dropBox.current;
    if (!el) return;
    el.hidden = !box;
    const svg = preview.current;
    if (svg) {
      svg.style.display = line ? "block" : "none";
      if (line) {
        const l = svg.firstChild;
        l.setAttribute("x1", line.x1);
        l.setAttribute("y1", line.y1);
        l.setAttribute("x2", line.x2);
        l.setAttribute("y2", line.y2);
      }
    }
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
        if (d.carry.connector) keepConnected(d);
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
          const r = toggleConnection(next, from, target.id, { arrow, theme: themeRef.current });
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
        // Dragging a connecting line moves both of its notes.
        const only = sel.size === 1 && snap.get([...sel][0]);
        if (!shape && only?.type === "arrow" && only.startBinding && only.endBinding) {
          for (const n of [only.startBinding.elementId, only.endBinding.elementId]) {
            ids.add(n);
            for (const b of snap.get(n)?.boundElements ?? []) if (b.type === "text") ids.add(b.id);
          }
          d.carry = { shape: only.id, ids, connector: only };
        }
      }
      if (d.carry.ids.size) return moveCarried(d);
      const t = dropTarget(d, pointer);
      if (!t) return showDrop(null);
      const tl = sceneCoordsToViewportCoords(
        { sceneX: t.x, sceneY: t.y },
        appState,
      );
      const z = appState.zoom.value;
      // "Connect this note… to this one": a dashed line from where the note was to the target.
      const src = d.snapshot.find((e) => e.id === d.from[0]);
      const sb = { x: src.x, y: src.y, w: src.width, h: src.height };
      const tb = { x: t.x, y: t.y, w: t.width, h: t.height };
      const a = exitPoint(sb, { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 }, 4);
      const b = exitPoint(tb, { x: sb.x + sb.w / 2, y: sb.y + sb.h / 2 }, 8);
      const va = sceneCoordsToViewportCoords({ sceneX: a.x, sceneY: a.y }, appState);
      const vb = sceneCoordsToViewportCoords({ sceneX: b.x, sceneY: b.y }, appState);
      showDrop({ x: tl.x, y: tl.y, w: t.width * z, h: t.height * z }, { x1: va.x, y1: va.y, x2: vb.x, y2: vb.y });
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
      const r = toggleConnection(els, us[i - 1].key, us[i].key, { theme: themeRef.current });
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

  /* ---------- tables ---------- */
  const center = () => {
    const st = api.getAppState();
    return viewportCoordsToSceneCoords({ clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 }, st);
  };
  const select = (id, editingGroupId) => api.updateScene({ appState: { selectedElementIds: { [id]: true }, editingGroupId, selectedGroupIds: {} } });
  // Start writing in a cell, as if you had pressed Enter on it.
  const editCell = (id) => {
    const cell = api.getSceneElements().find((e) => e.id === id);
    if (!cell) return;
    select(id, cell.groupIds.at(-1) ?? null);
    setTimeout(() => document.querySelector(".excalidraw")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })), 30);
  };

  const insertTable = (rows = 3, cols = 3) => {
    const p = center();
    const t = newTable(Math.round(p.x - (cols * 120) / 2), Math.round(p.y - (rows * 36) / 2), rows, cols, themeRef.current);
    commit([...api.getSceneElementsIncludingDeleted(), ...t.elements]);
    editCell(t.elements[0].id);
    toast("Table added. Tab moves to the next cell");
  };
  const tableEdit = (fn, ...args) => {
    const cell = selection.cell;
    if (!cell) return;
    const r = fn(api.getSceneElementsIncludingDeleted(), cell, ...args, themeRef.current);
    commit(r.elements ?? r);
    const live = api.getSceneElements();
    const keep = r.id ?? (live.some((e) => e.id === cell) ? cell : null);
    const el = keep && live.find((e) => e.id === keep);
    if (el) select(keep, el.groupIds.at(-1) ?? null);
  };

  // A table typed into the selected note (or a new one in the middle of the screen).
  const textTable = () => {
    const all = api.getSceneElementsIncludingDeleted();
    const map = byId(all);
    const note = selection.notes === 1 && !selection.cell ? noteFor(map.get(selection.ids[0]), map) : null;
    const text = note && (note.type === "text" ? note : boundTextOf(note, map));
    if (!text) {
      const p = center();
      const blank = blankTextTable();
      const el = newText({ x: p.x - 120, y: p.y - 40, text: blank, originalText: blank, strokeColor: themeRef.current.ink });
      commit([...all, touch(el, tidyTextTable(el))], { measure: true });
      remeasureMono();
      return select(el.id, null);
    }
    const before = (text.originalText ?? text.text).trimEnd();
    const body = (before ? before + "\n\n" : "") + blankTextTable();
    let next = all.map((e) => (e.id === text.id ? touch(e, { text: body, originalText: body }) : e));
    const t = byId(next).get(text.id);
    next = next.map((e) => (e.id === t.id ? touch(e, { ...tidyTextTable(t), ...(t.containerId ? {} : { autoResize: true }) }) : e));
    commit(roomForTable(next, byId(next).get(text.id)), { measure: true });
    remeasureMono();
  };

  // Tab / ⇧Tab while writing in a cell moves to the next one; Tab in the last cell adds a row.
  useEffect(() => {
    if (!api) return;
    const onKey = (e) => {
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
      const editingEl = api.getAppState().editingTextElement;
      if (!editingEl) return;
      const all = api.getSceneElements();
      const map = byId(all);
      const cell = cellFor(map.get(editingEl.id), map);
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      e.target.blur?.(); // finishes the edit; Excalidraw then selects the cell, so wait for that before moving on
      const go = (tries = 0) => {
        if (api.getAppState().editingTextElement && tries < 20) return setTimeout(() => go(tries + 1), 10);
        const now = api.getSceneElementsIncludingDeleted();
        let to = nextCell(now, cell.id, e.shiftKey ? -1 : 1);
        if (!to && !e.shiftKey) {
          commit(addRow(now, cell.id, true, themeRef.current).elements);
          to = nextCell(api.getSceneElementsIncludingDeleted(), cell.id);
        }
        if (to) editCell(to.id);
      };
      setTimeout(go, 10);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [api, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lists while writing a note: Enter continues "- " and "1. " items, Enter on an empty item ends the list.
  // ⇧Enter is always a plain new line.
  useEffect(() => {
    const onKey = (e) => {
      const ta = e.target;
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (!(ta instanceof HTMLTextAreaElement) || !ta.classList.contains("excalidraw-wysiwyg")) return;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const r = enterInList(ta.value, ta.selectionStart);
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      ta.setSelectionRange(r.from, r.to);
      // execCommand keeps the browser's own undo, and fires "input" so Excalidraw sees the new text.
      const ok = r.insert ? document.execCommand("insertText", false, r.insert) : r.from === r.to || document.execCommand("delete");
      if (!ok) {
        ta.setRangeText(r.insert, r.from, r.to);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      ta.setSelectionRange(r.caret, r.caret);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  /* ---------- themes, styles, preferences ---------- */
  const pickTheme = (t) => {
    bgRef.current = t.bg;
    themeRef.current = t;
    setTheme(t);
    const all = api.getSceneElementsIncludingDeleted();
    const next = retheme(all, t, touch);
    api.updateScene({ ...(next !== all ? { elements: next } : {}), appState: themeAppState(t), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };

  useEffect(() => {
    settings
      .get()
      .then((d) => {
        const p = { styles: d.styles ?? [], defaultStyle: d.defaultStyle ?? "plain" };
        prefsRef.current = p;
        setPrefs(p);
      })
      .catch(() => {});
  }, []);
  const savePrefs = (p) => {
    prefsRef.current = p;
    setPrefs(p);
    settings.save(p).catch(() => toast("Couldn't save your styles"));
  };

  const styleSelection = (style) => {
    const r = applyStyle(api.getSceneElementsIncludingDeleted(), selectedIds(), style, themeRef.current);
    commit(r.elements, { measure: r.measure });
  };
  const saveStyle = (label) => {
    const st = styleFromNote(api.getSceneElements(), selectedIds()[0], label);
    if (st) savePrefs({ ...prefsRef.current, styles: [...prefsRef.current.styles, st] });
    toast(`Saved “${label}”`);
  };
  const replaceText = (find, replacement) => {
    const r = replaceInNotes(api.getSceneElementsIncludingDeleted(), find, replacement);
    if (!r.count) return toast("Nothing to replace");
    commit(r.elements, { measure: true });
    toast(`Replaced ${r.count}×`);
  };

  // QuickZoom: hold Z to see the whole board, let go to zoom back in where the mouse is.
  useEffect(() => {
    if (!api) return;
    let saved = null;
    const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const typing = (e) => api.getAppState().editingTextElement || /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable;
    const down = (e) => {
      if (e.key !== "z" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || saved || typing(e)) return;
      const st = api.getAppState();
      saved = { zoom: st.zoom.value };
      api.scrollToContent(api.getSceneElements(), { fitToContent: true, animate: true, duration: 200 });
      e.stopPropagation();
    };
    const up = (e) => {
      if (e.key !== "z" || !saved) return;
      const st = api.getAppState();
      const p = viewportCoordsToSceneCoords({ clientX: mouse.x, clientY: mouse.y }, st);
      const z = saved.zoom;
      saved = null;
      api.updateScene({
        appState: { zoom: { value: z }, scrollX: st.width / 2 / z - p.x, scrollY: st.height / 2 / z - p.y },
      });
    };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("keydown", down, true);
    addEventListener("keyup", up, true);
    return () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("keydown", down, true);
      removeEventListener("keyup", up, true);
    };
  }, [api]);

  const actMeasured = (fn) => commit(fn(api.getSceneElementsIncludingDeleted(), selectedIds()), { measure: true });

  const background = () => {
    const r = addBackground(api.getSceneElementsIncludingDeleted(), selectedIds(), themeRef.current);
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

  /* ---------- command palette (⌘/) ---------- */
  const titleInput = useRef(null);
  const jumpTo = (id) => {
    const el = api.getSceneElements().find((e) => e.id === id);
    if (!el) return;
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    api.scrollToContent(el, { animate: true, duration: 300 });
  };
  const openNotes = () => {
    api.toggleSidebar({ name: "notes", force: true });
    setTimeout(() => document.querySelector(".notes-panel input[type=search]")?.focus());
  };
  // Re-provided on every render, so the commands always see the current selection.
  useEffect(() => {
    if (!api) return;
    const n = selection.notes;
    const cmd = (group, label, run, more) => ({ id: `${group}:${label}`, group, label, run, ...more });
    const tool = (label, type, shortcut) => cmd("Tools", label, () => api.setActiveTool({ type }), { shortcut });
    return provideCommands("editor", () => [
      ...(n
        ? [
            ...(n > 1
              ? [
                  cmd("Note", "Stack", () => act(stack), { keywords: "column align" }),
                  cmd("Note", "Row", () => act(row), { keywords: "align side" }),
                  cmd("Note", "Same width", () => actMeasured(sameWidth)),
                  cmd("Note", "Connect", connectChain, { keywords: "link join" }),
                  cmd("Note", "Disconnect", disconnectAll, { keywords: "unlink" }),
                ]
              : []),
            cmd("Note", "Background", background, { keywords: "group shape" }),
            cmd("Note", "Copy as text", copyText, { shortcut: "⌘⇧C" }),
            ...[...STYLES, ...prefs.styles].map((st) => cmd("Note", `Style: ${st.label}`, () => styleSelection(st), { id: `style:${st.key}`, keywords: "colour color look", search: true })),
          ]
        : []),
      ...(selection.cell
        ? [
            cmd("Table", "Add row below", () => tableEdit(addRow, true), { keywords: "insert" }),
            cmd("Table", "Add row above", () => tableEdit(addRow, false), { keywords: "insert" }),
            cmd("Table", "Add column right", () => tableEdit(addColumn, true), { keywords: "insert" }),
            cmd("Table", "Add column left", () => tableEdit(addColumn, false), { keywords: "insert" }),
            cmd("Table", "Delete row", () => tableEdit(removeLine, "row"), { keywords: "remove" }),
            cmd("Table", "Delete column", () => tableEdit(removeLine, "col"), { keywords: "remove" }),
          ]
        : []),
      cmd("Board", "Rename board", () => titleInput.current?.select(), { keywords: "title name" }),
      cmd("Board", "Find in notes", openNotes, { keywords: "search replace" }),
      cmd("Board", "Delete board", removeBoard, { keywords: "remove trash", search: true }),
      cmd("Insert", "Table", () => insertTable(), { keywords: "grid cells rows columns" }),
      cmd("Insert", n === 1 && !selection.cell ? "Table in note" : "Text table", textTable, { keywords: "markdown grid rows columns textbox" }),
      cmd("Insert", "Image", () => api.setActiveTool({ type: "image" }), { shortcut: "9", keywords: "picture photo upload file" }),
      cmd("View", "Notes and styles", () => api.toggleSidebar({ name: "notes" }), { keywords: "panel sidebar list" }),
      cmd("View", "Full screen", fullScreen, { keywords: "focus zen" }),
      cmd("View", "Zoom to fit", () => api.scrollToContent(undefined, { fitToContent: true, animate: true, duration: 300 }), { shortcut: "⇧1", keywords: "whole board quickzoom" }),
      cmd("View", "Grid", () => api.updateScene({ appState: { gridModeEnabled: !api.getAppState().gridModeEnabled } }), { shortcut: "⌘'", keywords: "toggle snap" }),
      cmd("View", "Keyboard shortcuts", () => api.updateScene({ appState: { openDialog: { name: "help" } } }), { shortcut: "?", keywords: "help keys" }),
      ...THEMES.map((t) => cmd("Paper", t.label, () => pickTheme(t), { hint: theme.key === t.key ? "current" : "", keywords: "theme colour color background", search: theme.key === t.key })),
      cmd("Export", "Outline", exportOutline, { keywords: "markdown md download" }),
      cmd("Export", "Scapple file", exportScap, { keywords: "scap download" }),
      cmd("Export", "Image", () => api.updateScene({ appState: { openDialog: { name: "imageExport" } } }), { shortcut: "⌘⇧E", keywords: "png svg picture save" }),
      cmd("Export", "Print", printBoard),
      ...(n ? [] : [cmd("Export", "Copy board as text", copyText, { shortcut: "⌘⇧C", keywords: "clipboard scrivener" })]),
      tool("Select", "selection", "V"),
      tool("Hand", "hand", "H"),
      tool("Text", "text", "T"),
      tool("Rectangle", "rectangle", "R"),
      tool("Ellipse", "ellipse", "O"),
      tool("Arrow", "arrow", "A"),
      tool("Line", "line", "L"),
      tool("Draw", "freedraw", "P"),
      tool("Eraser", "eraser", "E"),
      ...listNotes(api.getSceneElements()).map((note) =>
        cmd("Notes", note.text.split("\n")[0].slice(0, 80), () => jumpTo(note.id), { id: `note:${note.id}`, keywords: note.text, search: true }),
      ),
    ]);
  });

  const statusText = {
    saved: "Saved",
    saving: "Saving",
    offline: "Offline, retrying",
    conflict: "Changed elsewhere",
  }[status];

  return (
    <div className="editor" style={{ "--canvas-ink": theme.ink, "--canvas-line": theme.line }}>
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
                ref={titleInput}
                className="title"
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                aria-label="Board name"
                spellCheck={false}
              />
              <span className={"status " + status}>{statusText}</span>
              <button className="pal-open" onClick={openPalette} title="Commands" aria-label="Commands">
                ⌘/
              </button>
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
          <MainMenu.Item onSelect={openPalette} shortcut="⌘/">
            Commands
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={fullScreen}>Full screen</MainMenu.Item>
          <MainMenu.Item onSelect={() => api.toggleSidebar({ name: "notes" })}>Notes and styles</MainMenu.Item>
          <MainMenu.ItemCustom className="theme-picker">
            <span className="theme-label">Paper</span>
            <span className="theme-swatches">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  title={t.label}
                  aria-label={`${t.label} theme`}
                  aria-pressed={theme.key === t.key}
                  className={"theme-swatch" + (theme.key === t.key ? " on" : "")}
                  style={{ background: t.bg, color: t.ink, borderColor: t.line }}
                  onClick={() => pickTheme(t)}
                >
                  a
                </button>
              ))}
            </span>
          </MainMenu.ItemCustom>
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
              <p className="muted">Select a note, then ⌘-double-click to write a connected one.</p>
              <p className="muted">Hold Z to see the whole board. Drop images anywhere.</p>
              <p className="muted">⌘/ for every command.</p>
            </div>
          </WelcomeScreen.Center>
        </WelcomeScreen>
        <NotesPanel
          api={api}
          theme={theme}
          saved={prefs.styles}
          defaultStyle={prefs.defaultStyle}
          selectedNotes={selection.notes}
          onApply={styleSelection}
          onSaveStyle={saveStyle}
          onDeleteStyle={(key) =>
            savePrefs({
              styles: prefs.styles.filter((x) => x.key !== key),
              defaultStyle: prefs.defaultStyle === key ? "plain" : prefs.defaultStyle,
            })
          }
          onSetDefault={(key) => {
            savePrefs({ ...prefs, defaultStyle: key });
            toast("New notes get this style");
          }}
          onReplace={replaceText}
        />
      </Excalidraw>

      <button className="note-count" onClick={() => api?.toggleSidebar({ name: "notes" })} title="Notes and styles">
        {noteCount} {noteCount === 1 ? "note" : "notes"}
      </button>

      <div className="drop-target" ref={dropBox} hidden />
      <svg className="drop-line" ref={preview} aria-hidden="true">
        <line />
      </svg>

      {selection.notes > 0 && (
        <div className="notebar" role="toolbar" aria-label="Note">
          <div className="swatches">
            {STYLES.filter((s) => QUICK.has(s.key)).map((s) => {
              const fill = s.shape?.fill && theme.fills[s.shape.fill.slice(5)];
              return (
                <button
                  key={s.key}
                  title={s.label}
                  aria-label={`Style: ${s.label}`}
                  className={"swatch " + s.key}
                  style={fill ? { background: fill } : undefined}
                  onClick={() => styleSelection(s)}
                >
                  {s.key === "plain" ? "Aa" : ""}
                </button>
              );
            })}
            <button className="more" onClick={() => api.toggleSidebar({ name: "notes", force: true })} title="All styles">
              …
            </button>
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
          {selection.cell ? (
            <>
              <button onClick={() => tableEdit(addRow, true)} title="Add row below">+ Row</button>
              <button onClick={() => tableEdit(addColumn, true)} title="Add column right">+ Column</button>
              <button onClick={() => tableEdit(removeLine, "row")} title="Delete row">− Row</button>
              <button onClick={() => tableEdit(removeLine, "col")} title="Delete column">− Column</button>
            </>
          ) : (
            <>
              <button onClick={background}>Background</button>
              {selection.notes === 1 && (
                <button onClick={textTable} title="Add a table to this note">Table</button>
              )}
            </>
          )}
          <button onClick={copyText} title="⌘⇧C">
            Copy text
          </button>
        </div>
      )}
    </div>
  );
}
