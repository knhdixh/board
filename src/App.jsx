import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { adoptLocalBoards, cloud, local, supabase } from "./store.js";
import { Toaster, toast } from "./toast.jsx";
import Home from "./Home.jsx";

const Editor = lazy(() => import("./Editor.jsx"));

const GUEST = "board:guest";
const isGuest = () => {
  try {
    return localStorage.getItem(GUEST) === "1";
  } catch {
    return false;
  }
};

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [session, setSession] = useState(supabase ? undefined : null); // undefined while loading
  const [guest, setGuest] = useState(isGuest);

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
      if (event === "SIGNED_IN") {
        // The magic link lands with tokens in the URL hash; tidy it away.
        if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
        // Defer: Supabase calls this inside its auth lock, so queries can't run yet.
        setTimeout(() => {
          adoptLocalBoards()
            .then((n) => n && toast(`Moved ${n} board${n > 1 ? "s" : ""} to your account`))
            .catch(() => toast("Couldn't move this device's boards"));
        });
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const navigate = useCallback((to) => {
    if (to === location.pathname) return;
    history.pushState(null, "", to);
    setPath(to);
    scrollTo(0, 0);
  }, []);

  const setGuestMode = (on) => {
    try {
      if (on) localStorage.setItem(GUEST, "1");
      else localStorage.removeItem(GUEST);
    } catch {
      /* private mode: guest mode lasts this visit */
    }
    setGuest(on);
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setGuestMode(false);
    navigate("/");
  };

  if (session === undefined) return null;
  const store = session ? cloud : guest ? local : null;
  const boardId = path.match(/^\/b\/([\w-]+)$/)?.[1];

  return (
    <>
      {boardId && store ? (
        <Suspense fallback={<div className="loading">Opening</div>}>
          <Editor key={boardId} id={boardId} store={store} navigate={navigate} session={session} signOut={signOut} />
        </Suspense>
      ) : (
        <Home
          store={store}
          session={session}
          navigate={navigate}
          missing={!!boardId && !store}
          startGuest={() => setGuestMode(true)}
          signOut={signOut}
        />
      )}
      <Toaster />
    </>
  );
}
