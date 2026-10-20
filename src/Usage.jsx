import { useEffect, useRef, useState } from "react";
import { usageStats } from "./store.js";
import { ago, bytes, count, pctLabel, rows, state } from "./usageRows.js";

function Table({ title, plan, items }) {
  return (
    <section className="block usage-block">
      <div className="meta">
        <span>{title}</span>
        <span>{plan}</span>
      </div>
      <ul className="rows usage-rows">
        {items.map((r, i) => (
          <li key={r.label} style={{ "--i": i, "--p": r.p / 100 }}>
            <div className="usage-row">
              <span className="name">
                {r.label}
                {r.note && <span className="muted small row-note">{r.note}</span>}
              </span>
              <span className="num">
                <span className="used">{r.used}</span> / {r.limit}
              </span>
              <span className="num pct">{pctLabel(r.p)}</span>
            </div>
            <span className="fill" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Usage({ navigate }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const page = useRef(null);

  useEffect(() => {
    usageStats().then(setStats, (e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!stats) return;
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => page.current?.classList.add("ready"))));
    return () => cancelAnimationFrame(raf);
  }, [stats]);

  const back = (
    <a
      className="back link"
      href="/"
      onClick={(e) => {
        e.preventDefault();
        navigate("/");
      }}
    >
      ← Boards
    </a>
  );

  if (error)
    return (
      <main className="usage">
        {back}
        <p className="error">{error}</p>
      </main>
    );
  if (!stats) return <div className="loading">Loading</div>;

  const r = rows(stats);
  const all = [...r.supabase, ...r.vercel];
  const top = all.reduce((m, x) => (x.p > m.p ? x : m), all[0]);

  return (
    <main className="usage" ref={page}>
      {back}
      <h2 className="page-title">usage</h2>
      <div className="stat rise">
        <div className="big">{pctLabel(top.p)}</div>
        <div className="muted small">
          closest to a limit: {top.label.toLowerCase()} · {state(top.p)}
        </div>
      </div>

      <Table title="Supabase" plan="free" items={r.supabase} />
      <Table title="Vercel" plan="hobby" items={r.vercel} />

      <section className="block usage-block">
        <div className="meta">
          <span>Boards</span>
          <span className="num">{String(stats.boards).padStart(2, "0")}</span>
        </div>
        <ul className="rows usage-rows">
          {stats.largest.map((b, i) => (
            <li key={b.id} style={{ "--i": i, "--p": stats.scenes_bytes ? b.bytes / stats.scenes_bytes : 0 }}>
              <a
                className="usage-row"
                href={`/b/${b.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/b/${b.id}`);
                }}
              >
                <span className="name">{b.title || "untitled"}</span>
                <span className="num">{bytes(b.bytes)}</span>
                <span className="num pct">{pctLabel(stats.scenes_bytes ? (b.bytes / stats.scenes_bytes) * 100 : 0)}</span>
              </a>
              <span className="fill" aria-hidden="true" />
            </li>
          ))}
        </ul>
        <p className="note">
          {bytes(stats.scenes_bytes)} of board data in a {bytes(stats.db_bytes)} database. Images are stored inside boards, so they count here.
        </p>
      </section>

      <section className="block usage-block">
        <div className="meta">
          <span>Keep-alive</span>
          <span>daily</span>
        </div>
        <ul className="rows usage-rows">
          {["vercel-cron", "github-actions", "app"].map((source, i) => {
            const b = r.beats.find((x) => x.source === source);
            return (
              <li key={source} style={{ "--i": i, "--p": 0 }}>
                <div className="usage-row">
                  <span className="name">{{ "vercel-cron": "Vercel cron", "github-actions": "GitHub Actions", app: "Using the app" }[source]}</span>
                  <span className="num">{b ? ago(Date.now() - b.at) : "not yet"}</span>
                  <span className="num pct">{b ? `${count(b.count)}×` : ""}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="note">
          Free Supabase projects pause after 7 days without activity. A Vercel cron writes to the database every day, with a GitHub
          Actions ping as a backup, so this one stays awake.
        </p>
      </section>

      <p className="note">
        Database figures are exact. Transfer is measured by this app in every browser you use it in, so traffic from elsewhere (such as the
        Supabase dashboard) isn't counted. This month: {count(stats.month.visits)} visits.
      </p>
      <footer>
        <span>board.knhdixh.com</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}
