import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import {
  parsePublic,
  pagesSnapshotUrl,
  MAX_PUBLIC_BYTES,
} from "../snapshot.js";
import {
  BRANCH,
  CONTENTS_API,
  PATH,
  REPOSITORY,
  publishCalendar,
} from "./publish.js";
import { command, desktop } from "./desktop.js";

const gh = (args, options) => command("gh", args, options);
async function read() {
  const result = JSON.parse(
    await gh([
      "api",
      "--hostname",
      "github.com",
      CONTENTS_API + "?ref=" + BRANCH,
    ]),
  );
  if (
    result.path !== PATH ||
    result.encoding !== "base64" ||
    !/^[0-9a-f]{40}$/.test(result.sha) ||
    result.size > MAX_PUBLIC_BYTES
  )
    throw Error(
      "Δεν ήταν δυνατό να διαβαστεί το calendar.json από τον αναμενόμενο κλάδο του GitHub.",
    );
  return {
    sha: result.sha,
    document: parsePublic(
      Buffer.from(result.content, "base64").toString("utf8"),
    ),
  };
}
async function write(source, sha, candidate) {
  const message =
    "ΟΜΗ | " +
    (candidate.restoredFrom ? "Επαναφορά" : "Δημοσίευση") +
    " προγράμματος έως " +
    candidate.cutoff +
    " (" +
    candidate.events.length +
    " ημερίδες)";
  await gh(
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "PUT",
      CONTENTS_API,
      "--input",
      "-",
    ],
    {
      input: JSON.stringify({
        message,
        content: Buffer.from(source).toString("base64"),
        sha,
        branch: BRANCH,
      }),
    },
  );
}
async function pages() {
  const response = await fetch(pagesSnapshotUrl(), {
    cache: "no-store",
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw Error("Το GitHub Pages δεν είναι διαθέσιμο.");
  return parsePublic(await response.text(), { deployed: true });
}
const results = {
  published:
    "Η νέα έκδοση επιβεβαιώθηκε στο GitHub Pages. Στη διαχείριση πατήστε «Έλεγχος GitHub Pages».",
  pending:
    "Το calendar.json ενημερώθηκε στο GitHub. Η νέα έκδοση δεν εμφανίστηκε ακόμη στο GitHub Pages. Ελέγξτε ξανά από τη διαχείριση.",
  unverified:
    "Υποβλήθηκε ενημέρωση, αλλά η νέα έκδοση δεν επιβεβαιώθηκε. Ελέγξτε το ιστορικό GitHub και τη σελίδα πριν επαναλάβετε.",
};
try {
  const path = await desktop.choose();
  if (path) {
    const source = await readFile(path, "utf8");
    const candidate = parsePublic(source);
    if (!candidate.publicationId)
      throw Error("Επιλέξτε το αρχείο που εξήχθη για δημοσίευση.");
    try {
      await gh(["auth", "status", "--hostname", "github.com"]);
    } catch {
      throw Error(
        "Χρειάζεται σύνδεση στο github.com με το GitHub CLI και δικαίωμα εγγραφής στο αποθετήριο του ΟΜΗ.",
      );
    }
    const outcome = await publishCalendar(source, {
      read,
      write,
      pages,
      wait: () => setTimeout(5000),
      approve: (document, stored) =>
        desktop.approve(
          (document.restoredFrom
            ? "Επαναφορά δημόσιου προγράμματος"
            : "Δημόσιο πρόγραμμα") +
            "\nΈως " +
            document.cutoff +
            " · " +
            document.events.length +
            " ημερίδες" +
            "\n" +
            REPOSITORY +
            " / " +
            BRANCH +
            " / " +
            PATH +
            (stored
              ? "\nΗ ίδια έκδοση είναι ήδη στο GitHub. Έλεγχος GitHub Pages;"
              : "\nΝα ενημερωθεί το δημόσιο αρχείο; Η έκδοση μπορεί να παραμείνει στο ιστορικό GitHub."),
        ),
    });
    if (results[outcome.status]) await desktop.message(results[outcome.status]);
  }
} catch (error) {
  const message =
    error?.message?.startsWith("Αποτυχία εργαλείου:") ||
    error?.code === "ENOENT"
      ? "Αδυναμία εκκίνησης βοηθητικού εργαλείου. Ελέγξτε Node.js, GitHub CLI και το εργαλείο παραθύρων του συστήματος."
      : "Η διαδικασία σταμάτησε. " +
        (error instanceof SyntaxError
          ? "Το αρχείο δεν είναι αναγνώσιμο JSON."
          : error.message);
  try {
    await desktop.message(message);
  } catch {
    console.error(message);
  }
  process.exitCode = 1;
}
