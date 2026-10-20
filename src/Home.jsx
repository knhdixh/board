import { useEffect, useRef, useState } from "react";
import { startFluid } from "./fluid.js";
import { supabase } from "./store.js";
import { BOARD_FILES, readBoardFile } from "./boardFile.js";
import { openPalette } from "./commands.js";
import { ago } from "./ago.js";
import { toast } from "./toast.jsx";

const WORD = "board";
const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

/** Display heading: characters rise from a mask while cycling glyphs, then a blinking cursor. */
function Display() {
  const refs = useRef([]);
  const [cursor, setCursor] = useState(false);
  useEffect(() => {
    if (reduced()) return setCursor(true);
    const rafs = [];
    refs.current.forEach((ch, i) => {
      const start = 200 + i * 55;
      const settle = start + 420 + i * 30;
      const t0 = performance.now();
      const frame = (now) => {
        const t = now - t0;
        if (t >= settle) return void (ch.textContent = WORD[i]);
        if (t >= start) ch.textContent = rand();
        rafs[i] = requestAnimationFrame(frame);
      };
      rafs[i] = requestAnimationFrame(frame);
    });
    const timer = setTimeout(() => setCursor(true), 200 + WORD.length * 85 + 450);
    return () => {
      rafs.forEach(cancelAnimationFrame);
      clearTimeout(timer);
    };
  }, []);
  return (
    <h1 aria-label={WORD}>
      <span aria-hidden="true">
        {[...WORD].map((c, i) => (
          <span className="mask" key={i}>
            <span className="ch" style={{ "--i": i }} ref={(el) => (refs.current[i] = el)}>
              {c}
            </span>
          </span>
        ))}
      </span>
      <span className={"cursor" + (cursor ? " on" : "")} aria-hidden="true" />
    </h1>
  );
}

/** Decode a row name left to right on hover. */
function decode(el) {
  if (!el || reduced()) return;
  const target = el.dataset.text || (el.dataset.text = el.textContent);
  cancelAnimationFrame(el._raf);
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / 380);
    const fixed = Math.floor(p * target.length);
    let out = target.slice(0, fixed);
    for (let k = fixed; k < target.length; k++) out += target[k] === " " || target[k] === "-" ? target[k] : rand();
    el.textContent = out;
    if (p < 1) el._raf = requestAnimationFrame(frame);
  };
  el._raf = requestAnimationFrame(frame);
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
    if (error) {
      setState("idle");
      setError(error.status === 429 ? "Too many emails. Try again in a while." : /signups not allowed/i.test(error.message) ? "This board is private." : error.message);
    } else setState("sent");
  };
  return (
    <section className="block rise">
      <div className="meta">
        <span>Sign in</span>
        <span>{state === "sent" ? "sent" : "by email"}</span>
      </div>
      {state === "sent" ? (
        <p className="lead">
          Check {email} for a link.{" "}
          <button className="link" onClick={() => setState("idle")}>
            Use another
          </button>
        </p>
      ) : (
        <form onSubmit={submit} className="signin">
          <label className="field">
            <span>Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" disabled={state === "sending"}>
              {state === "sending" ? "Sending" : "Send link"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Boards({ store, session, navigate, signOut }) {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef(null);

  useEffect(() => {
    let live = true;
    store
      .list()
      .then((b) => live && setBoards(b))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [store]);

  const create = async (title, scene) => {
    setBusy(true);
    try {
      const row = await store.create(title, scene);
      navigate(`/b/${row.id}`);
    } catch (e) {
      toast(e.message);
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { title, scene } = await readBoardFile(f);
      await create(title, scene);
    } catch {
      toast("That file couldn't be read");
    }
  };

  return (
    <section className="block">
      <div className="meta rise">
        <span>Boards</span>
        <span className="num">{boards ? String(boards.length).padStart(2, "0") : ""}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {boards && boards.length === 0 && <p className="lead muted rise">No boards yet.</p>}
      {boards && boards.length > 0 && (
        <ul className="rows">
          {boards.map((b, i) => (
            <li key={b.id} style={{ "--i": i }}>
              <a
                className="row"
                href={`/b/${b.id}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  navigate(`/b/${b.id}`);
                }}
                onMouseEnter={(e) => decode(e.currentTarget.querySelector(".name"))}
                onFocus={(e) => decode(e.currentTarget.querySelector(".name"))}
              >
                <span className="mask"><span className="up num">{String(i + 1).padStart(2, "0")}</span></span>
                <span className="mask"><span className="up name">{b.title || "untitled"}</span></span>
                <span className="mask">
                  <span className="up what">
                    <span className="label">{ago(b.updated_at)}</span>
                    <span className="arrow">→</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="actions rise late">
        <button className="primary" disabled={busy} onClick={() => create("untitled", {})}>
          New board
        </button>
        <button className="link" onClick={() => file.current.click()}>
          Import file
        </button>
        <input ref={file} type="file" accept={BOARD_FILES} hidden onChange={onFile} />
      </div>
      <p className="note rise late">
        <button className="link" onClick={openPalette}>
          ⌘/ commands
        </button>{" "}
        · {session.user.email} ·{" "}
        <a
          className="link"
          href="/usage"
          onClick={(e) => {
            e.preventDefault();
            navigate("/usage");
          }}
        >
          Usage
        </a>{" "}
        ·{" "}
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </p>
    </section>
  );
}

export default function Home({ store, session, denied, navigate, missing, signOut }) {
  const page = useRef(null);
  const fluid = useRef(null);
  useEffect(() => {
    const stop = startFluid(fluid.current);
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => page.current?.classList.add("ready"))));
    return () => {
      stop();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home">
      <canvas id="fluid" ref={fluid} aria-hidden="true" />
      <main ref={page}>
        <Display />
        {missing && <p className="lead muted rise">Sign in to open that board.</p>}
        {store ? (
          <Boards store={store} session={session} navigate={navigate} signOut={signOut} />
        ) : denied ? (
          <p className="lead rise">
            This board is private.{" "}
            <button className="link" onClick={signOut}>
              Sign out
            </button>
          </p>
        ) : supabase ? (
          <SignIn />
        ) : (
          <p className="error">Not configured.</p>
        )}
        <footer>
          <span>board.knhdixh.com</span>
          <span>{new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  );
}
