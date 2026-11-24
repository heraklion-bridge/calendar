const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { once } = require("node:events");

(async () => {
  const { records } = await import("../fixtures/synthetic.js");
  const { emptySnapshot, sameSnapshot } = await import("../snapshot.js");
  let snapshot = { ...emptySnapshot, publishedAt: null };
  let offline = false;
  const serials = [];
  const assets = new Map([
    ["", "text/html"],
    ["admin.html", "text/html"],
    ["athlete.js", "text/javascript"],
    ["calendar.css", "text/css"],
    ["logo.png", "image/png"],
  ]);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const name = url.pathname.replace(/^\/calendar\//, "");
    if (name === "calendar.json") {
      serials.push(url.searchParams.get("v"));
      response.writeHead(offline ? 503 : 200, {
        "Content-Type": "application/json",
      });
      return response.end(JSON.stringify(snapshot));
    }
    if (!assets.has(name)) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { "Content-Type": assets.get(name) });
    response.end(await readFile(join("site", name || "index.html")));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = "http://127.0.0.1:" + server.address().port + "/calendar/";
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const errors = [];
    const unexpectedDialogs = [];
    const admin = await browser.newPage({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    });
    const athlete = await browser.newPage({
      viewport: { width: 844, height: 390 },
    });
    const other = await browser.newPage({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    });
    for (const page of [admin, athlete, other]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", (dialog) => {
        if (dialog.type() === "alert") unexpectedDialogs.push(dialog.message());
        dialog.accept();
      });
      page.on("console", (line) => {
        if (line.type() === "error" && line.text().includes("Content Security"))
          errors.push(line.text());
      });
    }
    await athlete.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw Error("Public page accessed private storage");
        },
      });
    });
    const upload = (page, selector, document) =>
      page.locator(selector).setInputFiles({
        name: "synthetic.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(document)),
      });
    async function download(page, selector) {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(selector).click(),
      ]);
      return {
        name: file.suggestedFilename(),
        document: JSON.parse(await readFile(await file.path(), "utf8")),
      };
    }
    const setMonth = async (page, month) => {
      await page.locator("#jumpMonth").fill(month);
      await page.locator("#jumpMonth").dispatchEvent("change");
    };
    const waitSaved = (page) =>
      page
        .getByText("Το πρόχειρο αποθηκεύτηκε στη συσκευή.", { exact: true })
        .waitFor();
    const confirmPublished = (page) =>
      page.getByText(/Τελευταία δημοσίευση/).waitFor();
    const runPreview = async (page, month) => {
      await page.locator("#preview").click();
      await page.locator("#publish").waitFor();
      await setMonth(page, month);
    };
    await admin.goto(root + "admin.html");
    await admin
      .getByText("Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.", {
        exact: true,
      })
      .waitFor();
    await athlete.goto(root);
    await athlete
      .getByText("Δεν έχει δημοσιευθεί πρόγραμμα.", { exact: true })
      .waitFor();
    assert.equal(await athlete.locator("#admin").count(), 0);
    await upload(admin, "#importFile", {
      format: "omh-calendar-demo",
      version: 1,
      records,
    });
    await waitSaved(admin);
    assert.equal(
      (await download(admin, "#export")).document.records.length,
      61,
    );
    await admin.locator("#cutoff").fill("2027-03");
    await waitSaved(admin);
    await admin.reload();
    await admin
      .getByText("Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await admin.locator("#cutoff").inputValue(), "2027-03");
    for (const section of [
      "exceptions",
      "holidays",
      "rollover",
      "clearYear",
      "rules",
      "manage",
    ]) {
      await admin.locator('[data-section="' + section + '"]').click();
      await admin.locator("#adminContent h2").waitFor();
    }
    await runPreview(admin, "2027-03");
    await admin.getByText("Διπλή ημερίδα", { exact: true }).first().waitFor();
    assert.equal(await admin.locator("#calendarBody img").count(), 0);
    await admin
      .getByText("<img src=x onerror=alert(1)>", { exact: true })
      .first()
      .waitFor();
    const previewTitles = await admin
      .locator("#calendarBody .title")
      .allTextContents();
    const first = (await download(admin, "#publish")).document;
    assert.equal(first.basePublicationId, null);
    assert.equal(
      await athlete.getByText("Διπλή ημερίδα", { exact: true }).count(),
      0,
    );
    assert(
      !(await admin.locator("#publicationStatus").textContent()).includes(
        "Τελευταία δημοσίευση",
      ),
    );
    const backup = (await download(admin, "#export")).document;
    assert(backup.records[0].notes.includes("ΙΔΙΩΤΙΚΟ"));
    assert(!JSON.stringify(first).includes("ΙΔΙΩΤΙΚΟ"));
    snapshot = { ...first, publishedAt: new Date().toISOString() };
    await athlete.locator("#checkPublication").click();
    await confirmPublished(athlete);
    await setMonth(athlete, "2027-03");
    assert.deepEqual(
      await athlete.locator("#calendarBody .title").allTextContents(),
      previewTitles,
    );
    assert.equal(await athlete.locator("#calendarBody img").count(), 0);
    for (const page of [admin, athlete]) {
      await page
        .locator(".event")
        .filter({ hasText: "Διπλή ημερίδα" })
        .last()
        .click();
      await page
        .locator("#modalHost")
        .getByText("19:30", { exact: true })
        .waitFor();
      await page.locator("#closeDetail").click();
      for (const mode of ["agenda", "week", "month", "year"]) {
        await page.locator('[data-view="' + mode + '"]').click();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          mode + " overflows",
        );
      }
      await page.locator("#search").fill("Διπλή");
      await page.locator("#search").fill("");
    }
    await admin.locator("#checkPublication").click();
    await confirmPublished(admin);
    await admin.locator("#draftView").click();
    await admin.locator('[data-view="agenda"]').click();
    await setMonth(admin, "2027-03");
    async function moveSpecial(from, to) {
      await admin
        .locator(
          '.event[data-show="synthetic-special"][data-date="' +
            from +
            '"][data-number="2"]',
        )
        .click();
      await admin.locator("#quickMoveOne").click();
      await admin.locator("#occurrenceDate").click();
      await admin.locator('.datepick [data-date="' + to + '"]').click();
      await admin.locator("#moveOccurrence").click();
      await admin.locator("#decisionOK").waitFor();
    }
    await moveSpecial("2027-03-03", "2027-03-08");
    const conflict = admin
      .locator("#modalHost .inlinehelp")
      .filter({ hasText: "Συνθετικά ζεύγη" });
    await conflict.locator("select").selectOption("1");
    await admin.locator("#decisionOK").click();
    await waitSaved(admin);
    let modified = (await download(admin, "#export")).document.records;
    assert(modified[0].excluded.includes("2027-03-08"));
    assert(
      modified
        .find((r) => r.id === "synthetic-special")
        .replaces.some(
          (link) => link.id === records[0].id && link.date === "2027-03-08",
        ),
    );
    await moveSpecial("2027-03-08", "2027-03-03");
    await admin.locator("#decisionOK").click();
    await waitSaved(admin);
    modified = (await download(admin, "#export")).document.records;
    assert(!modified[0].excluded.includes("2027-03-08"));
    await admin.locator("#tabAdmin").click();
    await admin.locator('[data-section="rollover"]').click();
    await admin.locator("#sourceYear").fill("2028");
    await admin.locator("#copySpecial").check();
    await admin.locator("#roll").click();
    await admin.locator("#rollSave").click();
    await waitSaved(admin);
    modified = (await download(admin, "#export")).document.records;
    assert(
      modified.some((record) => record.copyYear === 2029 && record.copiedFrom),
    );
    await admin.reload();
    await admin
      .getByText("Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(
      (await download(admin, "#export")).document.records,
      modified,
    );
    await admin.locator('[data-section="clearYear"]').click();
    await admin.locator("#clearYearValue").fill("2027");
    await admin.locator("#clearPreviewBtn").click();
    await admin
      .locator("#clearPreview")
      .getByText(/καταχωρίσεις που εκτείνονται σε άλλα έτη/)
      .waitFor();
    await admin.locator("#clearAgree").check();
    await admin.locator("#clearExecute").click();
    await waitSaved(admin);
    const remaining = (await download(admin, "#export")).document.records;
    assert(remaining.some((record) => record.id === records[0].id));
    assert(!remaining.some((record) => record.id === "synthetic-other"));
    assert(serials.every(Boolean) && new Set(serials).size === serials.length);
    await other.goto(root + "admin.html");
    await confirmPublished(other);
    await other.getByText(/Η ιδιωτική βάση αυτής της έκδοσης λείπει/).waitFor();
    await upload(other, "#importFile", backup);
    await waitSaved(other);
    assert.deepEqual(
      (await download(other, "#export")).document.records,
      records,
    );
    await other.locator("#cutoff").fill("2028-12");
    await waitSaved(other);
    await runPreview(other, "2028-03");
    const next = (await download(other, "#publish")).document;
    assert.equal(next.basePublicationId, first.publicationId);
    offline = true;
    await other.locator("#checkPublication").click();
    await other.getByText(/Ο έλεγχος GitHub Pages απέτυχε/).waitFor();
    assert.equal(
      (await download(other, "#export")).document.confirmed.publicationId,
      first.publicationId,
    );
    offline = false;
    snapshot = { ...next, publishedAt: new Date().toISOString() };
    await other.locator("#checkPublication").click();
    await other
      .getByText("Το GitHub Pages επιβεβαίωσε διαφορετική δημόσια έκδοση.", {
        exact: true,
      })
      .waitFor();
    await upload(other, "#restoreFile", first);
    await other.getByText(/Προεπισκόπηση επαναφοράς/).waitFor();
    const rollback = (await download(other, "#publish")).document;
    assert.equal(rollback.basePublicationId, next.publicationId);
    assert.equal(rollback.restoredFrom, first.publicationId);
    assert.deepEqual(rollback.events, first.events);
    snapshot = { ...rollback, publishedAt: new Date().toISOString() };
    await other.locator("#checkPublication").click();
    await other
      .getByText("Το GitHub Pages επιβεβαίωσε διαφορετική δημόσια έκδοση.", {
        exact: true,
      })
      .waitFor();
    const restoredBackup = (await download(other, "#export")).document;
    assert.deepEqual(restoredBackup.records, records);
    assert(sameSnapshot(restoredBackup.confirmed, rollback));
    // Run the exact standalone build from file:// with networking blocked.
    const local = await browser.newPage({ acceptDownloads: true });
    local.on("pageerror", (error) => errors.push(error.message));
    local.on("dialog", (dialog) => dialog.accept());
    await local.context().setOffline(true);
    try {
      await local.goto(
        pathToFileURL(join(process.cwd(), "site", "admin.html")).href,
      );
    } catch (error) {
      if (
        process.env.REQUIRE_FILE_BROWSER === "1" ||
        !error.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")
      )
        throw error;
      console.log(
        "Managed Chromium blocks file:// navigation. The GitHub Actions run requires the standalone test.",
      );
      await local.close();
    }
    if (!local.isClosed()) {
      await local
        .getByText("Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.", {
          exact: true,
        })
        .waitFor();
      await upload(local, "#importFile", restoredBackup);
      await waitSaved(local);
      await local.reload();
      await local
        .getByText("Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.", {
          exact: true,
        })
        .waitFor();
      assert.deepEqual(
        (await download(local, "#export")).document.records,
        records,
      );
      await runPreview(local, "2027-03");
      assert.equal(
        (await download(local, "#publish")).document.basePublicationId,
        rollback.publicationId,
      );
      console.log(
        "Chromium: standalone file:// admin with networking disabled passed.",
      );
    }
    assert.deepEqual(unexpectedDialogs, []);
    assert.deepEqual(errors, []);
    console.log(
      "Chromium: hosted admin, 61 records, preview, confirmation, rollback, XSS and 390×844 / 844×390 passed.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
