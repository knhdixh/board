// Runs scripts/e2e.mjs against the real Supabase project with throwaway users:
// one on the allow-list (the test owner) and one that isn't. Both are deleted afterwards.
// Needs SB_SECRET (the project's secret key) in the environment; it is never stored.
//   SB_SECRET=... node scripts/e2e-cloud.mjs [base-url] [shot-dir]
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_KEY;
if (!url || !anonKey || !process.env.SB_SECRET) throw new Error("Need VITE_SUPABASE_URL, VITE_SUPABASE_KEY and SB_SECRET");
const admin = createClient(url, process.env.SB_SECRET, { auth: { persistSession: false } });

async function user(tag) {
  const email = `e2e-${tag}-${Date.now()}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { id: data.user.id, email, session: s.data.session };
}

const owner = await user("owner");
const stranger = await user("stranger");
try {
  const allow = await admin.from("allowed_users").insert({ email: owner.email });
  if (allow.error) throw allow.error;
  const r = spawnSync("node", ["scripts/e2e.mjs", process.argv[2] ?? "http://localhost:5173", process.argv[3] ?? "/tmp"], {
    stdio: "inherit",
    env: { ...process.env, E2E_SESSION: JSON.stringify(owner.session), E2E_DENIED_SESSION: JSON.stringify(stranger.session) },
  });
  process.exitCode = r.status;
} finally {
  await admin.from("allowed_users").delete().eq("email", owner.email);
  await admin.auth.admin.deleteUser(owner.id);
  await admin.auth.admin.deleteUser(stranger.id);
}
