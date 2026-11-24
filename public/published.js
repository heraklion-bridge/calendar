import { pagesSnapshotUrl, parsePublic } from "../snapshot.js";

export async function loadPublished(root) {
  const response = await fetch(pagesSnapshotUrl(root), {
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw Error("Το GitHub Pages δεν απάντησε (" + response.status + ").");
  return parsePublic(await response.text(), { deployed: true });
}
