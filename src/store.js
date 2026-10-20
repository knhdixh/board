// Boards live in Supabase, readable only by the owner (row-level security + an allow-list).
import { createClient } from "@supabase/supabase-js";
import { meteredFetch } from "./usage.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { flowType: "implicit" }, global: { fetch: meteredFetch } }) : null;

export class Conflict extends Error {
  constructor() {
    super("This board changed on another device.");
  }
}

const SUMMARY = "id, title, updated_at, version";
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const cloud = {
  list: async () => must(await supabase.from("boards").select(SUMMARY).order("updated_at", { ascending: false })),
  get: async (id) => must(await supabase.from("boards").select("*").eq("id", id).maybeSingle()),
  create: async (title = "untitled", scene = {}) => must(await supabase.from("boards").insert({ title, scene }).select(SUMMARY).single()),
  /** Saves only if nobody else saved since `version`; returns the new version. */
  async save(id, changes, version) {
    const data = must(await supabase.from("boards").update(changes).eq("id", id).eq("version", version).select("version, updated_at").maybeSingle());
    if (!data) throw new Conflict();
    return data;
  },
  async remove(id) {
    must(await supabase.from("boards").delete().eq("id", id));
  },
};

export const isAllowed = async () => must(await supabase.rpc("is_allowed"));
export const usageStats = async () => must(await supabase.rpc("usage_stats"));
export const recordUsage = async (u) => must(await supabase.rpc("record_usage", { visits: u.visits, vercel_bytes: u.vercel_bytes, supabase_bytes: u.supabase_bytes }));

const dataURLToBlob = async (dataURL) => (await fetch(dataURL)).blob();
const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Board images in Storage, at <user id>/<file id>. */
export const images = {
  async upload(file) {
    const { data: s } = await supabase.auth.getSession();
    const { error } = await supabase.storage
      .from("images")
      .upload(`${s.session.user.id}/${file.id}`, await dataURLToBlob(file.dataURL), { contentType: file.mimeType, upsert: true });
    if (error) throw error;
  },
  /** The file as Excalidraw wants it, with its data URL filled in. */
  async download(file) {
    const { data: s } = await supabase.auth.getSession();
    const { data, error } = await supabase.storage.from("images").download(`${s.session.user.id}/${file.id}`);
    if (error) throw error;
    return { ...file, dataURL: await blobToDataURL(data) };
  },
};

export const settings = {
  async get() {
    const row = must(await supabase.from("settings").select("data").maybeSingle());
    return row?.data ?? {};
  },
  async save(data) {
    const { data: s } = await supabase.auth.getSession();
    must(await supabase.from("settings").upsert({ user_id: s.session.user.id, data, updated_at: new Date().toISOString() }));
  },
};
