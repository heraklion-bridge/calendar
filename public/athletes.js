import { $, setupCalendar } from "./view.js";
import { loadPublished } from "./published.js";
import { publicationLabel } from "../snapshot.js";

let current,
  checking = false;
const root = new URL("./", location.href).href;
const { renderPublic } = setupCalendar({
  getEvents: () => current?.events || [],
});
async function refresh() {
  if (checking) return;
  checking = true;
  try {
    const next = await loadPublished(root);
    if (
      current?.publishedAt &&
      (!next.publishedAt || next.publishedAt < current.publishedAt)
    )
      throw Error("Το Pages επέστρεψε παλαιότερο στιγμιότυπο.");
    current = next;
    $("publicationStatus").textContent = publicationLabel(current);
    renderPublic();
  } catch {
    $("publicationStatus").textContent = current
      ? publicationLabel(current) + " · Ο νέος έλεγχος απέτυχε."
      : "Το δημοσιευμένο πρόγραμμα δεν είναι διαθέσιμο. Δοκιμάστε ανανέωση.";
  } finally {
    checking = false;
  }
}
$("checkPublication").onclick = refresh;
renderPublic();
void refresh();
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void refresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
setInterval(() => {
  if (!document.hidden) void refresh();
}, 120_000);
