// Runs the real program-revision trigger on a throwaway local PostgreSQL cluster.
// GitHub's ubuntu runners ship PostgreSQL; the test skips only where it is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chownSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const read = name => readFileSync(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
const guardMigration = read("202611060001_guard_program_state_revisions.sql");
const fixMigration = read("202611140001_fix_program_revision_guard_upsert.sql");

function findPgBin() {
  const root = "/usr/lib/postgresql";
  if (!existsSync(root)) return null;
  const versions = readdirSync(root).filter(v => existsSync(path.join(root, v, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a));
  return versions.length ? path.join(root, versions[0], "bin") : null;
}

// Minimal stand-in for public.user_data_records with the same conflict key the app upserts on.
const schema = `
create table public.user_data_records (
  user_id uuid not null,
  record_type text not null,
  source_record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, record_type, source_record_id)
);`;

function startCluster(bin) {
  const dir = mkdtempSync(path.join(tmpdir(), "bt-pg-"));
  chmodSync(dir, 0o700);
  const asRoot = process.getuid?.() === 0;
  if (asRoot) {
    const pg = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" });
    if (pg.status !== 0) return { skip: "running as root without a postgres user" };
    const uid = Number(pg.stdout.trim());
    const gid = Number(spawnSync("id", ["-g", "postgres"], { encoding: "utf8" }).stdout.trim());
    chownSync(dir, uid, gid);
  }
  const run = (cmd, args, input) => {
    const [file, argv] = asRoot ? ["runuser", ["-u", "postgres", "--", path.join(bin, cmd), ...args]] : [path.join(bin, cmd), args];
    return spawnSync(file, argv, { encoding: "utf8", input, timeout: 60000 });
  };
  const data = path.join(dir, "data");
  const port = String(40000 + Math.floor(Math.random() * 20000));
  let result = run("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync"]);
  if (result.status !== 0) throw new Error("initdb failed: " + result.stderr);
  result = run("pg_ctl", ["-D", data, "-w", "-l", path.join(dir, "log"), "-o", `-k ${dir} -c listen_addresses='' -p ${port} -c fsync=off`, "start"]);
  if (result.status !== 0) throw new Error("pg_ctl start failed: " + result.stderr + result.stdout);
  const sql = text => {
    const out = run("psql", ["-X", "-q", "-h", dir, "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"], text);
    return { ok: out.status === 0, stdout: out.stdout.trim(), stderr: out.stderr.trim() };
  };
  const stop = () => { run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]); rmSync(dir, { recursive: true, force: true }); };
  return { sql, stop };
}

const USER = "00000000-0000-0000-0000-000000000001";
// The same statement shape PostgREST sends for the app's merge-duplicates upsert.
const upsert = (payload, user = USER) => `insert into public.user_data_records (user_id, record_type, source_record_id, payload)
values ('${user}', 'program_state', 'current', '${JSON.stringify(payload)}'::jsonb)
on conflict (user_id, record_type, source_record_id) do update set payload = excluded.payload, updated_at = now();`;

const bin = findPgBin();

test("program revision guard: upserts at revision 2+ succeed after the fix", { skip: bin ? false : "PostgreSQL is not installed" }, t => {
  const cluster = startCluster(bin);
  if (cluster.skip) return t.skip(cluster.skip);
  const { sql, stop } = cluster;
  try {
    assert.ok(sql(schema).ok);
    assert.ok(sql(guardMigration).ok, "original guard installs");

    // Before the fix: the upsert hits the BEFORE INSERT path and is told to start at revision 1.
    assert.ok(sql(upsert({ revision: 1, plan: "a" })).ok);
    const broken = sql(upsert({ revision: 2, plan: "b" }));
    assert.equal(broken.ok, false);
    assert.match(broken.stderr, /new program must start at revision 1/);

    const applied = sql(fixMigration);
    assert.ok(applied.ok, applied.stderr);
    assert.ok(sql(fixMigration).ok, "re-running the migration is safe");

    for (const revision of [2, 3, 4]) {
      const result = sql(upsert({ revision, plan: "rev" + revision }));
      assert.ok(result.ok, `revision ${revision}: ${result.stderr}`);
    }
    assert.equal(sql("select payload->>'revision' from public.user_data_records;").stdout, "4");

    assert.ok(sql(upsert({ revision: 4, plan: "rev4" })).ok, "an identical retry is accepted");
    const sameRevision = sql(upsert({ revision: 4, plan: "other device" }));
    assert.match(sameRevision.stderr, /refresh the current program before editing/, "same revision, different plan is stale");
    const skipped = sql(upsert({ revision: 6, plan: "skipped" }));
    assert.match(skipped.stderr, /refresh the current program before editing/, "a skipped revision is stale");
    const missing = sql(upsert({ plan: "no revision" }));
    assert.match(missing.stderr, /refresh the current program before editing/);

    const other = "00000000-0000-0000-0000-000000000002";
    assert.match(sql(upsert({ revision: 2, plan: "new" }, other)).stderr, /new program must start at revision 1/, "a brand-new plan still starts at 1");
    assert.ok(sql(upsert({ revision: 1, plan: "new" }, other)).ok);

    const update = sql(`update public.user_data_records set payload = '{"revision":5,"plan":"direct"}'::jsonb where user_id = '${USER}';`);
    assert.ok(update.ok, "a plain UPDATE at the next revision still works: " + update.stderr);
    assert.equal(sql("select payload->>'revision' from public.user_data_records where user_id = '" + USER + "';").stdout, "5");
  } finally {
    stop();
  }
});
