import { useEffect, useMemo, useRef, useState } from "react";
import { allCommands, filterCommands } from "./commands.js";

const isPaletteKey = (e) => (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "/" || (e.shiftKey && e.key.toLowerCase() === "p"));

/** The command palette, like Todoist's: ⌘/ anywhere, type to filter, arrows and Enter to run. */
export default function Palette() {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef(null);
  const returnTo = useRef(null);
  const isOpen = useRef(false);

  const show = () => {
    returnTo.current = document.activeElement;
    setCommands(allCommands());
    setQuery("");
    setActive(0);
    setOpen((isOpen.current = true));
  };
  const close = () => {
    setOpen((isOpen.current = false));
    returnTo.current?.focus?.({ preventScroll: true });
  };

  useEffect(() => {
    // Capture, so this wins over Excalidraw's own palette on the same keys.
    const onKey = (e) => {
      if (!isPaletteKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen.current) close();
      else show();
    };
    const onOpen = () => show();
    addEventListener("keydown", onKey, true);
    addEventListener("board:palette", onOpen);
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("board:palette", onOpen);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const grouped = !query.trim();

  useEffect(() => {
    list.current?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const run = (c) => {
    close();
    // After the palette has gone, so focus and keyboard go back to the page first.
    setTimeout(() => Promise.resolve(c.run()).catch((e) => console.error(e)));
  };

  const onKeyDown = (e) => {
    const n = shown.length;
    const move = (d) => {
      e.preventDefault();
      if (n) setActive((a) => (a + d + n) % n);
    };
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (shown[active]) run(shown[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-label="Commands" onKeyDown={onKeyDown}>
        <input
          className="pal-input"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Type a command or search"
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={shown[active] ? `pal-${shown[active].id}` : undefined}
        />
        <ul className="pal-list" id="pal-list" role="listbox" ref={list}>
          {shown.map((c, i) => (
            <li key={c.id} role="presentation">
              {grouped && c.group !== shown[i - 1]?.group && <div className="pal-group">{c.group}</div>}
              <div
                id={`pal-${c.id}`}
                role="option"
                aria-selected={i === active}
                className={"pal-item" + (i === active ? " on" : "")}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => run(c)}
              >
                <span className="pal-label">{c.label}</span>
                {!grouped && <span className="pal-hint">{c.group}</span>}
                {grouped && c.hint && <span className="pal-hint">{c.hint}</span>}
                {c.shortcut && <kbd className="pal-key">{c.shortcut}</kbd>}
              </div>
            </li>
          ))}
          {!shown.length && <li className="pal-empty muted">Nothing matches.</li>}
        </ul>
        <div className="pal-foot">
          <span>↑↓ move · ↵ run · esc close</span>
          <span>⌘/</span>
        </div>
      </div>
    </div>
  );
}
