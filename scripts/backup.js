import { mkdirSync, existsSync, chmodSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

process.umask(0o077);
const source = resolve(process.env.DB_PATH || "private/calendar.sqlite");
const destination = process.argv[2];
if (
  !destination ||
  !existsSync(source) ||
  existsSync(destination) ||
  resolve(destination) === realpathSync(source)
)
  throw Error(
    "Χρήση: node scripts/backup.js private/backups/calendar-YYYYMMDD.sqlite",
  );
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
} finally {
  db.close();
}
