const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  const { createCalendar, passwordHash } = await import("../server.js");
  const password = "local browser acceptance only";
  const origin = "http://127.0.0.1:38471";
  const server = createCalendar({
    origin,
    local: true,
    dbPath: ":memory:",
    users: { test: await passwordHash(password) },
  });
  await new Promise((resolve, reject) =>
    server.listen(38471, "127.0.0.1", resolve).on("error", reject),
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const admin = await browser.newPage({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    });
    const athlete = await browser.newPage({
      viewport: { width: 844, height: 390 },
    });
    const errors = [];
    for (const page of [admin, athlete]) {
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (e) => {
        if (e.type() === "error" && e.text().includes("Content Security"))
          errors.push(e.text());
      });
      page.on("dialog", (d) => d.accept());
      await page.goto(origin);
      await page.locator("#count").waitFor();
    }
    await admin.locator("#tabAdmin").click();
    await admin.locator("#username").fill("test");
    await admin.locator("#password").fill(password);
    await admin.locator("#loginForm button").click();
    await admin.locator("#saveDraft").waitFor();
    const records = [
      {
        id: "rsa",
        kind: "regular",
        title: "Ωμέγα",
        time: "19:30",
        start: "2027-03-01",
        end: "2027-03-29",
        excluded: ["2027-03-01"],
      },
      {
        id: "rsb",
        kind: "regular",
        title: "Άλφα",
        time: "18:30",
        start: "2027-03-02",
        end: "2027-03-30",
      },
      {
        id: "s1",
        kind: "special",
        title: "Ιδιωτική δοκιμή",
        dates: ["2027-03-01"],
        times: ["19:00"],
        pending: true,
        replaces: [{ id: "rsa", date: "2027-03-01" }],
      },
      {
        id: "s2",
        kind: "special",
        title: "Διπλή ημερίδα",
        dates: ["2027-03-03", "2027-03-03", "2027-04-03"],
        times: ["16:00", "19:30", "16:00"],
      },
    ];
    const backup = { format: "omh-calendar-demo", version: 1, records };
    await admin
      .locator("#importFile")
      .setInputFiles({
        name: "synthetic.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup)),
      });
    await admin
      .getByText("Όλες οι καταχωρίσεις", { exact: true })
      .last()
      .waitFor();
    assert.deepEqual(
      await admin
        .locator("details")
        .filter({ hasText: "Τακτικός αγώνας" })
        .locator(".listrow strong")
        .allTextContents(),
      ["Άλφα — Τρίτη", "Ωμέγα — Δευτέρα"],
    );
    const download = admin.waitForEvent("download");
    await admin.locator("#export").click();
    assert.deepEqual(
      JSON.parse(await fs.readFile(await (await download).path(), "utf8")),
      backup,
    );
    await admin.locator("#cutoff").fill("2027-03");
    await admin.locator("#saveDraft").click();
    await admin.getByText("Το πρόχειρο αποθηκεύτηκε.").waitFor();
    await admin.locator("#preview").click();
    await admin.locator("#jumpMonth").fill("2027-03");
    await admin.getByText("Διπλή ημερίδα", { exact: true }).first().waitFor();
    assert.equal(
      await admin.getByText("Ιδιωτική δοκιμή", { exact: true }).count(),
      0,
    );
    await admin.locator('[data-show="s2"][data-number="2"]').click();
    await admin
      .locator("#modalHost")
      .getByText("19:30", { exact: true })
      .waitFor();
    await admin.locator("#closeDetail").click();
    assert.equal(
      await athlete.evaluate(() =>
        fetch("api/public")
          .then((r) => r.json())
          .then((d) => d.events.length),
      ),
      0,
    );
    await admin.locator("#publish").click();
    await admin.getByText("Το πρόγραμμα δημοσιεύτηκε.").waitFor();
    await athlete.reload();
    await athlete.locator("#jumpMonth").fill("2027-03");
    await athlete.getByText("Διπλή ημερίδα", { exact: true }).first().waitFor();
    assert.equal(
      await athlete.getByText("Ιδιωτική δοκιμή", { exact: true }).count(),
      0,
    );
    for (const page of [admin, athlete]) {
      for (const view of ["agenda", "week", "month", "year"]) {
        await page.locator('[data-view="' + view + '"]').click();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          view + " overflows viewport width",
        );
      }
      await page.locator("#search").fill("Διπλή");
      await page.locator("#search").fill("");
    }
    await admin.context().setOffline(true);
    await admin.locator("#saveDraft").click();
    await admin.locator("#toast").waitFor();
    await admin.context().setOffline(false);
    await admin.locator("#draftView").click();
    await admin.locator('[data-view="agenda"]').click();
    await admin.getByText("Ιδιωτική δοκιμή", { exact: true }).waitFor();
    await admin.locator("#logout").click();
    await admin.locator("#tools").waitFor({ state: "hidden" });
    assert.equal(
      await admin.evaluate(() => fetch("api/draft").then((r) => r.status)),
      401,
    );
    assert.deepEqual(errors, []);
    console.log("Chromium browser acceptance passed at 390×844 and 844×390.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
