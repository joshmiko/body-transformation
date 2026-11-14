import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const line = name => {
  const match = html.match(new RegExp(`^function ${name}\\([^\\n]*$`, "m"));
  assert.ok(match, name);
  return match[0];
};
const slice = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  return html.slice(a, b);
};

const STUCK_ID = "29538b5f-f6a5-4f19-92c7-e8fd92aacbd2";
const week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const program = { __temporary: { endDate: "2037-11-22" }, ...Object.fromEntries(week.map(day => [day, { title: day, exercises: [] }])) };
const row = (overrides = {}) => ({
  id: STUCK_ID, status: "approved", request_version: 2, coach_summary: "Week of Nov 16",
  program_effective_date: "2037-11-16", next_week_program: program, ...overrides
});

function loadCoach({ rows = [], cloud = null, sync = { status: "synced" }, db = {} } = {}) {
  const calls = { patches: [], audits: [], applied: [], saves: 0 };
  const el = { innerHTML: "" };
  const supabase = {
    sessionActive: () => true,
    currentUser: () => ({ id: "user-1" }),
    listCoachUpdateRequests: async () => rows.map(r => ({ ...r })),
    getCanonicalProgramState: async () => (typeof cloud === "function" ? cloud() : cloud),
    reviewCoachUpdateRequest: async (id, patch) => {
      calls.patches.push({ id, ...patch });
      return [{ ...rows.find(r => r.id === id), status: patch.status, request_version: patch.expectedVersion + 1 }];
    },
    appendCoachUpdateAudit: async event => { calls.audits.push(event); return [event]; },
    applyProgramStateToDb: (target, value) => { target.programState = value; target.temporaryProgram = value.temporaryProgram || null; target.weeklyPrograms = value.weeklyPrograms || []; }
  };
  const context = {
    db: { coachSync: {}, ...db },
    window: { btSupabase: supabase },
    document: { getElementById: id => (id === "coach-inbox-card" ? el : null) },
    location: { reload: () => {} },
    today: () => "2037-11-14",
    nextMonday: () => "2037-11-16",
    dateLabel: value => String(value),
    validCalendarDate: () => true,
    weekStart: value => { const d = new Date(String(value).slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; },
    localDateKey: d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"),
    calendarDayName: d => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()],
    gamesOnDate: () => [],
    programDayDate: () => "2037-11-16",
    coachRequestProgramMarkup: () => "",
    coachTargetGuidanceMarkup: () => "",
    weeklyPrograms: () => context.db.weeklyPrograms || [],
    cloneValue: value => JSON.parse(JSON.stringify(value)),
    save: () => { calls.saves++; return Promise.resolve(sync); },
    applyCoachRequestLocally: request => {
      calls.applied.push(request.id);
      context.db.lastCoachRequestId = request.id;
      return Promise.resolve(typeof sync === "function" ? sync() : sync);
    }
  };
  vm.createContext(context);
  vm.runInContext([
    line("escapeHtml"),
    line("coachSyncState"),
    slice("function coachProgramEffectiveDate(row)", "function coachRequestWeightEntries(row)"),
    slice("function coachRequestWeightEntries(row)", "function prepareCoachWeightEntries(row)"),
    slice("async function reviewCoachRequest(id,action)", "function progress()")
  ].join("\n"), context);
  return { context, calls, el, supabase };
}

const cardFor = (markup, id) => {
  const start = markup.indexOf(`data-coach-request="${id}"`);
  if (start < 0) return null;
  const next = markup.indexOf("data-coach-request=", start + 1);
  return markup.slice(start, next < 0 ? undefined : next);
};

test("sync reports a genuine stale plan separately from other program rejections", async () => {
  const storage = new Map([["bt_supabase_session", JSON.stringify({ access_token: "t", user: { id: "user-1" } })]]);
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const supabase = await import("../src/supabase-rest.js?coach-review-recovery-test");
  const db = () => ({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [], programState: { revision: 2, updatedAt: "2037-11-14T10:00:00Z" } });
  const failWith = text => { globalThis.fetch = async (url, options = {}) => options.method === "POST" ? { ok: false, status: 400, text: async () => text } : { ok: true, status: 200, json: async () => [], text: async () => "" }; };

  failWith("PROGRAM_REVISION_CONFLICT: new program must start at revision 1");
  const rejected = await supabase.syncLocalDb(db());
  assert.equal(rejected.errorCode, "PROGRAM_REJECTED");
  assert.equal(rejected.offline, false);

  failWith("PROGRAM_REVISION_CONFLICT: refresh the current program before editing");
  const stale = await supabase.syncLocalDb(db());
  assert.equal(stale.errorCode, "PROGRAM_CONFLICT");
});

test("only a stale plan asks for a refresh; everything else offers Try again with plain wording", () => {
  const { context } = loadCoach();
  const map = error => context.describeCoachError(error, "apply");
  assert.equal(map({ code: "PROGRAM_CONFLICT" }).refresh, true);
  assert.match(map({ code: "PROGRAM_CONFLICT" }).message, /Another device changed your plan/);
  assert.equal(map(new Error("Coach update changed elsewhere. Refresh and review the latest version.")).refresh, true);
  for (const error of [{ code: "PROGRAM_REJECTED" }, { code: "SYNC_UNAVAILABLE" }, { code: "NOT_CONFIRMED" }, { code: "AUTH_REQUIRED" }, new Error("Supabase request failed (400): PROGRAM_REVISION_CONFLICT: new program must start at revision 1")]) {
    const described = map(error);
    assert.equal(described.refresh, undefined, JSON.stringify(error));
    assert.doesNotMatch(described.message, /another device|PROGRAM_|Supabase|ChatGPT|proposal|update/i);
  }
  assert.match(map(Object.assign(new Error("Weight conflict: 2037-11-14"), { userFacing: true })).message, /Weight conflict/);
});

test("a failed apply shows its error on that card only, and retrying clears it", async () => {
  let syncResult = { status: "pending", errorCode: "PROGRAM_REJECTED" };
  const other = row({ id: "other-plan", status: "submitted", request_version: 1 });
  const { context, el, calls } = loadCoach({ rows: [row(), other], cloud: { revision: 3 }, sync: () => syncResult });
  await context.loadCoachInbox();
  await context.reviewCoachRequest(STUCK_ID, "apply");
  const failed = cardFor(el.innerHTML, STUCK_ID);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /The cloud didn't accept your plan/);
  assert.match(failed, />Try again</);
  assert.doesNotMatch(failed, /Another device/);
  assert.doesNotMatch(cardFor(el.innerHTML, "other-plan"), /role="alert"/);

  syncResult = { status: "synced" };
  let cloudAfter = { revision: 4, lastCoachRequestId: STUCK_ID };
  context.window.btSupabase.getCanonicalProgramState = async () => (calls.applied.length > 1 ? cloudAfter : { revision: 3 });
  await context.reviewCoachRequest(STUCK_ID, "apply");
  assert.equal(cardFor(el.innerHTML, STUCK_ID), null, "applied plan leaves the inbox");
  assert.doesNotMatch(el.innerHTML, /role="alert"/);
  assert.deepEqual(calls.patches.map(p => p.status), ["applied"]);
});

test("an approved plan the cloud already carries is marked applied on load without re-applying it", async () => {
  for (const cloud of [
    { revision: 5, temporaryProgram: { requestId: STUCK_ID } },
    { revision: 5, lastCoachRequestId: STUCK_ID }
  ]) {
    const { context, el, calls } = loadCoach({ rows: [row()], cloud });
    await context.loadCoachInbox();
    assert.deepEqual(calls.patches.map(p => [p.id, p.status, p.expectedVersion]), [[STUCK_ID, "applied", 2]]);
    assert.deepEqual(calls.applied, [], "program is not applied again");
    assert.deepEqual(calls.audits.map(a => [a.event_type, a.details.recovered]), [["applied", true]]);
    assert.ok(context.db.coachSync.appliedRequests.includes(STUCK_ID));
    assert.equal(cardFor(el.innerHTML, STUCK_ID), null);
  }

  const { context, calls, el } = loadCoach({ rows: [row()], cloud: { revision: 5, lastCoachRequestId: "something-else" } });
  await context.loadCoachInbox();
  assert.deepEqual(calls.patches, [], "an unconfirmed plan is left for the person to decide");
  assert.ok(cardFor(el.innerHTML, STUCK_ID));
});

test("tapping Finish applying on a plan the cloud already carries only marks it applied", async () => {
  const { context, calls } = loadCoach({ rows: [row()], cloud: { revision: 5 } });
  await context.loadCoachInbox();
  context.window.btSupabase.getCanonicalProgramState = async () => ({ revision: 5, lastCoachRequestId: STUCK_ID });
  await context.reviewCoachRequest(STUCK_ID, "apply");
  assert.deepEqual(calls.applied, []);
  assert.deepEqual(calls.patches.map(p => p.status), ["applied"]);
});

test("an approved-but-not-applied plan always offers retry and a way to keep the current plan", async () => {
  const currentPlan = { revision: 3, lastCoachRequestId: "older-plan", weeklyPrograms: [] };
  const db = { lastCoachRequestId: STUCK_ID, weeklyPrograms: [{ requestId: STUCK_ID }], temporaryProgram: { requestId: STUCK_ID }, coachSync: { appliedRequests: [STUCK_ID] } };
  const { context, el, calls } = loadCoach({ rows: [row()], cloud: currentPlan, db });
  await context.loadCoachInbox();
  const card = cardFor(el.innerHTML, STUCK_ID);
  assert.match(card, /Finish applying plan/);
  assert.match(card, />Keep current plan</);
  assert.doesNotMatch(card, /disabled/);

  await context.reviewCoachRequest(STUCK_ID, "reject");
  assert.deepEqual(calls.patches, [], "the database only allows approved → applied, so nothing is patched");
  assert.equal(context.db.lastCoachRequestId, "older-plan");
  assert.equal(context.db.temporaryProgram, null);
  assert.deepEqual([...context.db.weeklyPrograms], []);
  assert.deepEqual([...context.db.coachSync.appliedRequests], []);
  assert.deepEqual([...context.db.coachSync.dismissedRequests], [STUCK_ID]);
  assert.equal(cardFor(el.innerHTML, STUCK_ID), null);
});

test("a blocked plan shows a disabled action with its reason instead of hiding the button", async () => {
  const past = row({ id: "past-plan", status: "submitted", request_version: 1, program_effective_date: "2037-11-02", next_week_program: { Monday: { title: "A", exercises: [] } } });
  const { context, el, calls } = loadCoach({ rows: [past] });
  await context.loadCoachInbox();
  const card = cardFor(el.innerHTML, "past-plan");
  assert.match(card, /<button class=primary[^>]*disabled aria-disabled="true"[^>]*>Approve &amp; apply|<button class=primary[^>]*disabled aria-disabled="true"[^>]*>Approve & apply/);
  assert.match(card, /coach-blocked-reason[^>]*>This program effective date is in the past/);
  assert.match(card, /Reject \/ keep current plan/);
  await context.reviewCoachRequest("past-plan", "approve");
  assert.deepEqual(calls.patches, []);

  const stale = row({ id: "stale-plan", status: "submitted", request_version: 1, next_week_program: null, expected_watermark: "2037-11-01T00:00:00Z" });
  const blocked = loadCoach({ rows: [stale], db: { coachSync: { reviewedWatermark: "2037-11-10T00:00:00Z" } } });
  await blocked.context.loadCoachInbox();
  assert.match(cardFor(blocked.el.innerHTML, "stale-plan"), /disabled aria-disabled="true"[\s\S]*older data than a plan you already reviewed/);
});

test("the Coach review card says Coach and plan", async () => {
  const { context, el } = loadCoach({ rows: [row({ id: "fresh", status: "submitted", request_version: 1 })] });
  await context.loadCoachInbox();
  const text = el.innerHTML.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /ChatGPT|proposal|update/i);
  assert.match(text, /COACH PLAN/);
});
