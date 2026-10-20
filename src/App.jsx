import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { cloud, isAllowed, recordUsage, supabase } from "./store.js";
import { startMetering } from "./usage.js";
import { Toaster } from "./toast.jsx";
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

  if (session === undefined || (session && allowed === null)) return null;
  const store = session && allowed ? cloud : null;
  const boardId = path.match(/^\/b\/([\w-]+)$/)?.[1];
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
      <Toaster />
    </>
  );
}
