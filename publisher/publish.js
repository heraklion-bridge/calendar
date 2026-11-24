import { parsePublic, sameSnapshot } from "../snapshot.js";

export const REPOSITORY = "heraklion-bridge/calendar";
export const BRANCH = "main";
export const PATH = "calendar.json";
export const CONTENTS_API = "repos/" + REPOSITORY + "/contents/" + PATH;

export async function publishCalendar(
  source,
  { read, write, pages, approve, wait, attempts = 24 },
) {
  const candidate = parsePublic(source);
  if (!candidate.publicationId)
    throw Error("Επιλέξτε αρχείο από «Εξαγωγή για δημοσίευση».");
  const original = await read();
  let alreadyStored = sameSnapshot(candidate, original.document);
  if (
    !alreadyStored &&
    candidate.basePublicationId !== original.document.publicationId
  )
    throw Error(
      "Υπάρχει διαφορετική ή νεότερη έκδοση στο GitHub. Ελέγξτε το GitHub Pages και εξαγάγετε ξανά.",
    );
  if (!(await approve(candidate, alreadyStored)))
    return { status: "cancelled" };
  if (!alreadyStored) {
    // Check again after the user confirms. GitHub's Contents API checks the
    // exact blob SHA supplied with the update if a write races this read.
    const latest = await read();
    if (
      latest.sha !== original.sha ||
      !sameSnapshot(latest.document, original.document)
    )
      throw Error(
        "Το calendar.json άλλαξε κατά την επιβεβαίωση. Ελέγξτε την τελευταία έκδοση.",
      );
    try {
      await write(source, latest.sha, candidate);
    } catch {
      // A dropped connection may hide an already accepted commit.
      try {
        alreadyStored = sameSnapshot(candidate, (await read()).document);
      } catch {
        throw Error(
          "Η ενημέρωση δεν επιβεβαιώθηκε. Ελέγξτε το calendar.json στο GitHub πριν επαναλάβετε.",
        );
      }
      if (!alreadyStored)
        throw Error(
          "Το GitHub δεν επιβεβαίωσε την ενημέρωση. Ελέγξτε τη σύνδεση, τα δικαιώματα και τη νεότερη έκδοση.",
        );
    }
  }
  const stored = await read().catch(() => null);
  if (stored && !sameSnapshot(candidate, stored.document))
    throw Error(
      "Το GitHub περιέχει πλέον άλλη έκδοση. Ελέγξτε το ιστορικό του calendar.json.",
    );
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (sameSnapshot(candidate, await pages()))
        return { status: "published" };
    } catch {}
    if (attempt + 1 < attempts) await wait();
  }
  return { status: stored ? "pending" : "unverified" };
}
