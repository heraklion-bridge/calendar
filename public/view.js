import {
  addDays,
  weekday,
  fmt,
  dateGR,
  dateLabel,
  todayISO,
} from "./schedule.js";

export const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
export const categories = {
  reg: "Τακτικές",
  special: "Έκτακτες",
  lesson: "Μαθήματα",
  external: "ΕΟΜ & άλλοι όμιλοι",
  other: "Άλλες εκδηλώσεις",
  holiday: "Αργίες",
};
export function detail(e) {
  let bits = e.pending ? ["Σε εκκρεμότητα"] : [];
  if (e.category === "reg")
    bits.push(
      e.independent
        ? "Ανεξάρτητη ημερίδα"
        : `${e.number}η / ${e.groupTotal} · ${e.group}ο πολυήμερο`,
    );
  if (e.simultaneous) bits.push("Ταυτόχρονο");
  if (e.category === "special")
    bits.push(
      `${e.number}/${e.total} ημερίδα`,
      e.grade && e.grade !== "Χωρίς βαθμίδα" ? `${e.grade} βαθμίδα` : "",
    );
  if (e.category === "lesson")
    bits.push(`${e.cycleNumber}ο μάθημα · ${e.cycle}ος κύκλος`);
  if (e.note) bits.push(e.note);
  return bits.filter(Boolean).join(" · ");
}
export function monthLast(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function displayEvent(e, actions = "") {
  $("modalHost").onclick = null;
  const html = `<div class="modalback" id="modalBack"><div class="modal" role="dialog" aria-modal="true" aria-label="Λεπτομέρειες γεγονότος"><div class="spread"><h2>${esc(e.title)}</h2><button class="btn small" id="closeModal" aria-label="Κλείσιμο">✕</button></div><div class="row"><span class="tag">${esc(categories[e.category])}</span><span class="tag">${esc(dateLabel(e.date))}</span></div><p><strong>${esc(e.time || "Χωρίς καθορισμένη ώρα")}</strong></p><p class="muted">${esc(detail(e) || "Δεν υπάρχουν πρόσθετες πληροφορίες.")}</p>${actions}<div class="row"><button class="btn" id="closeDetail">Κλείσιμο</button></div></div></div>`;
  $("modalHost").innerHTML = html;
  const close = () => ($("modalHost").innerHTML = "");
  $("closeModal").onclick = close;
  $("closeDetail").onclick = close;
  $("modalBack").onclick = (x) => {
    if (x.target.id === "modalBack") close();
  };
  return close;
}
export function displayDay(date, list, restoreMarkup = "") {
  $("modalHost").innerHTML =
    `<div class="modalback" id="modalBack"><div class="modal"><div class="spread"><h2>${esc(dateLabel(date))}</h2><button class="btn small" id="closeDay">✕</button></div>${list.length ? list.map((e) => `<button class="day-detail" data-show="${esc(e.id)}" data-date="${e.date}" data-number="${e.number || ""}"><strong>${esc(e.title)}</strong><span>${esc(e.time || "Χωρίς ώρα")} · ${esc(detail(e))}</span></button>`).join("") : '<p class="muted">Δεν υπάρχουν γεγονότα.</p>'}${restoreMarkup}</div></div>`;
  $("closeDay").onclick = () => {
    $("modalHost").innerHTML = "";
  };
}
export function setupCalendar({
  getEvents,
  editable = () => false,
  cancelledRegular = () => [],
  onEvent,
  onDay,
}) {
  let cursor = todayISO(),
    view = "agenda",
    filter = new Set(Object.keys(categories)),
    savedNonYearFilters = null,
    search = "";
  function filtered() {
    return getEvents().filter(
      (e) =>
        filter.has(e.category) &&
        `${e.title} ${e.note} ${categories[e.category]}`
          .toLocaleLowerCase("el")
          .includes(search.toLocaleLowerCase("el")),
    );
  }
  function periodRange() {
    const year = +cursor.slice(0, 4),
      month = +cursor.slice(5, 7);
    if (view === "year") return [year + "-01-01", year + "-12-31"];
    if (view === "month")
      return [
        cursor.slice(0, 7) + "-01",
        year +
          "-" +
          String(month).padStart(2, "0") +
          "-" +
          String(monthLast(year, month)).padStart(2, "0"),
      ];
    if (view === "week") {
      const offset = (weekday(cursor) + 6) % 7;
      const start = addDays(cursor, -offset);
      return [start, addDays(start, 6)];
    }
    return [
      cursor.slice(0, 7) + "-01",
      year +
        "-" +
        String(month).padStart(2, "0") +
        "-" +
        String(monthLast(year, month)).padStart(2, "0"),
    ];
  }
  function renderPublic() {
    $("jumpMonth").value = cursor.slice(0, 7);
    $("restoreLookup")?.classList.toggle("hidden", !editable());
    const [from, to] = periodRange(),
      events = filtered(),
      shown = events.filter((e) => e.date >= from && e.date <= to);
    $("periodLabel").textContent =
      view === "year"
        ? cursor.slice(0, 4)
        : view === "week"
          ? `${dateGR(from)} – ${dateGR(to)}`
          : fmt(from, { month: "long", year: "numeric" });
    $("filters").innerHTML = Object.entries(categories)
      .map(
        ([k, v]) =>
          `<button class="pill ${filter.has(k) ? "active" : ""}" data-filter="${k}">${esc(v)}</button>`,
      )
      .join("");
    $("yearOptions").classList.toggle("hidden", view !== "year");
    $("count").textContent =
      `${shown.length} εμφανιζόμενα γεγονότα${search ? " · Αναζήτηση ενεργή" : ""}`;
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "agenda" || view === "week") {
      let prev = "";
      $("calendarBody").innerHTML = shown.length
        ? '<div class="agenda">' +
          shown
            .map((e) => {
              let head = "";
              if (e.date !== prev) {
                head = `<div class="dayline" data-day="${e.date}">${esc(dateLabel(e.date))}</div>`;
                prev = e.date;
              }
              return `${head}<div class="event ${e.category}${e.pending ? " pending" : ""}" data-show="${esc(e.id)}" data-date="${e.date}" data-number="${e.number || ""}" role="button" tabindex="0"><div class="time">${esc(e.time || "—")}</div><div class="stripe"></div><div><div class="title">${esc(e.title)}</div><div class="sub">${esc(detail(e))}</div></div><span class="tag">${esc(categories[e.category])}</span></div>`;
            })
            .join("") +
          "</div>"
        : '<div class="empty">Δεν υπάρχουν εγγραφές σε αυτή την περίοδο.</div>';
      return;
    }
    if (view === "year") {
      const y = +cursor.slice(0, 4),
        fullWeek = $("weekendOnly").checked;
      const priority = new Set(["special", "external", "other"]);
      const yearEvents = events.filter((e) => e.date.startsWith(String(y)));
      const months = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1,
          first = y + "-" + String(m).padStart(2, "0") + "-01",
          last = monthLast(y, m),
          days = [];
        for (let day = 1; day <= last; day++) {
          const d = first.slice(0, 8) + String(day).padStart(2, "0");
          const dayEvents = yearEvents.filter((e) => e.date === d);
          if (
            !fullWeek &&
            !dayEvents.length &&
            !(editable() && cancelledRegular(d).length)
          )
            continue;
          const w = weekday(d);
          days.push({
            week: Math.floor((day - 1 + ((weekday(first) + 6) % 7)) / 7),
            html: `<div class="weekend-day"><button class="weekend-date date-button" data-day="${d}"><strong>${day}</strong><span>${["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"][w]}</span></button><div class="weekend-events">${dayEvents.length ? dayEvents.map((e) => `<button class="weekend-event ${e.category}${e.pending ? " pending" : ""}" data-show="${esc(e.id)}" data-date="${e.date}" data-number="${e.number || ""}" title="${esc(detail(e))}"><strong>${esc(e.title)}</strong><small>${esc(e.time || "")}${detail(e) ? " · " + esc(detail(e)) : ""}</small></button>`).join("") : '<span class="weekend-empty">—</span>'}${editable() && cancelledRegular(d).length ? `<button class="btn small" data-day="${d}">↶ Ακυρωμένη ημερίδα</button>` : ""}</div></div>`,
          });
        }
        const monthEvents = yearEvents.filter(
          (e) => e.date.slice(0, 7) === first.slice(0, 7),
        );
        return `<section class="weekend-month"><h3>${esc(fmt(first, { month: "long", year: "numeric" }))} <span class="tiny">${monthEvents.length} γεγονότα</span></h3>${
          days.length
            ? `<div class="weekend-days">${[...new Set(days.map((x) => x.week))]
                .map(
                  (w) =>
                    `<div class="year-week-row">${days
                      .filter((x) => x.week === w)
                      .map((x) => x.html)
                      .join("")}</div>`,
                )
                .join("")}</div>`
            : '<p class="tiny">Δεν υπάρχουν σχετικά γεγονότα.</p>'
        }</section>`;
      });
      $("calendarBody").innerHTML =
        '<div class="year-weekends">' + months.join("") + "</div>";
      return;
    }
    const y = +cursor.slice(0, 4),
      m = +cursor.slice(5, 7),
      first = y + "-" + String(m).padStart(2, "0") + "-01",
      off = (weekday(first) + 6) % 7,
      n = monthLast(y, m),
      byDate = {};
    shown.forEach((e) => (byDate[e.date] ??= []).push(e));
    let html =
      '<div class="monthgrid">' +
      ["Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ", "Κυρ"]
        .map((x) => `<div class="weekday">${x}</div>`)
        .join("");
    for (let i = 0; i < Math.ceil((n + off) / 7) * 7; i++) {
      const day = i - off + 1,
        valid = day >= 1 && day <= n,
        d = valid ? first.slice(0, 8) + String(day).padStart(2, "0") : "";
      html += `<div class="day ${valid ? "" : "off"} ${d === todayISO() ? "today" : ""}"><button class="daynum date-button" ${valid ? `data-day="${d}"` : "disabled"}>${valid ? day : ""}</button>${valid && editable() && cancelledRegular(d).length ? `<button class="btn small" data-day="${d}">↶</button>` : ""}${valid ? (byDate[d] || []).map((e) => `<button class="dotentry ${e.category}${e.pending ? " pending" : ""}" data-show="${esc(e.id)}" data-date="${e.date}" data-number="${e.number || ""}" title="${esc(e.title + " " + (e.time || "") + (e.pending ? " · Σε εκκρεμότητα" : ""))}">${esc(e.title)} <span class="tiny">${esc(e.time)}</span></button>`).join("") : ""}</div>`;
    }
    $("calendarBody").innerHTML = html + "</div>";
  }
  function navigate(n) {
    let y = +cursor.slice(0, 4),
      m = +cursor.slice(5, 7);
    if (view === "year") cursor = y + n + "-01-01";
    else if (view === "week") cursor = addDays(cursor, n * 7);
    else {
      m += n;
      while (m < 1) {
        m += 12;
        y--;
      }
      while (m > 12) {
        m -= 12;
        y++;
      }
      cursor = y + "-" + String(m).padStart(2, "0") + "-01";
    }
    renderPublic();
  }
  const themeKey = "omh-calendar-theme-v3";
  let darkMode = true;
  try {
    darkMode = localStorage.getItem(themeKey) !== "light";
  } catch {}
  function applyTheme() {
    document.body.classList.toggle("dark", darkMode);
    $("themeToggle").textContent = darkMode ? "☀ Φωτεινό" : "☾ Σκοτεινό";
    $("themeToggle").setAttribute("aria-pressed", String(darkMode));
  }
  applyTheme();
  $("themeToggle").onclick = () => {
    darkMode = !darkMode;
    try {
      localStorage.setItem(themeKey, darkMode ? "dark" : "light");
    } catch {}
    applyTheme();
  };
  $("jumpMonth").onchange = (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) {
      cursor = e.target.value + "-01";
      renderPublic();
    }
  };
  $("prev").onclick = () => navigate(-1);
  $("next").onclick = () => navigate(1);
  $("today").onclick = () => {
    cursor = todayISO();
    renderPublic();
  };
  $("viewBtns").onclick = (e) => {
    const b = e.target.closest("[data-view]");
    if (b) {
      const next = b.dataset.view;
      if (view !== "year" && next === "year") {
        savedNonYearFilters = new Set(filter);
        filter.delete("reg");
        filter.delete("lesson");
        $("weekendOnly").checked = false;
      } else if (view === "year" && next !== "year" && savedNonYearFilters) {
        filter = new Set(savedNonYearFilters);
        savedNonYearFilters = null;
      }
      view = next;
      renderPublic();
    }
  };
  $("filters").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter.has(b.dataset.filter)
      ? filter.delete(b.dataset.filter)
      : filter.add(b.dataset.filter);
    renderPublic();
  };
  $("search").oninput = (e) => {
    search = e.target.value;
    renderPublic();
  };
  $("calendarBody").onclick = (e) => {
    const b = e.target.closest("[data-show]");
    if (b) {
      (onEvent || defaultEvent)(
        b.dataset.show,
        b.dataset.date,
        b.dataset.number,
      );
      return;
    }
    const day = e.target.closest("[data-day]");
    if (day) (onDay || defaultDay)(day.dataset.day);
  };
  $("weekendOnly").onchange = renderPublic;
  document.addEventListener("keydown", (e) => {
    if (
      (e.key === "Enter" || e.key === " ") &&
      e.target.matches(".event[data-show]")
    ) {
      e.preventDefault();
      e.target.click();
    }
  });
  function defaultEvent(id, date, number) {
    const event = getEvents().find(
      (row) =>
        row.id === id &&
        row.date === date &&
        (!number || row.number === +number),
    );
    if (event) displayEvent(event);
  }
  function defaultDay(date) {
    displayDay(
      date,
      filtered().filter((event) => event.date === date),
    );
    $("modalHost").onclick = (e) => {
      const button = e.target.closest("[data-show]");
      if (button)
        defaultEvent(
          button.dataset.show,
          button.dataset.date,
          button.dataset.number,
        );
      else if (e.target.id === "modalBack") $("modalHost").replaceChildren();
    };
  }
  return { cursor: () => cursor, renderPublic, filtered };
}
