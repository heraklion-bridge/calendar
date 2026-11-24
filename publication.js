import { createHash } from "node:crypto";
import {
  automaticHolidays,
  sessions,
  todayISO,
  validTime,
} from "./public/schedule.js";

export class InputError extends Error {}
const kinds = new Set([
  "regular",
  "special",
  "lesson",
  "external",
  "other",
  "holiday",
]);
const id = (value) =>
  typeof value === "string" && /^[\w.-]{1,128}$/.test(value);
const text = (value, limit) =>
  typeof value === "string" && value.length <= limit;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const list = (value, test, limit = 2000) =>
  Array.isArray(value) && value.length <= limit && value.every(test);
const optional = (value, test) => value === undefined || test(value);
const month = (value) =>
  typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
const date = (value) => {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(value);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
};
const boolean = (value) => typeof value === "boolean";
const time = (value) => typeof value === "string" && validTime(value);
const range = (r) => date(r.start) && date(r.end) && r.start <= r.end;
const overrides = (value) =>
  object(value) &&
  Object.entries(value).every(
    ([day, entry]) =>
      date(day) &&
      object(entry) &&
      optional(entry.date, date) &&
      optional(entry.time, time) &&
      optional(entry.simultaneous, boolean),
  );
const validLinks = (value) =>
  list(value, (z) => object(z) && id(z.id) && date(z.date));
const validRecord = (r) => {
  if (
    !object(r) ||
    !id(r.id) ||
    !kinds.has(r.kind) ||
    !text(r.title, 500) ||
    !r.title.trim() ||
    !optional(r.notes, (value) => text(value, 20_000)) ||
    !optional(r.pending, boolean) ||
    !optional(r.excluded, (value) => list(value, date)) ||
    !optional(r.overrides, overrides)
  )
    return false;
  switch (r.kind) {
    case "regular":
      return (
        range(r) &&
        time(r.time) &&
        optional(r.simultaneous, boolean) &&
        optional(r.independent, (value) => list(value, date))
      );
    case "special":
      return (
        list(r.dates, date, 150) &&
        r.dates.length > 0 &&
        list(r.times, time, 150) &&
        r.times.length === r.dates.length &&
        optional(r.grade, (value) =>
          ["", "1η", "2η", "3η", "4η", "Χωρίς βαθμίδα"].includes(value),
        ) &&
        optional(r.template, (value) => text(value, 500)) &&
        optional(r.replaces, validLinks) &&
        optional(r.keepsCancelled, validLinks)
      );
    case "lesson":
      return (
        date(r.start) &&
        time(r.time) &&
        integer(r.count, 1, 150) &&
        optional(r.startingNumber, (n) => integer(n, 1, 10_000)) &&
        optional(r.cycles, (n) => integer(n, 1, 30)) &&
        optional(r.perCycle, (n) => integer(n, 1, 150)) &&
        optional(
          r.cycleSizes,
          (v) => list(v, (n) => integer(n, 1, 150), 30) && v.length > 0,
        )
      );
    case "external":
      return date(r.start) && (r.end === undefined || range(r));
    case "other":
      return date(r.start) && time(r.time);
    case "holiday":
      return (
        date(r.start) &&
        optional(r.time, (v) => v === "" || time(v)) &&
        optional(r.blocks, (v) =>
          list(v, (k) => ["regular", "lesson"].includes(k), 2),
        )
      );
  }
};
export function validateRecords(records) {
  if (
    !list(records, validRecord) ||
    new Set(records.map((r) => r.id)).size !== records.length
  )
    throw new InputError("Μη έγκυρες καταχωρίσεις ή διπλά αναγνωριστικά.");
}
export function validateDraft(draft) {
  validateRecords(draft.records);
  if (draft.cutoff !== "" && !month(draft.cutoff))
    throw new InputError("Μη έγκυρος μήνας δημόσιας προβολής.");
}
function replacements(records) {
  const byId = new Map();
  for (const record of records) {
    if (record.kind !== "special") continue;
    for (const { id, date } of [
      ...(record.replaces || []),
      ...(record.keepsCancelled || []),
    ]) {
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id).add(date);
    }
  }
  return byId;
}
function approvedRecords(draft, previous, publishedEvents) {
  const previousById = new Map(previous.map((record) => [record.id, record]));
  const lastVisible = publishedEvents.at(-1)?.date || "";
  const visibleDays = new Map();
  for (const event of publishedEvents) {
    if (!visibleDays.has(event.id)) visibleDays.set(event.id, new Set());
    visibleDays.get(event.id).add(event.date);
  }
  const draftLinks = replacements(draft);
  const oldLinks = replacements(previous);
  const records = draft.flatMap((record) => {
    if (!record.pending) return [record];
    const old = previousById.get(record.id);
    if (!old || !visibleDays.has(record.id)) return [];
    if (old.kind !== "special") return [old];
    return [
      {
        ...old,
        replaces: (old.replaces || []).filter((link) =>
          visibleDays.get(record.id).has(link.date),
        ),
        keepsCancelled: (old.keepsCancelled || []).filter(
          (link) => link.date <= lastVisible,
        ),
      },
    ];
  });
  const approvedLinks = replacements(records);
  return records.map((record) => {
    if (record.kind !== "regular") return record;
    const links = (
      record === previousById.get(record.id) ? oldLinks : draftLinks
    ).get(record.id);
    const slot = (day) =>
      Object.keys(record.overrides || {}).find(
        (d) => record.overrides[d]?.date === day,
      ) || day;
    const linkedSlots = new Set([...(links || [])].map(slot));
    const manual = (record.excluded || []).filter(
      (day) => !linkedSlots.has(day),
    );
    return {
      ...record,
      excluded: [
        ...new Set([
          ...manual,
          ...[...(approvedLinks.get(record.id) || [])].map(slot),
        ]),
      ],
    };
  });
}
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compare = (a, b) =>
  a.date.localeCompare(b.date) ||
  (a.time || "99").localeCompare(b.time || "99") ||
  a.title.localeCompare(b.title, "el");
export function publication(draft, previous, today = todayISO()) {
  if (!month(draft.cutoff))
    throw new InputError("Επιλέξτε μήνα και έτος δημόσιας προβολής.");
  const oldEvents = previous?.events || [];
  const pending = new Set(
    draft.records.filter((record) => record.pending).map((record) => record.id),
  );
  const records = approvedRecords(
    draft.records,
    previous?.records || [],
    oldEvents,
  );
  const year = Number(draft.cutoff.slice(0, 4));
  const earliest = Math.min(
    year,
    Number(today.slice(0, 4)),
    ...records.map((r) =>
      Number(
        (r.start || r.dates.reduce((a, b) => (a < b ? a : b))).slice(0, 4),
      ),
    ),
  );
  const holidays = [];
  for (let y = earliest; y <= year; y++)
    holidays.push(...automaticHolidays(y, records));
  const events = oldEvents.filter(
    (event) => pending.has(event.id) && event.date.slice(0, 7) <= draft.cutoff,
  );
  for (const record of [...records, ...holidays]) {
    if (pending.has(record.id)) continue;
    for (const event of sessions(record, records)) {
      if (event.date.slice(0, 7) > draft.cutoff) continue;
      const {
        date,
        time,
        title,
        category,
        id,
        number,
        group,
        groupTotal,
        independent,
        simultaneous,
        total,
        grade,
        cycle,
        cycleNumber,
        note,
      } = event;
      events.push({
        date,
        time,
        title,
        category,
        id,
        number,
        group,
        groupTotal,
        independent,
        simultaneous,
        total,
        grade,
        cycle,
        cycleNumber,
        note,
      });
    }
  }
  events.sort(compare);
  const past = events.filter((e) => e.date < today);
  const oldPast = (previous?.events || []).filter(
    (e) => e.date < today && e.date.slice(0, 7) <= draft.cutoff,
  );
  const key = (e) =>
    JSON.stringify([e.id, e.date, e.category === "special" ? e.number : null]);
  const nextByKey = new Map(past.map((e) => [key(e), digest(e)]));
  const oldByKey = new Map(oldPast.map((e) => [key(e), digest(e)]));
  const pastChanges = previous
    ? [...new Set([...nextByKey.keys(), ...oldByKey.keys()])].filter(
        (k) => nextByKey.get(k) !== oldByKey.get(k),
      ).length
    : 0;
  // Keep historical rows already covered by the previous publication. An extension
  // of its date range can still publish historical dates for the first time.
  const visible =
    previous && !draft.retroactive
      ? [
          ...oldPast,
          ...events.filter(
            (e) => e.date >= today || e.date.slice(0, 7) > previous.cutoff,
          ),
        ].sort(compare)
      : events;
  const token = digest({
    records,
    visible,
    cutoff: draft.cutoff,
    retroactive: draft.retroactive === true,
    revision: draft.revision,
  });
  return { records, events: visible, token, pastChanges, cutoff: draft.cutoff };
}
