// Daily Vercel cron: write a heartbeat so the free Supabase project never counts as idle (it pauses after 7 days).
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/heartbeat`, {
    method: "POST",
    headers: {
      apikey: process.env.VITE_SUPABASE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "vercel-cron" }),
  });
  const body = await res.text();
  return Response.json({ ok: res.ok, at: res.ok ? JSON.parse(body) : null, error: res.ok ? undefined : body.slice(0, 200) }, { status: res.ok ? 200 : 502 });
}
