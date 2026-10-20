// Measures what this app transfers, so the dashboard can compare it with the free-tier limits.
// Supabase egress: bytes of every Supabase response. Vercel bandwidth: transfer size of this site's files.
let supabaseBytes = 0;
let vercelBytes = 0;
let visits = 1; // this page load
let flusher = null;

const SKIP = "/rpc/record_usage"; // reporting usage must not create more usage to report

/** fetch for the Supabase client that counts response bytes. */
export async function meteredFetch(input, init) {
  const res = await fetch(input, init);
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes(SKIP)) {
    const len = Number(res.headers.get("content-length"));
    if (len > 0) supabaseBytes += len;
    else
      res
        .clone()
        .arrayBuffer()
        .then((b) => (supabaseBytes += b.byteLength))
        .catch(() => {});
  }
  return res;
}

// Same-origin files (HTML, JS, CSS, fonts) come from Vercel. transferSize is 0 when served from cache.
function countEntry(e) {
  try {
    if (new URL(e.name, location.href).origin === location.origin) vercelBytes += e.transferSize || 0;
  } catch {
    /* ignore odd entries */
  }
}

export function startMetering(report) {
  if (flusher) return;
  for (const e of performance.getEntriesByType("navigation")) countEntry(e);
  for (const e of performance.getEntriesByType("resource")) countEntry(e);
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(countEntry)).observe({ type: "resource", buffered: false });
  } catch {
    /* old browsers: page-load numbers only */
  }
  const flush = async () => {
    if (!visits && !vercelBytes && !supabaseBytes) return;
    const batch = { visits, vercel_bytes: Math.round(vercelBytes), supabase_bytes: Math.round(supabaseBytes) };
    visits = vercelBytes = supabaseBytes = 0;
    try {
      await report(batch);
    } catch {
      visits += batch.visits;
      vercelBytes += batch.vercel_bytes;
      supabaseBytes += batch.supabase_bytes;
    }
  };
  flusher = setInterval(flush, 60_000);
  setTimeout(flush, 5_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}
