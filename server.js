import { createServer } from "node:http";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  InputError,
  publication,
  validateDraft,
  validateRecords,
} from "./publication.js";

const derive = promisify(scrypt);
const json = JSON.stringify;
const parse = JSON.parse;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const limit = 2_000_000;
const hours = 8 * 60 * 60;
const assets = new Map(
  Object.entries({
    "/": ["index.html", "text/html; charset=utf-8"],
    "/calendar.css": ["calendar.css", "text/css; charset=utf-8"],
    "/calendar.js": ["calendar.js", "text/javascript; charset=utf-8"],
    "/schedule.js": ["schedule.js", "text/javascript; charset=utf-8"],
    "/logo.png": ["logo.png", "image/png"],
  }).map(([path, [file, type]]) => [
    path,
    { body: readFileSync(new URL("./public/" + file, import.meta.url)), type },
  ]),
);
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new HttpError(415, "Απαιτείται JSON.");
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new HttpError(413, "Το αρχείο είναι πολύ μεγάλο.");
    parts.push(part);
  }
  try {
    const body = parse(Buffer.concat(parts));
    if (!body || Array.isArray(body) || typeof body !== "object") throw Error();
    return body;
  } catch {
    throw new InputError("Μη έγκυρο JSON.");
  }
}
export async function passwordHash(
  password,
  salt = randomBytes(16).toString("hex"),
) {
  return salt + ":" + (await derive(password, salt, 64)).toString("hex");
}
export function createCalendar({ dbPath, origin, users, local = false }) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (!local && url.protocol !== "https:") ||
    (local && !["127.0.0.1", "localhost"].includes(url.hostname))
  )
    throw Error("Invalid ORIGIN");
  if (
    !Object.values(users).length ||
    Object.values(users).some((v) => !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(v))
  )
    throw Error("Configure administrator password hashes");
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
      draft TEXT NOT NULL, cutoff TEXT NOT NULL, published INTEGER);
    CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, created TEXT NOT NULL,
      cutoff TEXT NOT NULL, records TEXT NOT NULL, events TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, username TEXT NOT NULL,
      credential TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_budget (hour INTEGER PRIMARY KEY, attempts INTEGER NOT NULL);
    INSERT OR IGNORE INTO state VALUES (1,0,'[]','',NULL);
  `);
  const state = db.prepare("SELECT * FROM state WHERE id=1");
  const getVersion = db.prepare("SELECT * FROM versions WHERE id=?");
  const putVersion = db.prepare(
    "INSERT INTO versions(created,cutoff,records,events) VALUES (?,?,?,?)",
  );
  const readSession = db.prepare(
    "SELECT * FROM sessions WHERE hash=? AND expires>?",
  );
  const deleteSession = db.prepare("DELETE FROM sessions WHERE hash=?");
  const changeDraft = db.prepare(
    "UPDATE state SET draft=?,cutoff=?,revision=revision+1 WHERE id=1",
  );
  const changePublic = db.prepare("UPDATE state SET published=? WHERE id=1");
  const cookieName = local ? "omh_session" : "__Host-omh_session";
  const cookie = (value, age) =>
    `${cookieName}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${local ? "" : "; Secure"}`;
  function sessionKey(request) {
    const raw = request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.split("=")[1];
    return raw && /^[a-f0-9]{64}$/.test(raw) ? digest(raw) : "";
  }
  function authorized(request) {
    const entry = readSession.get(sessionKey(request), Date.now());
    return (
      !!entry &&
      Object.hasOwn(users, entry.username) &&
      entry.credential === digest(users[entry.username])
    );
  }
  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function current(revision) {
    const row = state.get();
    if (revision !== row.revision)
      throw new HttpError(
        409,
        "Το πρόχειρο έχει αλλάξει σε άλλη συνεδρία. Εξαγάγετε τις τοπικές αλλαγές πριν την επαναφόρτωση.",
      );
    return row;
  }
  function previous(row) {
    const version =
      row.published === null ? null : getVersion.get(row.published);
    return (
      version && {
        ...version,
        records: parse(version.records),
        events: parse(version.events),
      }
    );
  }
  async function login(body, request, response) {
    const hour = Math.floor(Date.now() / 3_600_000);
    const attempts = transaction(() => {
      db.prepare("DELETE FROM login_budget WHERE hour<?").run(hour);
      return db
        .prepare(
          "INSERT INTO login_budget VALUES (?,1) ON CONFLICT(hour) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
        )
        .get(hour).attempts;
    });
    if (attempts > 60)
      throw new HttpError(
        429,
        "Πάρα πολλές απόπειρες σύνδεσης. Δοκιμάστε αργότερα.",
      );
    const { username, password } = body;
    if (
      typeof username !== "string" ||
      username.length > 128 ||
      typeof password !== "string" ||
      password.length > 1024
    )
      throw new HttpError(401, "Λανθασμένα στοιχεία σύνδεσης.");
    const expected = Object.hasOwn(users, username) ? users[username] : null;
    const computed = await passwordHash(
      password,
      expected?.split(":")[0] || "87baef633a630e1fcc32fd642702b04a",
    );
    if (
      !expected ||
      !timingSafeEqual(Buffer.from(computed), Buffer.from(expected))
    )
      throw new HttpError(401, "Λανθασμένα στοιχεία σύνδεσης.");
    const raw = randomBytes(32).toString("hex");
    transaction(() => {
      deleteSession.run(sessionKey(request));
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
        digest(raw),
        username,
        digest(expected),
        Date.now() + hours * 1000,
      );
      db.prepare(
        "UPDATE login_budget SET attempts=MAX(0,attempts-1) WHERE hour=?",
      ).run(hour);
    });
    response.setHeader("Set-Cookie", cookie(raw, hours));
    return { authenticated: true };
  }
  const server = createServer(async (request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (!local)
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    const send = (value, status = 200) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(json(value));
    };
    try {
      const path = new URL(request.url, origin).pathname;
      const asset = assets.get(path);
      if (request.method === "GET" && asset) {
        response.writeHead(200, { "Content-Type": asset.type });
        response.end(asset.body);
        return;
      }
      const method = request.method;
      if (!path.startsWith("/api/"))
        throw new HttpError(404, "Η σελίδα δεν βρέθηκε.");
      const route = path.slice(5);
      if (method === "GET" && route === "public")
        return send({ events: previous(state.get())?.events || [] });
      if (method === "GET" && route === "session")
        return send({ authenticated: authorized(request) });
      if (method === "POST" && request.headers.origin !== origin)
        throw new HttpError(403, "Μη επιτρεπτή προέλευση.");
      if (method === "POST" && route === "login")
        return send(await login(await readJson(request), request, response));
      if (!authorized(request))
        throw new HttpError(401, "Απαιτείται σύνδεση διαχειριστή.");
      if (method === "GET" && route === "draft") {
        const row = state.get();
        return send({
          records: parse(row.draft),
          cutoff: row.cutoff,
          revision: row.revision,
        });
      }
      if (method === "GET" && route === "history")
        return send({
          versions: db
            .prepare("SELECT id,created,cutoff FROM versions ORDER BY id DESC")
            .all(),
        });
      if (method !== "POST") throw new HttpError(404, "Η σελίδα δεν βρέθηκε.");
      const body = await readJson(request);
      if (!authorized(request)) throw new HttpError(401, "Η συνεδρία έληξε.");
      if (route === "logout") {
        deleteSession.run(sessionKey(request));
        response.setHeader("Set-Cookie", cookie("", 0));
        return send({ authenticated: false });
      }
      if (route === "validate") {
        if (body.format !== "omh-calendar-demo" || body.version !== 1)
          throw new InputError("Μη συμβατή έκδοση αντιγράφου.");
        validateRecords(body.records);
        return send({ valid: true });
      }
      if (route === "draft" || route === "preview" || route === "publish")
        validateDraft(body);
      if (route === "preview") {
        const result = publication(body, previous(current(body.revision)));
        return send({
          events: result.events,
          token: result.token,
          pastChanges: result.pastChanges,
        });
      }
      const result = transaction(() => {
        const row = current(body.revision);
        const revision = row.revision + 1;
        if (route === "draft") {
          changeDraft.run(json(body.records), body.cutoff);
          return { revision };
        }
        if (route === "publish") {
          const next = publication(body, previous(row));
          if (next.token !== body.token)
            throw new HttpError(
              409,
              "Η προεπισκόπηση έχει αλλάξει. Επαναλάβετε την προεπισκόπηση.",
            );
          const entry = putVersion.run(
            new Date().toISOString(),
            body.cutoff,
            json(next.records),
            json(next.events),
          );
          changeDraft.run(json(body.records), body.cutoff);
          changePublic.run(entry.lastInsertRowid);
          return { revision };
        }
        if (route === "restore") {
          const version = Number.isSafeInteger(body.id)
            ? getVersion.get(body.id)
            : null;
          if (!version) throw new HttpError(404, "Η έκδοση δεν βρέθηκε.");
          const entry = putVersion.run(
            new Date().toISOString(),
            version.cutoff,
            version.records,
            version.events,
          );
          changeDraft.run(row.draft, row.cutoff);
          changePublic.run(entry.lastInsertRowid);
          return { revision };
        }
        throw new HttpError(404, "Η σελίδα δεν βρέθηκε.");
      });
      return send(result);
    } catch (error) {
      const status = error instanceof InputError ? 400 : error.status || 500;
      if (status === 500)
        console.error("Calendar request failed", error.code || error.name);
      if (!response.destroyed)
        send(
          {
            error:
              status === 500
                ? "Η αποθήκευση ή η σύνδεση απέτυχε. Δοκιμάστε ξανά."
                : error.message,
          },
          status,
        );
    }
  });
  server.on("close", () => db.close());
  return server;
}
