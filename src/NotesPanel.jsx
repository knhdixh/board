import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@excalidraw/excalidraw";
import { findNotes, listNotes } from "./scapple/notes.js";
import { STYLES, resolveStyle } from "./scapple/styles.js";

/** A small picture of a style: its shape colours with an "Aa" in its text colour. */
function StyleChip({ style, theme }) {
  const { shape, text } = resolveStyle(style, theme);
  const s = shape && shape !== "keep" ? shape : null;
  return (
    <span
      className="style-chip"
      style={{
        background: s?.backgroundColor !== "transparent" ? s?.backgroundColor : theme.bg,
        borderColor: s?.strokeColor && s.strokeColor !== "transparent" ? s.strokeColor : "transparent",
        borderStyle: s?.strokeStyle === "dashed" ? "dashed" : "solid",
        borderRadius: s && !s.roundness ? 0 : 6,
        color: text.strokeColor,
        fontSize: text.fontSize ? 14 : 11,
      }}
      aria-hidden="true"
    >
      Aa
    </span>
  );
}

/**
 * The Notes panel: every note on the board (find, jump to it, replace text) and your note styles
 * (apply to the selection, save a note's look, choose the style new notes get).
 */
export default function NotesPanel({ api, theme, saved, defaultStyle, selectedNotes, onApply, onSaveStyle, onDeleteStyle, onSetDefault, onReplace }) {
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [naming, setNaming] = useState(null);

  // Follow the board, but not on every pointer move.
  useEffect(() => {
    if (!api) return;
    let t;
    const update = () => setNotes(listNotes(api.getSceneElements()));
    update();
    const off = api.onChange(() => {
      clearTimeout(t);
      t = setTimeout(update, 250);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [api]);

  const shown = useMemo(() => findNotes(notes, query), [notes, query]);

  const jump = (id) => {
    const el = api.getSceneElements().find((e) => e.id === id);
    if (!el) return;
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    api.scrollToContent(el, { animate: true, duration: 300 });
  };

  const styles = [...STYLES, ...saved];

  return (
    <Sidebar name="notes" className="notes-panel">
      <Sidebar.Header>
        <span className="panel-title">
          Notes <span className="muted">{notes.length}</span>
        </span>
      </Sidebar.Header>
      <div className="panel-body">
        <label className="field">
          <span>Find</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Words in any note" spellCheck={false} />
        </label>
        {query.trim() && (
          <form
            className="replace"
            onSubmit={(e) => {
              e.preventDefault();
              onReplace(query, replacement);
            }}
          >
            <label className="field">
              <span>Replace with</span>
              <input value={replacement} onChange={(e) => setReplacement(e.target.value)} spellCheck={false} />
            </label>
            <button className="link" disabled={!shown.length}>
              Replace in {shown.length} {shown.length === 1 ? "note" : "notes"}
            </button>
          </form>
        )}

        <ul className="panel-list">
          {shown.map((n) => (
            <li key={n.id}>
              <button className="panel-row" onClick={() => jump(n.id)}>
                <span className="panel-text">{n.text.split("\n")[0]}</span>
                {n.links > 0 && <span className="muted">{n.links}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted panel-empty">{query ? "No notes match." : "Double-click the board to write one."}</li>}
        </ul>

        <div className="meta panel-meta">
          <span>Styles</span>
          <span>{selectedNotes ? `${selectedNotes} selected` : "select notes"}</span>
        </div>
        <ul className="panel-list styles">
          {styles.map((s) => (
            <li key={s.key} className="style-row">
              <button className="panel-row" disabled={!selectedNotes} onClick={() => onApply(s)} title={selectedNotes ? `Apply to the selection` : "Select notes first"}>
                <StyleChip style={s} theme={theme} />
                <span className="panel-text">{s.label}</span>
              </button>
              <label className="default-toggle" title="New notes get this style">
                <input type="radio" name="default-style" checked={defaultStyle === s.key} onChange={() => onSetDefault(s.key)} />
                <span>{defaultStyle === s.key ? "new notes" : ""}</span>
              </label>
              {s.key.startsWith("saved:") && (
                <button className="remove" aria-label={`Delete ${s.label}`} onClick={() => onDeleteStyle(s.key)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {selectedNotes === 1 &&
          (naming === null ? (
            <button className="link save-style" onClick={() => setNaming("")}>
              Save this note's style
            </button>
          ) : (
            <form
              className="replace"
              onSubmit={(e) => {
                e.preventDefault();
                onSaveStyle(naming.trim() || "My style");
                setNaming(null);
              }}
            >
              <label className="field">
                <span>Style name</span>
                <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} />
              </label>
              <button className="link">Save</button>
            </form>
          ))}
      </div>
    </Sidebar>
  );
}
