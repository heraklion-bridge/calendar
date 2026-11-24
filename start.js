import { createCalendar } from "./server.js";
import { readFileSync } from "node:fs";

process.umask(0o077);
const local = process.env.LOCAL_TEST === "1";
const origin = process.env.ORIGIN || (local ? "http://127.0.0.1:3000" : "");
const port = Number(process.env.PORT || 3000);
const users = JSON.parse(
  readFileSync(process.env.ADMIN_FILE || "private/admins.json", "utf8"),
);
const server = createCalendar({
  origin,
  local,
  users,
  dbPath: process.env.DB_PATH || "private/calendar.sqlite",
});
server.listen(port, "127.0.0.1", () => console.log("ΟΜΗ Calendar " + origin));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
