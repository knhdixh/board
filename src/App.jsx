import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { cloud, isAllowed, recordUsage, supabase } from "./store.js";
import { startMetering } from "./usage.js";
import { Toaster, toast } from "./toast.jsx";
import Palette from "./Palette.jsx";
import { provideCommands } from "./commands.js";
import { BOARD_FILES, readBoardFile } from "./boardFile.js";
import { ago } from "./ago.js";
import Home from "./Home.jsx";

const Editor = lazy(() => import("./Editor.jsx"));
const Usage = lazy(() => import("./Usage.jsx"));

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [session, setSession] = useState(supabase ? undefined : null); // undefined while loading
  const [allowed, setAllowed] = useState(null); // null = checking

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // The magic link lands with tokens in the URL hash; tidy it away.
      if (event === "SIGNED_IN" && location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Only the allow-listed owner gets in; the database enforces the same rule.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    // Defer: Supabase calls auth listeners inside its lock, so queries can't run synchronously.
    const t = setTimeout(() =>
      isAllowed()
        .then((ok) => {
          if (!live) return;
          setAllowed(ok);
          if (ok) startMetering(recordUsage);
        })
        .catch(() => live && setAllowed(false)),
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [userId]);

  const navigate = useCallback((to) => {
    if (to === location.pathname) return;
    history.pushState(null, "", to);
    setPath(to);
    scrollTo(0, 0);
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setAllowed(null);
    navigate("/");
  }, [navigate]);

  const store = session && allowed ? cloud : null;
  const boardId = path.match(/^\/b\/([\w-]+)$/)?.[1];

  // Boards for the palette, refreshed whenever you move between pages.
  const boards = useRef([]);
  useEffect(() => {
    if (!store) return;
    store
      .list()
      .then((b) => (boards.current = b))
      .catch(() => {});
  }, [store, path]);

  useEffect(() => {
    if (!store) return;
    const create = async (title, scene) => {
      try {
        const row = await store.create(title, scene);
        navigate(`/b/${row.id}`);
      } catch (e) {
        toast(e.message);
      }
    };
    const importFile = () => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: BOARD_FILES });
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const { title, scene } = await readBoardFile(f);
          await create(title, scene);
        } catch {
          toast("That file couldn't be read");
        }
      };
      input.click();
    };
    return provideCommands("app", () => {
      const others = boards.current.filter((b) => b.id !== boardId);
      return [
        ...(path !== "/" ? [{ id: "home", group: "Go to", label: "All boards", keywords: "home", run: () => navigate("/") }] : []),
        ...others.map((b, i) => ({
          id: `board:${b.id}`,
          group: "Go to",
          label: b.title || "untitled",
          hint: ago(b.updated_at),
          keywords: "board open",
          search: i >= 5, // the five most recent show straight away; type to find the rest
          run: () => navigate(`/b/${b.id}`),
        })),
        { id: "new", group: "Create", label: "New board", run: () => create("untitled", {}) },
        { id: "import", group: "Create", label: "Import file", keywords: "scapple scap excalidraw open upload", run: importFile },
        ...(path !== "/usage" ? [{ id: "usage", group: "Go to", label: "Usage", keywords: "limits storage", search: true, run: () => navigate("/usage") }] : []),
        { id: "signout", group: "Account", label: "Sign out", keywords: "log out", run: signOut },
      ];
    });
  }, [store, path, boardId, navigate, signOut]);

  if (session === undefined || (session && allowed === null)) return null;
  const fallback = <div className="loading">Opening</div>;

  let page;
  if (store && boardId)
    page = (
      <Suspense fallback={fallback}>
        <Editor key={boardId} id={boardId} store={store} navigate={navigate} signOut={signOut} />
      </Suspense>
    );
  else if (store && path === "/usage")
    page = (
      <Suspense fallback={fallback}>
        <Usage navigate={navigate} />
      </Suspense>
    );
  else
    page = (
      <Home store={store} session={session} denied={!!session && !allowed} navigate={navigate} missing={!!boardId && !store} signOut={signOut} />
    );

  return (
    <>
      {page}
      {store && <Palette />}
      <Toaster />
    </>
  );
}
