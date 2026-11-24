import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import {
  parsePublic,
  validatePublic,
  sameSnapshot,
  pagesSnapshotUrl,
  emptySnapshot,
} from "../snapshot.js";

const snapshot = process.argv.includes("--empty")
  ? emptySnapshot
  : parsePublic(await readFile("calendar.json", "utf8"));
const staging = process.argv.includes("--deploy");
let publishedAt = snapshot.preparedAt;
if (staging && snapshot.publicationId !== null) {
  publishedAt = new Date().toISOString();
  try {
    const response = await fetch(pagesSnapshotUrl(), {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (response.ok) {
      const prior = parsePublic(await response.text(), { deployed: true });
      if (sameSnapshot(prior, snapshot)) publishedAt = prior.publishedAt;
    }
  } catch {
    // The first deployment and recoveries can proceed without a reachable Pages site.
  }
}
const deployed = validatePublic(
  { ...snapshot, publishedAt },
  { deployed: true },
);
const template = await readFile("public/layout.html", "utf8");
const css = await readFile("public/calendar.css", "utf8");
const logo = (await readFile("public/logo.png")).toString("base64");
const themeHeader =
  template.slice(
    0,
    template.indexOf('          ><button class="tab active" id="tabPublic"'),
  ) + ">";
const renderSection = template.slice(
  template.indexOf('      <section id="public">'),
  template.indexOf('      <section id="admin"'),
);
const publicContent = renderSection.replace(
  /          <div id="restoreLookup"[\s\S]*?          <div class="counter"/,
  '          <div class="counter"',
);
const adminContent = template
  .slice(
    template.indexOf('      <section id="admin"'),
    template.indexOf('      <div class="footer"'),
  )
  .replace('id="admin" class="hidden"', 'id="admin" inert');
const end = template.slice(
  template.indexOf('      <div class="footer"'),
  template.indexOf('    <script type="module"'),
);
const status = `<div class="panel row status-row production-toolbar">
  <div id="publicationStatus" role="status">Έλεγχος δημοσίευσης…</div>
  <button class="btn small" id="checkPublication">Έλεγχος GitHub Pages</button>
</div>`;
const tools = `<section id="tools" class="panel production-toolbar" inert>
  <div class="row">
    <button class="btn" id="draftView">Προβολή πρόχειρου</button>
    <label>Δημόσια προβολή έως και <input class="field" type="month" id="cutoff"></label>
    <button class="btn" id="preview">Προεπισκόπηση δημοσίευσης</button>
    <button class="btn primary" id="publish" disabled>Εξαγωγή για δημοσίευση</button>
    <a class="btn" href="https://github.com/heraklion-bridge/calendar/commits/main/calendar.json">Ιστορικό δημοσιεύσεων</a>
    <button class="btn" id="restoreArchive">Παλαιότερο δημόσιο αρχείο</button>
    <input type="file" id="restoreFile" accept=".json,application/json" hidden>
  </div>
  <div class="row toolbar-notice">
    <button class="btn" id="export">Εξαγωγή ιδιωτικού αντιγράφου ασφαλείας</button>
    <button class="btn" id="importBtn">Εισαγωγή ιδιωτικού αντιγράφου ασφαλείας</button>
    <input type="file" id="importFile" accept=".json,application/json" hidden>
  </div>
  <label class="check"><input type="checkbox" id="retroactive"> Να εφαρμοστούν αναδρομικές διορθώσεις</label>
  <div id="productionStatus" class="production-status" role="status"></div>
  <div id="storageStatus" class="toolbar-notice" role="status">Άνοιγμα τοπικής αποθήκευσης…</div>
  <p class="tiny">Το πρόγραμμα φυλάσσεται σε αυτόν τον browser. Κρατήστε ιδιωτικό αντίγραφο για περίπτωση απώλειας συσκευής ή εκκαθάρισης δεδομένων. Το ιδιωτικό αρχείο περιέχει ολόκληρο το πρόγραμμα. Για GitHub χρησιμοποιήστε μόνο το calendar.json από την εξαγωγή δημοσίευσης.</p>
</section>`;

await mkdir("site", { recursive: true });
for (const admin of [false, true]) {
  let script = (
    await build({
      entryPoints: [admin ? "public/calendar.js" : "public/athletes.js"],
      bundle: true,
      write: false,
      format: "iife",
      minifySyntax: true,
      target: "es2022",
    })
  ).outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const hash = createHash("sha256").update(script).digest("base64");
  const scriptPolicy = admin ? "'sha256-" + hash + "'" : "'self'";
  const csp = `default-src 'none'; script-src ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://heraklion-bridge.github.io; base-uri 'none'; form-action 'none'; object-src 'none'`;
  const html =
    themeHeader
      .replace(
        '<link rel="stylesheet" href="calendar.css" />',
        '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' +
          csp +
          '">' +
          (admin
            ? "<style>" + css + "</style>"
            : '<link rel="stylesheet" href="calendar.css">'),
      )
      .replace(
        "ΟΜΗ | Ημερολόγιο & Διαχείριση",
        admin ? "ΟΜΗ | Τοπική διαχείριση" : "ΟΜΗ | Ημερολόγιο αθλητών",
      )
      .replace(
        'src="logo.png"',
        admin ? 'src="data:image/png;base64,' + logo + '"' : 'src="logo.png"',
      ) +
    (admin
      ? '<button class="tab active" id="tabAdmin">Διαχείριση</button><a class="tab" href="https://heraklion-bridge.github.io/calendar/">Ημερολόγιο αθλητών</a>'
      : '<a class="tab" href="admin.html">Διαχείριση</a>') +
    '</div></div></header><main class="shell page">' +
    status +
    (admin
      ? tools +
        renderSection.replace('id="public"', 'id="public" class="hidden"') +
        adminContent
      : publicContent) +
    end +
    (admin
      ? "<script>" + script + "</script>"
      : '<script src="athlete.js"></script>') +
    "</body></html>\n";
  if (!admin) await writeFile("site/athlete.js", script);
  await writeFile(admin ? "site/admin.html" : "site/index.html", html);
}
await writeFile("site/calendar.json", JSON.stringify(deployed, null, 2) + "\n");
await copyFile("public/calendar.css", "site/calendar.css");
await copyFile("public/logo.png", "site/logo.png");
await writeFile("site/.nojekyll", "");
