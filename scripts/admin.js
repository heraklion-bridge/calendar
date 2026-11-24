import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { passwordHash } from "../server.js";

process.umask(0o077);
const [command, username] = process.argv.slice(2);
if (
  !["set", "remove"].includes(command) ||
  !/^[a-zA-Z0-9._-]{1,100}$/.test(username || "")
)
  throw Error("Χρήση: node scripts/admin.js set|remove username");
const path = process.env.ADMIN_FILE || "private/admins.json";
const users = Object.assign(
  Object.create(null),
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {},
);
if (command === "remove") {
  if (!Object.hasOwn(users, username) || Object.keys(users).length < 2)
    throw Error("Ο χρήστης δεν υπάρχει ή είναι ο τελευταίος διαχειριστής.");
  delete users[username];
} else {
  const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (password.length < 16 || password.length > 1024)
    throw Error("Ο κωδικός πρέπει να έχει 16–1024 χαρακτήρες.");
  users[username] = await passwordHash(password);
}
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const temporary = path + "." + process.pid + ".tmp";
writeFileSync(temporary, JSON.stringify(users, null, 2), {
  mode: 0o600,
  flag: "wx",
});
renameSync(temporary, path);
chmodSync(path, 0o600);
console.log(
  "Ενημερώθηκε το ιδιωτικό αρχείο διαχειριστών. Επανεκκινήστε τον διακομιστή.",
);
