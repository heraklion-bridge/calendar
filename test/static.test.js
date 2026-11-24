import { test } from "node:test";
import assert from "node:assert/strict";
import { blankState, readBackup, confirmedVersion } from "../private-state.js";
import {
  emptySnapshot,
  parsePublic,
  newSnapshot,
  projectPublic,
  sameSnapshot,
} from "../snapshot.js";
import { publication } from "../publication.js";
import { publishCalendar } from "../publisher/publish.js";
import { records, regular, pending, special } from "../fixtures/synthetic.js";

const build = (
  records,
  previous = null,
  cutoff = "2027-03",
  basePublicationId = null,
) => {
  const result = publication({ records, cutoff }, previous, "2027-01-01");
  const { rows, seriesIds } = projectPublic(result.events);
  return {
    document: newSnapshot({ cutoff, basePublicationId, events: rows }),
    records: result.records,
    seriesIds,
  };
};
const served = (document) => ({
  ...document,
  publishedAt: "2026-12-01T13:00:00.000Z",
});
test("61 legacy records round-trip and expose only validated public fields", () => {
  assert.equal(records.length, 61);
  const backup = readBackup({
    format: "omh-calendar-demo",
    version: 1,
    records,
  });
  assert.deepEqual(backup.records, records);
  backup.cutoff = "2027-03";
  const candidate = build(backup.records);
  backup.versions.push(candidate);
  const serialized = JSON.stringify(candidate.document);
  assert(
    !serialized.includes("ΑΠΟΚΛΕΙΣΤΙΚΑ") &&
      !serialized.includes("private-series") &&
      !serialized.includes("Ιδιωτική συνθετική"),
  );
  assert(
    candidate.document.events.some(
      (event) => event.title === regular.title && event.date === "2027-03-01",
    ),
  );
  assert.equal(
    candidate.document.events.filter((event) => event.title === special.title)
      .length,
    2,
  );
  assert(
    candidate.document.events.some((event) => event.date === "2027-03-31"),
  );
  assert(candidate.document.events.every((event) => event.date < "2027-04-01"));
  assert.deepEqual(readBackup(JSON.parse(JSON.stringify(backup))), backup);
  assert.throws(() => parsePublic(JSON.stringify(backup)), /ιδιωτικό/);
  assert.throws(() => readBackup(candidate.document), /ιδιωτικό/);
  const row = { ...candidate.document.events[0], notes: "secret" };
  assert.throws(
    () => parsePublic(JSON.stringify({ ...candidate.document, events: [row] })),
    /πεδία/,
  );
  assert.throws(
    () =>
      parsePublic(
        JSON.stringify({ ...candidate.document, records: backup.records }),
      ),
    /ιδιωτικό/,
  );
  assert.throws(
    () => parsePublic('{"events":[{"notes":"hidden"}],' + serialized.slice(1)),
    /διπλά πεδία/,
  );
  const multi = build(records, null, "2028-12").document;
  assert.deepEqual(
    [...new Set(multi.events.map((e) => e.date.slice(0, 4)))],
    ["2026", "2027", "2028"],
  );
});
test("only actual Pages confirmation advances the baseline and the backup preserves it", () => {
  const state = blankState();
  const old = build([regular, { ...pending, pending: false }]);
  state.versions.push(old);
  assert.equal(confirmedVersion(state), null);
  state.confirmed = served(old.document);
  const moved = {
    ...pending,
    title: "Αδημοσίευτη αλλαγή",
    dates: ["2027-03-08"],
    replaces: [{ id: regular.id, date: "2027-03-08" }],
  };
  const imported = readBackup(JSON.parse(JSON.stringify(state)));
  const next = build(
    [{ ...regular, excluded: ["2027-03-08"] }, moved],
    confirmedVersion(imported),
    "2027-05",
    old.document.publicationId,
  );
  assert(
    next.document.events.some(
      (e) => e.title === pending.title && e.date === "2027-03-01",
    ),
  );
  assert(
    !next.document.events.some(
      (e) => e.title === regular.title && e.date === "2027-03-01",
    ),
  );
  assert(
    next.document.events.some(
      (e) => e.title === regular.title && e.date === "2027-03-08",
    ),
  );
  state.confirmed = served(next.document);
  assert.throws(() => confirmedVersion(state), /άλλη συσκευή/);
  const samePast = publication(
    { records: [regular, { ...pending, pending: false }], cutoff: "2027-03" },
    confirmedVersion(imported),
    "2027-04-01",
  );
  assert.equal(samePast.pastChanges, 0);
});
test("publisher rejects private JSON before any GitHub operation and catches stale writes", async () => {
  const candidate = build(records).document;
  const unrelated = build(records).document;
  let writes = 0;
  let reads = 0;
  const options = {
    read: async () => {
      reads++;
      return { sha: "base", document: unrelated };
    },
    write: async () => {
      writes++;
    },
    approve: () => true,
    pages: () => candidate,
    wait: () => {},
    attempts: 1,
  };
  await assert.rejects(
    publishCalendar(JSON.stringify(blankState()), options),
    /ιδιωτικό/,
  );
  assert.equal(reads, 0);
  await assert.rejects(
    publishCalendar(JSON.stringify(candidate), options),
    /νεότερη/,
  );
  assert.equal(writes, 0);
  reads = 0;
  await assert.rejects(
    publishCalendar(JSON.stringify(candidate), {
      ...options,
      read: async () => ({
        sha: ++reads === 1 ? "base" : "new",
        document: emptySnapshot,
      }),
    }),
    /άλλαξε/,
  );
  assert.equal(writes, 0);
});
test("publisher differentiates commit, delayed Pages and recovered lost response", async () => {
  const candidate = build(records).document;
  let remote = emptySnapshot;
  const adapters = {
    read: async () => ({ sha: "base", document: remote }),
    write: async (source, sha) => {
      assert.equal(sha, "base");
      remote = parsePublic(source);
      throw Error("response lost");
    },
    approve: () => true,
    pages: () => {
      throw Error("offline");
    },
    wait: () => {},
    attempts: 1,
  };
  assert.deepEqual(await publishCalendar(JSON.stringify(candidate), adapters), {
    status: "pending",
  });
  assert(sameSnapshot(remote, candidate));
  assert.deepEqual(
    await publishCalendar(JSON.stringify(candidate), {
      ...adapters,
      pages: () => served(candidate),
    }),
    { status: "published" },
  );
  const rollback = newSnapshot({
    basePublicationId: candidate.publicationId,
    restoredFrom: candidate.publicationId,
    cutoff: candidate.cutoff,
    events: candidate.events,
  });
  assert.deepEqual(
    await publishCalendar(JSON.stringify(rollback), {
      ...adapters,
      approve: () => false,
    }),
    { status: "cancelled" },
  );
});
