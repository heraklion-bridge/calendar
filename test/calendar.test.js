import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCalendar, passwordHash } from "../server.js";
import { publication, validateRecords } from "../publication.js";
import { sessions, automaticHolidays } from "../public/schedule.js";

const regular = {
  id: "r1",
  kind: "regular",
  title: "Ζεύγη",
  start: "2027-01-04",
  end: "2027-12-27",
  time: "19:30",
};
const special = {
  id: "s1",
  kind: "special",
  title: "Τριήμερο",
  dates: ["2027-02-01", "2027-02-01", "2027-04-01"],
  times: ["18:00", "20:00", "19:00"],
  grade: "Χωρίς βαθμίδα",
  replaces: [{ id: "r1", date: "2027-02-01" }],
};
const lesson = {
  id: "l1",
  kind: "lesson",
  title: "Μαθήματα",
  start: "2026-12-28",
  count: 29,
  time: "18:00",
  cycleSizes: [9, 10, 10],
};
const holiday = {
  id: "h1",
  kind: "holiday",
  title: "Διακοπές",
  start: "2027-01-04",
  blocks: ["lesson"],
};

test("Greek holidays, year numbering, independently numbered lessons and moved games", () => {
  const sequence = { ...regular, start: "2026-12-21", end: "2027-03-29" };
  const expanded = sessions(sequence, []);
  assert.deepEqual(
    expanded.slice(0, 3).map((e) => e.number),
    [1, 2, 1],
  );
  const year = sessions(regular, []);
  assert.equal(year.at(-1).groupTotal, 5);
  const lessons = sessions(lesson, [holiday]);
  assert.equal(lessons[1].date, "2027-01-11");
  assert.deepEqual(
    [lessons[8], lessons[9], lessons[19]].map((e) => [e.cycle, e.cycleNumber]),
    [
      [1, 9],
      [2, 1],
      [3, 1],
    ],
  );
  assert.equal(
    automaticHolidays(2027, []).find((e) => e.title === "Κυριακή του Πάσχα")
      .start,
    "2027-05-02",
  );
  const moved = sessions(
    {
      ...regular,
      overrides: { "2027-01-04": { date: "2027-01-05", time: "16:00" } },
    },
    [],
  );
  assert.deepEqual(
    [moved[0].date, moved[0].time, moved[0].number],
    ["2027-01-05", "16:00", 1],
  );
});

test("pending records retain the previous revision and only approved replacements affect output", () => {
  const build = (records, old) =>
    publication({ records, cutoff: "2027-03", revision: 0 }, old, "2027-01-01");
  const excluded = { ...regular, excluded: ["2027-02-01"] };
  const pending = build([
    excluded,
    { ...special, pending: true },
    { ...holiday, pending: true },
    lesson,
  ]);
  assert(pending.events.some((e) => e.id === "r1" && e.date === "2027-02-01"));
  assert(pending.events.some((e) => e.id === "l1" && e.date === "2027-01-04"));
  assert(!pending.events.some((e) => e.id === "s1" || e.id === "h1"));
  const approved = build([excluded, special]);
  assert.equal(approved.events.filter((e) => e.id === "s1").length, 2);
  assert(
    !approved.events.some((e) => e.id === "r1" && e.date === "2027-02-01"),
  );
  assert(
    approved.events.every(
      (e) => e.date < "2027-04-01" && !("overrides" in e) && !("replaces" in e),
    ),
  );
  const moved = {
    ...special,
    title: "Ιδιωτικός τίτλος",
    dates: ["2027-02-08"],
    times: ["20:00"],
    replaces: [{ id: "r1", date: "2027-02-08" }],
    pending: true,
  };
  const movedRegular = { ...regular, excluded: ["2027-02-08"] };
  assert.deepEqual(
    build([movedRegular, moved], approved).events,
    approved.events,
  );
  const other = {
    ...moved,
    id: "s2",
    pending: false,
    replaces: special.replaces,
    dates: ["2027-02-01"],
  };
  const overlap = build([excluded, { ...special, pending: true }, other]);
  assert(!overlap.events.some((e) => e.id === "r1" && e.date === "2027-02-01"));
  const restored = build([regular, { ...moved, pending: false }], approved);
  assert(restored.events.some((e) => e.id === "r1" && e.date === "2027-02-01"));
});
test("extending a prior cutoff cannot publish previously hidden pending entries", () => {
  const hidden = {
    ...special,
    id: "hidden",
    dates: ["2027-04-01"],
    times: ["19:00"],
    replaces: [],
  };
  const draft = {
    records: [regular, special, hidden],
    cutoff: "2027-03",
    revision: 0,
  };
  const previous = publication(draft, null, "2027-01-01");
  const next = publication(
    {
      ...draft,
      cutoff: "2027-04",
      records: [
        regular,
        { ...special, pending: true },
        { ...hidden, pending: true },
      ],
    },
    previous,
    "2027-01-01",
  );
  assert(!next.events.some((e) => e.id === "hidden"));
  assert.equal(next.events.filter((e) => e.id === special.id).length, 2);
});

test("historical corrections require explicit activation and report impact", () => {
  const draft = { records: [regular, special], cutoff: "2027-03", revision: 0 };
  const original = publication(draft, null, "2027-03-05");
  const change = { ...draft, records: [{ ...regular, title: "Νέος τίτλος" }] };
  const frozen = publication(change, original, "2027-03-05");
  assert(frozen.pastChanges > 0);
  assert.deepEqual(
    frozen.events.filter((e) => e.date < "2027-03-05"),
    original.events.filter((e) => e.date < "2027-03-05"),
  );
  assert(
    publication(
      { ...change, retroactive: true },
      original,
      "2027-03-05",
    ).events.some((e) => e.date < "2027-03-05" && e.title === "Νέος τίτλος"),
  );
});

test("authenticated draft, exact legacy JSON, CSRF, concurrent edits, atomic publish and rollback", async (t) => {
  const origin = "https://calendar.example.org";
  const directory = mkdtempSync(join(tmpdir(), "omh-integration-"));
  const dbPath = join(directory, "calendar.sqlite");
  const password = "synthetic integration-test phrase";
  const server = createCalendar({
    origin,
    dbPath,
    users: { admin: await passwordHash(password) },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port + "/api/";
  const call = (route, body, cookie, source = origin) =>
    fetch(
      base + route,
      body === undefined
        ? { headers: cookie ? { cookie } : {} }
        : {
            method: "POST",
            headers: {
              origin: source,
              "content-type": "application/json",
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
          },
    );
  const value = async (response) => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.equal((await call("draft")).status, 401);
  assert.equal((await call("preview", { records: [] })).status, 401);
  assert.equal(
    (
      await call(
        "login",
        { username: "admin", password },
        null,
        "https://example.org",
      )
    ).status,
    403,
  );
  const login = await call("login", { username: "admin", password });
  await value(login);
  const setCookie = login.headers.get("set-cookie");
  assert.match(
    setCookie,
    /^__Host-omh_session=.+; HttpOnly; SameSite=Strict; Secure$/,
  );
  const cookie = setCookie.split(";")[0];
  const records = [
    [
      4,
      {
        ...regular,
        excluded: ["2027-01-11"],
        independent: ["2027-03-01"],
        overrides: { "2027-03-01": { time: "20:00", simultaneous: true } },
        notes: "Συνθετικό",
      },
    ],
    [14, special],
    [5, lesson],
    [13, { kind: "external", title: "Εξωτερική", start: "2027-02-08" }],
    [
      1,
      { kind: "other", title: "Εκδήλωση", start: "2027-03-31", time: "16:00" },
    ],
    [24, holiday],
  ].flatMap(([count, record]) =>
    Array.from({ length: count }, (_, i) => ({
      ...record,
      id: record.kind + "-" + i,
    })),
  );
  assert.equal(records.length, 61);
  validateRecords(records);
  await value(
    await call(
      "validate",
      { format: "omh-calendar-demo", version: 1, records },
      cookie,
    ),
  );
  assert.equal(
    (
      await call(
        "validate",
        {
          format: "omh-calendar-demo",
          version: 1,
          records: [...records, records[0]],
        },
        cookie,
      )
    ).status,
    400,
  );
  const draft = { records, cutoff: "2027-03", revision: 0 };
  const concurrent = await Promise.all([
    call("draft", draft, cookie),
    call("draft", draft, cookie),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(
    (await value(await call("draft", undefined, cookie))).records,
    records,
  );
  draft.revision = 1;
  const preview = await value(await call("preview", draft, cookie));
  assert.deepEqual(await value(await call("public")), { events: [] });
  assert.equal(
    (await call("publish", { ...draft, token: "incorrect" }, cookie)).status,
    409,
  );
  assert.deepEqual(await value(await call("public")), { events: [] });
  await value(
    await call("publish", { ...draft, token: preview.token }, cookie),
  );
  assert.deepEqual((await value(await call("public"))).events, preview.events);
  assert(preview.events.some((e) => e.date === "2027-03-31"));
  const second = {
    ...draft,
    records: [],
    cutoff: "2027-02",
    revision: 2,
    retroactive: true,
  };
  const next = await value(await call("preview", second, cookie));
  const adminDb = new DatabaseSync(dbPath);
  adminDb.exec(
    "CREATE TRIGGER fail_publish BEFORE UPDATE OF published ON state BEGIN SELECT RAISE(ABORT,'test storage failure'); END",
  );
  try {
    const failed = await call(
      "publish",
      { ...second, token: next.token },
      cookie,
    );
    assert.equal(failed.status, 500);
    assert(!(await failed.text()).includes("test storage failure"));
    assert.deepEqual(
      (await value(await call("public"))).events,
      preview.events,
    );
    assert.equal(
      (await value(await call("draft", undefined, cookie))).revision,
      2,
    );
    assert.equal(
      (await value(await call("history", undefined, cookie))).versions.length,
      1,
    );
  } finally {
    adminDb.exec("DROP TRIGGER fail_publish");
    adminDb.close();
  }
  await value(await call("publish", { ...second, token: next.token }, cookie));
  await value(await call("restore", { revision: 3, id: 1 }, cookie));
  assert.deepEqual((await value(await call("public"))).events, preview.events);
  assert.deepEqual(
    (await value(await call("draft", undefined, cookie))).records,
    [],
  );
  const destination = join(directory, "backup.sqlite");
  const backup = spawnSync(
    process.execPath,
    [new URL("../scripts/backup.js", import.meta.url).pathname, destination],
    { env: { ...process.env, DB_PATH: dbPath }, encoding: "utf8" },
  );
  assert.equal(backup.status, 0, backup.stderr);
  const restored = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    const published = restored
      .prepare(
        "SELECT events FROM versions JOIN state ON versions.id=state.published",
      )
      .get();
    assert.deepEqual(JSON.parse(published.events), preview.events);
    assert.equal(
      restored.prepare("SELECT revision FROM state").get().revision,
      4,
    );
  } finally {
    restored.close();
  }
  await value(await call("logout", {}, cookie));
  assert.equal((await call("draft", undefined, cookie)).status, 401);
});
