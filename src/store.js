// Where boards live: your Supabase account when signed in, this browser's storage otherwise.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { flowType: "implicit" } }) : null;

export class Conflict extends Error {
  constructor() {
    super("This board changed on another device.");
  }
}

const SUMMARY = "id, title, updated_at, version";

export const cloud = {
  kind: "cloud",
  async list() {
    const { data, error } = await supabase.from("boards").select(SUMMARY).order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
  async get(id) {
    const { data, error } = await supabase.from("boards").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async create(title = "untitled", scene = {}) {
    const { data, error } = await supabase.from("boards").insert({ title, scene }).select(SUMMARY).single();
    if (error) throw error;
    return data;
  },
  /** Saves only if nobody else saved since `version`; returns the new version. */
  async save(id, changes, version) {
    const { data, error } = await supabase
      .from("boards")
      .update(changes)
      .eq("id", id)
      .eq("version", version)
      .select("version, updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Conflict();
    return data;
  },
  async remove(id) {
    const { error } = await supabase.from("boards").delete().eq("id", id);
    if (error) throw error;
  },
};

const INDEX = "board:index";
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const local = {
  kind: "local",
  async list() {
    return read(INDEX, []).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  },
  async get(id) {
    const row = read(INDEX, []).find((b) => b.id === id);
    return row ? { ...row, scene: read("board:" + id, {}) } : null;
  },
  async create(title = "untitled", scene = {}) {
    const row = { id: crypto.randomUUID(), title, updated_at: new Date().toISOString(), version: 1 };
    write("board:" + row.id, scene);
    write(INDEX, [...read(INDEX, []), row]);
    return row;
  },
  async save(id, changes) {
    const rows = read(INDEX, []);
    const row = rows.find((b) => b.id === id);
    if (!row) throw new Error("Board not found");
    if (changes.scene) {
      try {
        write("board:" + id, changes.scene);
      } catch {
        throw new Error("This browser is out of space. Sign in to keep big boards.");
      }
    }
    if (changes.title !== undefined) row.title = changes.title;
    row.updated_at = new Date().toISOString();
    row.version += 1;
    write(INDEX, rows);
    return { version: row.version, updated_at: row.updated_at };
  },
  async remove(id) {
    localStorage.removeItem("board:" + id);
    write(INDEX, read(INDEX, []).filter((b) => b.id !== id));
  },
};

/** After signing in, move boards made on this device into the account. Returns how many moved. */
export async function adoptLocalBoards() {
  const rows = await local.list();
  let moved = 0;
  for (const row of rows) {
    const full = await local.get(row.id);
    await cloud.create(full.title, full.scene);
    await local.remove(row.id);
    moved++;
  }
  return moved;
}
