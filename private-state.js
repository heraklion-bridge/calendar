import { validateRecords, migrateRecords } from "./publication.js";
import {
  emptySnapshot,
  exactKeys,
  isMonth,
  validatePublic,
  sameSnapshot,
} from "./snapshot.js";

const format = "omh-calendar-private";
export const MAX_PRIVATE_BYTES = 30_000_000;
export const blankState = () => ({
  format,
  version: 1,
  records: [],
  cutoff: "",
  confirmed: { ...emptySnapshot, publishedAt: null },
  versions: [],
});

export function readBackup(value, { legacy = true } = {}) {
  if (legacy && value?.format === "omh-calendar-demo" && value.version === 1) {
    if (!exactKeys(value, ["format", "version", "records"]))
      throw Error("Μη έγκυρη μορφή αντιγράφου v10.7.");
    const records = migrateRecords(value.records);
    validateRecords(records, true);
    return { ...blankState(), records };
  }
  if (
    !exactKeys(value, [
      "format",
      "version",
      "records",
      "cutoff",
      "confirmed",
      "versions",
    ]) ||
    value.format !== format ||
    value.version !== 1 ||
    (value.cutoff !== "" && !isMonth(value.cutoff)) ||
    !Array.isArray(value.versions)
  )
    throw Error("Επιλέξτε έγκυρο ιδιωτικό αντίγραφο ΟΜΗ.");
  validateRecords(value.records, true);
  validatePublic(value.confirmed, { deployed: true });
  const ids = new Set();
  for (const entry of value.versions) {
    if (!exactKeys(entry, ["document", "records", "seriesIds"]))
      throw Error("Μη έγκυρο ιδιωτικό ιστορικό.");
    validatePublic(entry.document);
    const { publicationId, events } = entry.document;
    if (publicationId === null || ids.has(publicationId))
      throw Error("Μη έγκυρο ιδιωτικό ιστορικό.");
    ids.add(publicationId);
    if (
      entry.records === null &&
      entry.seriesIds === null &&
      entry.document.restoredFrom
    )
      continue;
    if (
      !Array.isArray(entry.seriesIds) ||
      new Set(entry.seriesIds).size !== entry.seriesIds.length ||
      entry.seriesIds.some(
        (id) => typeof id !== "string" || id.length > 200 || !id.length,
      ) ||
      events.some((event) => !entry.seriesIds[Number(event.id.slice(1)) - 1])
    )
      throw Error("Μη έγκυρη συσχέτιση ημερίδων.");
    validateRecords(entry.records, true);
  }
  return value;
}
export function confirmedVersion(state) {
  if (!state.confirmed.publicationId) return null;
  let version = state.versions.find((entry) =>
    sameSnapshot(entry.document, state.confirmed),
  );
  if (version?.records === null) {
    const archive = state.versions.find(
      (entry) =>
        entry.records &&
        entry.document.publicationId === version.document.restoredFrom,
    );
    if (
      archive &&
      sameSnapshot(
        {
          ...archive.document,
          publicationId: version.document.publicationId,
          basePublicationId: version.document.basePublicationId,
          restoredFrom: version.document.restoredFrom,
          preparedAt: version.document.preparedAt,
        },
        version.document,
      )
    )
      version = { ...archive, document: version.document };
  }
  if (!version?.records)
    throw Error(
      "Η δημόσια έκδοση είναι νεότερη ή προέρχεται από άλλη συσκευή. Εισαγάγετε το ιδιωτικό αντίγραφο της αντίστοιχης έκδοσης.",
    );
  return {
    records: version.records,
    cutoff: version.document.cutoff,
    events: version.document.events.map((event) => ({
      ...event,
      id: version.seriesIds[Number(event.id.slice(1)) - 1],
    })),
  };
}
export function openStorage(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open("omh-calendar-private-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("calendar");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export function storedState(db) {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("calendar")
      .objectStore("calendar")
      .get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function storeState(db, value, revision) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("calendar", "readwrite");
    const store = transaction.objectStore("calendar");
    let conflict = false;
    const request = store.get("state");
    request.onsuccess = () => {
      if ((request.result?.revision || 0) !== revision) {
        conflict = true;
        transaction.abort();
        return;
      }
      store.put({ revision: revision + 1, value }, "state");
    };
    transaction.oncomplete = () => resolve(revision + 1);
    transaction.onabort = () =>
      reject(
        conflict
          ? Error(
              "Το πρόχειρο άλλαξε σε άλλη καρτέλα. Εξαγάγετε ιδιωτικό αντίγραφο πριν από την ανανέωση.",
            )
          : transaction.error,
      );
  });
}
