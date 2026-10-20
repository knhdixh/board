// Free-tier limits and how the usage dashboard turns raw numbers into rows.
const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const DAY = 86400_000;

// Free-tier limits (Supabase Free, Vercel Hobby) as published in October 2026.
export const LIMITS = {
  db: 500 * MB,
  supabaseEgress: 5 * GB,
  mau: 50_000,
  storage: 1 * GB,
  idle: 7 * DAY,
  vercelTransfer: 100 * GB,
  invocations: 1_000_000,
};

export const bytes = (n) => {
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(n < 10 * KB ? 1 : 0)} KB`;
  if (n < GB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
};
export const count = (n) => n.toLocaleString("en");
export const ago = (ms) => {
  if (ms < 3600_000) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (ms < DAY) return `${Math.round(ms / 3600_000)} h ago`;
  return `${(ms / DAY).toFixed(1)} days ago`;
};
const pct = (used, limit) => Math.min(100, (used / limit) * 100);
export const pctLabel = (p) => (p === 0 ? "0%" : p < 0.1 ? "<0.1%" : p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`);
export const state = (p) => (p >= 90 ? "at the limit" : p >= 70 ? "getting close" : "fine");

/** Turn raw stats into rows: label, used, limit, percent, note. */
export function rows(s, now = Date.now()) {
  const beats = Object.entries(s.heartbeats ?? {}).map(([source, b]) => ({ source, at: new Date(b.at).getTime(), count: b.count }));
  const last = beats.reduce((m, b) => Math.max(m, b.at), 0);
  const idle = last ? now - last : LIMITS.idle;
  const cron = beats.find((b) => b.source === "vercel-cron");
  const dayOfMonth = new Date(now).getUTCDate();
  return {
    supabase: [
      { label: "Database", used: bytes(s.db_bytes), limit: bytes(LIMITS.db), p: pct(s.db_bytes, LIMITS.db) },
      { label: "Egress", note: "measured", used: bytes(s.month.supabase_bytes), limit: bytes(LIMITS.supabaseEgress), p: pct(s.month.supabase_bytes, LIMITS.supabaseEgress) },
      { label: "Active users", used: count(s.active_users_30d), limit: count(LIMITS.mau), p: pct(s.active_users_30d, LIMITS.mau) },
      { label: "File storage", used: bytes(s.storage_bytes), limit: bytes(LIMITS.storage), p: pct(s.storage_bytes, LIMITS.storage) },
      {
        label: "Idle time",
        note: last ? `last ping ${ago(idle)}` : "no ping yet",
        used: last ? `${(idle / DAY).toFixed(1)} d` : "–",
        limit: "7 d",
        p: pct(idle, LIMITS.idle),
      },
    ],
    vercel: [
      { label: "Bandwidth", note: "measured", used: bytes(s.month.vercel_bytes), limit: bytes(LIMITS.vercelTransfer), p: pct(s.month.vercel_bytes, LIMITS.vercelTransfer) },
      { label: "Function calls", note: "keep-alive cron", used: count(cron ? dayOfMonth : 0), limit: count(LIMITS.invocations), p: pct(dayOfMonth, LIMITS.invocations) },
    ],
    beats,
  };
}

