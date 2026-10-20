import { useEffect, useState } from "react";

export const toast = (message) => dispatchEvent(new CustomEvent("board:toast", { detail: message }));

export function Toaster() {
  const [item, setItem] = useState(null);
  useEffect(() => {
    let timer;
    const on = (e) => {
      clearTimeout(timer);
      setItem({ text: e.detail, key: Date.now() });
      timer = setTimeout(() => setItem(null), 3000);
    };
    addEventListener("board:toast", on);
    return () => {
      removeEventListener("board:toast", on);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="toast" role="status" aria-live="polite">
      {item && (
        <span key={item.key} className="toast-text">
          {item.text}
        </span>
      )}
    </div>
  );
}
