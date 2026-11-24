export const PUBLIC_FORMAT = "omh-calendar-public";
export const MAX_PUBLIC_BYTES = 900_000;
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
export const isMonth = (value) =>
  typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
export const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const exactKeys = (value, keys) =>
  isObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const instant = (value) =>
  typeof value === "string" &&
  /^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const date = (value) =>
  typeof value === "string" && instant(value + "T00:00:00.000Z");
const required = ["id", "date", "time", "title", "category"];
const extras = {
  reg: ["number", "group", "groupTotal", "independent", "simultaneous"],
  special: ["number", "total", "grade"],
  lesson: ["number", "cycle", "cycleNumber"],
  external: [],
  other: [],
  holiday: [],
};
const positive = (n, max = 10_200) => Number.isInteger(n) && n > 0 && n <= max;
const allowedGrade = new Set(["", "1η", "2η", "3η", "4η", "Χωρίς βαθμίδα"]);
const bool = (value) => typeof value === "boolean";
function validEvent(event, cutoff) {
  if (!isObject(event) || !Object.hasOwn(extras, event.category)) return false;
  if (
    !exactKeys(event, [...required, ...extras[event.category]]) ||
    !/^e[1-9]\d{0,5}$/.test(event.id) ||
    typeof event.id !== "string" ||
    !date(event.date) ||
    event.date.slice(0, 7) > cutoff ||
    typeof event.time !== "string" ||
    !/^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(event.time) ||
    typeof event.title !== "string" ||
    !event.title.trim() ||
    event.title.length > 500
  )
    return false;
  switch (event.category) {
    case "reg":
      return (
        bool(event.independent) &&
        bool(event.simultaneous) &&
        (event.independent
          ? [event.number, event.group, event.groupTotal].every(
              (n) => n === null,
            )
          : positive(event.group, 100) &&
            positive(event.groupTotal, 6) &&
            positive(event.number, event.groupTotal))
      );
    case "special":
      return (
        positive(event.total, 150) &&
        positive(event.number, event.total) &&
        allowedGrade.has(event.grade)
      );
    case "lesson":
      return (
        positive(event.number) &&
        positive(event.cycle) &&
        positive(event.cycleNumber, 150)
      );
    default:
      return true;
  }
}
export const emptySnapshot = Object.freeze({
  format: PUBLIC_FORMAT,
  version: 1,
  publicationId: null,
  basePublicationId: null,
  restoredFrom: null,
  preparedAt: null,
  cutoff: null,
  events: Object.freeze([]),
});
const fields = Object.keys(emptySnapshot);
export function validatePublic(document, { deployed = false } = {}) {
  const validKeys = exactKeys(
    document,
    deployed ? [...fields, "publishedAt"] : fields,
  );
  if (!validKeys || document.format !== PUBLIC_FORMAT || document.version !== 1)
    throw Error(
      "Το αρχείο δεν είναι έγκυρο δημόσιο calendar.json. Το ιδιωτικό αντίγραφο δεν επιτρέπεται.",
    );
  if (document.publicationId === null) {
    if (
      !Array.isArray(document.events) ||
      document.events.length ||
      [
        "basePublicationId",
        "restoredFrom",
        "preparedAt",
        "cutoff",
        ...(deployed ? ["publishedAt"] : []),
      ].some((key) => document[key] !== null)
    )
      throw Error("Μη έγκυρη αρχική έκδοση ημερολογίου.");
    return document;
  }
  const keys = new Set();
  if (
    !uuid(document.publicationId) ||
    ![document.basePublicationId, document.restoredFrom].every(
      (value) =>
        value === null || (uuid(value) && value !== document.publicationId),
    ) ||
    !instant(document.preparedAt) ||
    (deployed && !instant(document.publishedAt)) ||
    !isMonth(document.cutoff) ||
    !Array.isArray(document.events) ||
    document.events.length > 20_000 ||
    !document.events.every((event) => {
      if (!validEvent(event, document.cutoff)) return false;
      const key = JSON.stringify([event.id, event.date, event.number ?? null]);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
  )
    throw Error(
      "Μη έγκυρες ημερίδες, μεταδεδομένα ή πεδία στο δημόσιο αρχείο.",
    );
  return document;
}
export function parsePublic(source, options) {
  if (new TextEncoder().encode(source).length > MAX_PUBLIC_BYTES)
    throw Error("Το δημόσιο αρχείο υπερβαίνει τα 900 KB.");
  const document = JSON.parse(source);
  // Compare the token stream with the parsed document to reject duplicate keys
  // that JSON.parse alone would discard. Whitespace and string escapes are equivalent.
  const compact = source.replace(/"(?:\\.|[^"\\])*"|\s+/gs, (token) =>
    token.startsWith('"') ? JSON.stringify(JSON.parse(token)) : "",
  );
  if (compact !== JSON.stringify(document))
    throw Error(
      "Το δημόσιο JSON περιέχει διπλά πεδία ή μη αναμενόμενη κωδικοποίηση.",
    );
  return validatePublic(document, options);
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isObject(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function sameSnapshot(a, b) {
  return fields.every((key) => canonical(a[key]) === canonical(b[key]));
}
export function newSnapshot({
  basePublicationId,
  cutoff,
  events,
  restoredFrom = null,
}) {
  const document = {
    format: PUBLIC_FORMAT,
    version: 1,
    publicationId: crypto.randomUUID(),
    basePublicationId,
    restoredFrom,
    preparedAt: new Date().toISOString(),
    cutoff,
    events,
  };
  return parsePublic(JSON.stringify(document));
}
export function projectPublic(events) {
  const seriesIds = [];
  const lookup = new Map();
  const rows = events.map((event) => {
    if (!lookup.has(event.id)) {
      seriesIds.push(event.id);
      lookup.set(event.id, "e" + seriesIds.length);
    }
    const row = {
      id: lookup.get(event.id),
      date: event.date,
      time: event.time || "",
      title: event.title,
      category: event.category,
    };
    for (const key of extras[event.category])
      row[key] =
        event[key] ??
        (key === "grade" ? "" : key === "simultaneous" ? false : null);
    return row;
  });
  return { rows, seriesIds };
}
export const PAGES_ROOT = "https://heraklion-bridge.github.io/calendar/";
export function pagesSnapshotUrl(root = PAGES_ROOT) {
  const url = new URL("calendar.json", root);
  url.searchParams.set("v", crypto.randomUUID());
  return url;
}
export function publicationLabel(document) {
  if (document.publicationId === null) return "Δεν έχει δημοσιευθεί πρόγραμμα.";
  const stamp = new Intl.DateTimeFormat("el-GR", {
    timeZone: "Europe/Athens",
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(document.publishedAt));
  return "Τελευταία δημοσίευση · " + stamp + " (ώρα Ελλάδας)";
}
