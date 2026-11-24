import { readFile } from "node:fs/promises";
import { parsePublic } from "../snapshot.js";

try {
  parsePublic(await readFile(process.argv[2] || "calendar.json", "utf8"));
  console.log("Έγκυρο σχήμα δημόσιου αρχείου.");
} catch {
  console.error("Μη έγκυρο δημόσιο αρχείο calendar.json.");
  process.exitCode = 1;
}
