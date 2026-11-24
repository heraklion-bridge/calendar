import { test } from "node:test";
import assert from "node:assert/strict";
import { publication } from "../publication.js";
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
