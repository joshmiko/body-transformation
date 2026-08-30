import { writeFile } from "node:fs/promises";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");

const js = `globalThis.__BT_CONFIG__ = ${JSON.stringify({
  supabaseUrl: url,
  supabaseAnonKey: key
})};`;
await writeFile("env.js", js + "\n", "utf8");
console.log("Generated runtime configuration.");
