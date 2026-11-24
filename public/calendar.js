import {
  $,
  esc,
  monthLast,
  setupCalendar,
  displayEvent,
  displayDay,
} from "./view.js";
import { loadPublished } from "./published.js";
import {
  addDays,
  weekday,
  fmt,
  dateGR,
  dateLabel,
  greekHolidays,
  countSpecial,
  validTime,
  todayISO,
  automaticHolidays as holidays,
  sessions as expand,
} from "./schedule.js";

import { publication, validateDraft } from "../publication.js";
import {
  PAGES_ROOT,
  parsePublic,
  newSnapshot,
  projectPublic,
  sameSnapshot,
  publicationLabel,
} from "../snapshot.js";
import {
  blankState,
  readBackup,
  confirmedVersion,
  openStorage,
  storedState,
  storeState,
  MAX_PRIVATE_BYTES,
} from "../private-state.js";

(() => {
  "use strict";
  const types = {
    regular: "Τακτικός αγώνας",
    special: "Έκτακτη διοργάνωση",
    lesson: "Μαθήματα",
    external: "ΕΟΜ / άλλος όμιλος",
    other: "Άλλη εκδήλωση",
    holiday: "Αργία",
  };
  const regularNames = [
    "Ζεύγη Όπεν",
    "Ζεύγη 1-9",
    "Ζεύγη 1-6",
    "Ομάδες Όπεν",
    "Ομάδες 1-9",
    "Ομάδες 1-6",
  ];
  const specialNames = [
    "Τριήμερο Ζευγών",
    "Γκραν Πρι Ζευγών",
    "Τριήμερο Ομάδων",
    "Διήμερο Ομάδων",
    "Προκριματικά",
    "Μεμονωμένη ημερίδα",
    "Προσαρμοσμένο",
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () =>
    "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let data = [],
    publicEvents = [];
  let adminPreview = false;
  let active = "public",
    section = "new",
    editing = null,
    editKind = "regular",
    sessionDates = [],
    sessionTimes = [];
  function toast(s) {
    $("toast").textContent = s;
    $("toast").classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("toast").classList.add("hidden"), 3500);
  }
  function nearestWeekday(d) {
    const y = +d.slice(0, 4) + 1,
      m = +d.slice(5, 7),
      day = Math.min(+d.slice(8, 10), monthLast(y, m));
    const base = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let delta = (weekday(d) - weekday(base) + 7) % 7;
    if (delta > 3) delta -= 7;
    return addDays(base, delta);
  }
  const sessions = (r) => expand(r, data);
  const automaticHolidays = (y) => holidays(y, data);
  const {
    renderPublic,
    filtered,
    cursor: calendarCursor,
  } = setupCalendar({
    getEvents: allEvents,
    editable: () => adminPreview,
    cancelledRegular,
    onEvent: showEvent,
    onDay: showDay,
  });
  function allEvents() {
    return !adminPreview
      ? publicEvents
      : [
          ...data,
          ...automaticHolidays(+calendarCursor().slice(0, 4) - 1),
          ...automaticHolidays(+calendarCursor().slice(0, 4)),
          ...automaticHolidays(+calendarCursor().slice(0, 4) + 1),
        ]
          .flatMap(sessions)
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              (a.time || "99").localeCompare(b.time || "99") ||
              a.title.localeCompare(b.title, "el"),
          );
  }
  function showTab(t) {
    active = t;
    $("public").classList.toggle("hidden", t !== "public");
    $("admin").classList.toggle("hidden", t !== "admin");
    $("draftView").classList.toggle("active", t === "public" && adminPreview);
    $("tabAdmin").classList.toggle("active", t === "admin");
    render();
  }
  function render() {
    if (active === "public") renderPublic();
    else renderAdmin();
  }
  function renderAdmin() {
    document
      .querySelectorAll(".sidebtn")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.section === section),
      );
    if (section === "new") renderForm();
    if (section === "manage") renderManage();
    if (section === "exceptions") renderExceptions();
    if (section === "rules") renderRules();
    if (section === "holidays") renderHolidays();
    if (section === "rollover") renderRollover();
    if (section === "clearYear") renderClearYear();
  }
  function options(arr, selected) {
    return arr
      .map(
        (v) =>
          `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`,
      )
      .join("");
  }
  function input(id, label, type = "text", value = "", extra = "") {
    return `<label>${label}<input class="field" id="${id}" type="${type === "date" || type === "time" ? "text" : type}" ${type === "date" ? 'data-date-picker readonly inputmode="none"' : type === "time" ? 'data-time24 placeholder="ΩΩ:ΛΛ" maxlength="5" inputmode="text"' : ""} value="${esc(value)}" ${extra}></label>`;
  }
  function defaultRecord(kind) {
    const date = calendarCursor();
    return kind === "regular"
      ? {
          kind,
          title: "Ζεύγη 1-9",
          start: date,
          end: addDays(date, 35),
          time: "19:30",
          simultaneous: false,
          notes: "",
        }
      : kind === "special"
        ? {
            kind,
            title: "Τριήμερο Ζευγών",
            template: "Τριήμερο Ζευγών",
            grade: "4η",
            dates: [date, addDays(date, 1), addDays(date, 2)],
            times: ["19:30", "19:30", "19:30"],
            notes: "",
            replaces: [],
          }
        : kind === "lesson"
          ? {
              kind,
              title: "Αρχάριοι",
              start: date,
              count: 30,
              cycles: 3,
              perCycle: 10,
              startingNumber: 1,
              time: "18:00",
              notes: "",
            }
          : kind === "external"
            ? {
                kind,
                title: "Διοργάνωση ΕΟΜ",
                start: date,
                end: date,
                notes: "",
              }
            : {
                kind,
                title: "Εκδήλωση ΟΜΗ",
                start: date,
                time: "18:00",
                notes: "",
              };
  }
  function renderForm() {
    const r = editing
      ? data.find((x) => x.id === editing)
      : defaultRecord(editKind);
    if (!r) {
      editing = null;
      return renderForm();
    }
    editKind = r.kind;
    let html = `<div class="spread"><div><h2>${editing ? "Επεξεργασία καταχώρισης" : "Νέα καταχώριση"}</h2><div class="tiny">Επιλογή τύπου και συμπλήρωση βασικών στοιχείων</div></div>${editing ? '<button class="btn small" id="newInstead">+ Νέα</button>' : ""}</div><div class="formgrid"><label>Κατηγορία<select id="kind" ${editing ? "disabled" : ""}>${Object.entries(
      types,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${r.kind === k ? "selected" : ""}>${v}</option>`,
      )
      .join("")}</select></label>`;
    if (r.kind === "regular") {
      html += `<label>Τύπος αγώνα<select id="regularTitle">${options([...new Set([...regularNames, r.title])], r.title)}</select></label>${input("start", "Πρώτη ημερίδα", "date", r.start)}${input("end", "Τελευταία ημερίδα", "date", r.end)}${input("time", "Συνήθης ώρα", "time", r.time)}<label class="check"><input type="checkbox" id="simultaneous" ${r.simultaneous ? "checked" : ""}> Συμμετέχει στο ταυτόχρονο</label><div class="full inlinehelp">Οι τακτικοί αγώνες παράγονται ανά εβδομάδα. Η αρίθμηση γίνεται σε 6ήμερα και, όπου χρειάζεται, σε 5ήμερα στο τέλος του έτους. Ανεξάρτητες ημερίδες δεν προσμετρώνται.</div>`;
    } else if (r.kind === "special") {
      html += `<label>Πρότυπο διοργάνωσης<select id="template">${options([...new Set([...specialNames, r.template || specialNames[0]])], r.template || specialNames[0])}</select></label><label>Βαθμίδα<select id="grade">${options(["4η", "3η", "2η", "1η", "Χωρίς βαθμίδα"], r.grade || "Χωρίς βαθμίδα")}</select></label>${input("title", "Τίτλος", "text", r.title, 'maxlength="120"')}<div class="full"><div class="spread"><strong>Ημερίδες και ώρες</strong><div class="row"><button class="btn small" id="consecutive" type="button">Διαδοχικές από την πρώτη</button><button class="btn small" id="addSession" type="button">+ Ημερίδα</button></div></div><div id="sessionRows"></div><div class="inlinehelp">Μπορείς να επιλέξεις διαφορετικές ημερομηνίες και ώρες για κάθε ημερίδα. Η μετακίνηση ολόκληρης της διοργάνωσης γίνεται από τις «Μετακινήσεις».</div></div>`;
    } else if (r.kind === "lesson") {
      html += `${input("title", "Τμήμα / μάθημα", "text", r.title)}${input("start", "Πρώτη ημερομηνία", "date", r.start)}${input("time", "Ώρα", "time", r.time)}${input("cycles", "Πλήθος κύκλων", "number", r.cycles || 1, 'min="1" max="30"')}<label class="check"><input type="checkbox" id="equalCycles" ${Array.isArray(r.cycleSizes) ? "" : "checked"}> Ίσοι κύκλοι</label><div id="equalCycleField">${input("perCycle", "Μαθήματα ανά κύκλο", "number", r.perCycle || 10, 'min="1" max="150"')}</div><div class="full" id="customCycleFields"></div><label>Σύνολο μαθημάτων (αυτόματο)<input class="field" id="count" type="number" value="${(Number(r.cycles) || 1) * (Number(r.perCycle) || 1)}" readonly></label>${input("startingNumber", "Αριθμός πρώτου μαθήματος", "number", r.startingNumber, 'min="1" max="150"')}<div class="full inlinehelp">Το άθροισμα των μαθημάτων ανά κύκλο δίνει αυτόματα το σύνολο. Αν ξεκινήσεις τον Σεπτέμβριο 2026, τα μαθήματα συνεχίζονται στο 2027. Οι ακυρώσεις μεταθέτουν τα επόμενα μαθήματα χωρίς να καταναλώνουν αριθμό. Για ειδική συνέχεια μπορείς να ορίσεις αριθμό πρώτου μαθήματος.</div>`;
    } else if (r.kind === "external") {
      html += `${input("title", "Τίτλος διοργάνωσης", "text", r.title)}${input("start", "Από", "date", r.start)}${input("end", "Έως", "date", r.end || r.start)}${input("time", "Ώρα (προαιρετική)", "time", r.time || "", "data-optional")}<div class="full inlinehelp">Η διοργάνωση δεν επηρεάζει τις δραστηριότητες του ΟΜΗ.</div>`;
    } else if (r.kind === "holiday") {
      html += `${input("title", "Ονομασία", "text", r.title)}${input("start", "Ημερομηνία", "date", r.start)}
        <label class="check"><input type="checkbox" id="editBlockRegular" ${r.blocks?.includes("regular") ? "checked" : ""}> Αναστολή τακτικών αγώνων</label>
        <label class="check"><input type="checkbox" id="editBlockLesson" ${r.blocks?.includes("lesson") ? "checked" : ""}> Αναστολή μαθημάτων</label>`;
    } else {
      html += `${input("title", "Τίτλος εκδήλωσης", "text", r.title)}${input("start", "Ημερομηνία", "date", r.start)}${input("time", "Ώρα", "time", r.time)}`;
    }
    html += `<label class="full">Σημειώσεις<textarea id="notes" maxlength="500">${esc(r.notes || "")}</textarea></label></div><div class="section row"><button class="btn primary" id="saveRecord">${editing ? "Αποθήκευση αλλαγών" : "Δημιουργία γεγονότος"}</button><button class="btn" id="clearForm">Καθαρισμός</button><span class="status" id="formStatus"></span></div>`;
    $("adminContent").innerHTML = html;
    $("adminContent").insertAdjacentHTML(
      "afterbegin",
      `<label class="check"><input type="checkbox" id="pendingRecord" ${r.pending ? "checked" : ""}> Σε εκκρεμότητα</label>`,
    );
    if (r.kind === "special") {
      sessionDates = [...(r.dates || [])];
      sessionTimes = [...(r.times || [])];
      renderSessionRows();
    }
    $("kind").onchange = (e) => {
      editKind = e.target.value;
      editing = null;
      renderForm();
    };
    $("clearForm").onclick = () => {
      editing = null;
      renderForm();
    };
    if ($("newInstead"))
      $("newInstead").onclick = () => {
        editing = null;
        renderForm();
      };
    if (r.kind === "special") {
      $("template").onchange = () => {
        const t = $("template").value;
        const num = countSpecial(t),
          start = sessionDates[0] || "2027-04-05";
        sessionDates = Array.from(
          { length: num },
          (_, i) => sessionDates[i] || addDays(start, i),
        );
        sessionTimes = Array.from(
          { length: num },
          (_, i) => sessionTimes[i] || "19:30",
        );
        if (!editing) $("title").value = t;
        renderSessionRows();
      };
      $("consecutive").onclick = () => {
        syncSessions();
        sessionDates = sessionDates.map((_, i) => addDays(sessionDates[0], i));
        renderSessionRows();
      };
      $("addSession").onclick = () => {
        syncSessions();
        sessionDates.push(addDays(sessionDates.at(-1) || "2027-04-05", 1));
        sessionTimes.push(sessionTimes.at(-1) || "19:30");
        renderSessionRows();
      };
    }
    if (r.kind === "lesson") {
      let sizes = [...(r.cycleSizes || [])];
      const updateCount = () => {
        const n = Number($("cycles").value);
        $("count").value = $("equalCycles").checked
          ? n * Number($("perCycle").value)
          : sizes.slice(0, n).reduce((a, b) => a + Number(b), 0);
      };
      const refresh = () => {
        const n = Math.min(
          30,
          Math.max(0, Math.floor(Number($("cycles").value) || 0)),
        );
        const equal = $("equalCycles").checked;
        $("equalCycleField").classList.toggle("hidden", !equal);
        $("customCycleFields").classList.toggle("hidden", equal);
        if (!equal) {
          for (let i = 0; i < n; i++)
            if (sizes[i] === undefined)
              sizes[i] = Number($("perCycle").value) || 10;
          $("customCycleFields").innerHTML =
            '<div class="formgrid">' +
            Array.from({ length: n }, (_, i) =>
              input(
                "cycleSize" + i,
                i + 1 + "ος κύκλος",
                "number",
                sizes[i],
                'min="1" max="150"',
              ),
            ).join("") +
            "</div>";
          for (let i = 0; i < n; i++)
            $("cycleSize" + i).oninput = () => {
              sizes[i] = $("cycleSize" + i).value;
              updateCount();
            };
        }
        updateCount();
      };
      $("cycles").oninput = refresh;
      $("equalCycles").onchange = refresh;
      $("perCycle").oninput = updateCount;
      refresh();
    }
    $("saveRecord").onclick = saveRecord;
  }
  function renderSessionRows() {
    $("sessionRows").innerHTML = sessionDates
      .map(
        (d, i) =>
          `<div class="sessionrow"><span>${i + 1}η</span>${input("sd" + i, "Ημερομηνία", "date", d)}${input("st" + i, "Ώρα", "time", sessionTimes[i] || "19:30")}</div>`,
      )
      .join("");
  }
  function syncSessions() {
    sessionDates = sessionDates.map(
      (_, i) => $("sd" + i)?.value || sessionDates[i],
    );
    sessionTimes = sessionTimes.map(
      (_, i) => $("st" + i)?.value || sessionTimes[i],
    );
  }
  function decisionDialog(title, rows, done) {
    const host = $("modalHost");
    host.onclick = null;
    host.innerHTML = `<div class="modalback" id="modalBack"><div class="modal" role="dialog" aria-modal="true" style="max-height:85vh;overflow:auto"><h2>${esc(title)}</h2>${rows.map((c, i) => `<div class="inlinehelp" style="margin:12px 0"><strong>${esc(c.label)}</strong><label><select id="decision${i}">${c.options.map((o, j) => `<option value="${j}">${esc(o)}</option>`).join("")}</select></label></div>`).join("")}<div class="row"><button class="btn primary" id="decisionOK">Επιβεβαίωση</button><button class="btn" id="decisionCancel">Άκυρο</button></div></div></div>`;
    $("decisionCancel").onclick = () => (host.innerHTML = "");
    $("decisionOK").onclick = () => {
      const choices = rows.map((_, i) => +$("decision" + i).value);
      host.innerHTML = "";
      done(choices);
    };
  }
  function regularSlot(record, date) {
    return (
      Object.keys(record.overrides || {}).find(
        (d) => record.overrides[d]?.date === date,
      ) || date
    );
  }
  function resolveSpecialConflicts(r, done, removing = false) {
    const old = data.find((x) => x.id === r.id),
      dates = new Set(removing ? [] : r.dates || []),
      rows = [],
      actions = [],
      retained = [],
      kept = [...(old?.keepsCancelled || [])];
    const otherOwner = (id, date) =>
      data.some(
        (x) =>
          x.kind === "special" &&
          x.id !== r.id &&
          x.replaces?.some((z) => z.id === id && z.date === date),
      );
    for (const z of old?.replaces || []) {
      const reg = data.find((x) => x.id === z.id && x.kind === "regular");
      if (!reg) continue;
      const slot = regularSlot(reg, z.date);
      if (dates.has(z.date)) {
        retained.push(z);
        continue;
      }
      if (!reg.excluded?.includes(slot) || otherOwner(z.id, z.date)) continue;
      rows.push({
        label: "Επαναφορά: " + dateLabel(z.date) + " — " + reg.title,
        options: [
          "Επαναφορά τακτικού αγώνα",
          ...(removing && old.pending ? [] : ["Παραμονή ακύρωσης"]),
        ],
      });
      actions.push((v) => {
        if (v === 0) reg.excluded = reg.excluded.filter((d) => d !== slot);
        else if (!removing) kept.push(z);
      });
    }
    for (const d of dates) {
      for (const reg of data.filter((x) => x.kind === "regular")) {
        if (retained.some((z) => z.id === reg.id && z.date === d)) continue;
        const other = otherOwner(reg.id, d);
        const candidate = other
          ? {
              ...reg,
              excluded: (reg.excluded || []).filter(
                (day) => day !== regularSlot(reg, d),
              ),
            }
          : reg;
        if (!sessions(candidate).some((e) => e.date === d)) continue;
        if (old?.dates?.includes(d) && !other) continue;
        rows.push({
          label: "Σύγκρουση: " + dateLabel(d) + " — " + reg.title,
          options: ["Διατήρηση και των δύο", "Ακύρωση τακτικού αγώνα"],
        });
        actions.push((v) => {
          if (v === 1) {
            reg.excluded = [
              ...new Set([
                ...(reg.excluded || []),
                sessions(candidate).find((e) => e.date === d).sessionDate,
              ]),
            ];
            retained.push({ id: reg.id, date: d });
          }
        });
      }
    }
    if (!removing) {
      for (const x of data.filter(
        (x) => x.kind === "special" && x.id !== r.id,
      )) {
        const common = [...dates].filter((d) => x.dates.includes(d));
        if (common.length) {
          rows.push({
            label:
              "Σύγκρουση διοργανώσεων: " +
              x.title +
              " — " +
              common.map(dateGR).join(", "),
            options: ["Επιστροφή χωρίς αποθήκευση", "Συνύπαρξη διοργανώσεων"],
          });
          actions.push(null);
        }
      }
    }
    const finish = (choices) => {
      if (actions.some((fn, i) => !fn && choices[i] !== 1)) {
        toast("Δεν αποθηκεύτηκε η αλλαγή.");
        return;
      }
      actions.forEach((fn, i) => fn?.(choices[i]));
      r.replaces = retained;
      r.keepsCancelled = kept.filter(
        (z) =>
          !retained.some((link) => link.id === z.id && link.date === z.date),
      );
      if (removing && old?.pending) {
        for (const link of kept) {
          const reg = data.find(
            (x) => x.id === link.id && x.kind === "regular",
          );
          if (reg && !otherOwner(link.id, link.date))
            reg.excluded = (reg.excluded || []).filter(
              (day) => day !== regularSlot(reg, link.date),
            );
        }
      }
      done();
    };
    if (rows.length)
      decisionDialog("Έλεγχος συγκρούσεων και επαναφορών", rows, finish);
    else finish([]);
  }
  function deleteRecord(id, date, number) {
    const r = data.find((x) => x.id === id);
    if (!r) return;
    const single = !!date && ["special", "external"].includes(r.kind);
    const opts = single
      ? [
          "Μόνο το γεγονός της συγκεκριμένης ημέρας",
          "Ολόκληρη η καταχώριση / σειρά",
        ]
      : ["Ολόκληρη η καταχώριση"];
    decisionDialog(
      "Διαγραφή — " + r.title,
      [{ label: "Επίλεξε τι θέλεις να διαγράψεις", options: opts }],
      ([choice]) => {
        const one = single && choice === 0;
        const next = clone(r);
        const finish = () => {
          if (one && r.kind === "special" && next.dates.length)
            data = data.map((x) => (x.id === id ? next : x));
          else if (one && ["regular", "lesson", "external"].includes(r.kind)) {
            r.excluded = [...new Set([...(r.excluded || []), date])];
          } else data = data.filter((x) => x.id !== id);
          persist();
          render();
          toast("Η διαγραφή ολοκληρώθηκε.");
        };
        if (r.kind === "special") {
          if (one) {
            const i = number ? number - 1 : next.dates.indexOf(date);
            next.dates.splice(i, 1);
            next.times.splice(i, 1);
          }
          resolveSpecialConflicts(next, finish, !one || !next.dates.length);
        } else finish();
      },
    );
  }
  function saveRecord() {
    if (
      [...$("adminContent").querySelectorAll("input[data-time24]")].some(
        (el) =>
          (el.value.trim() || !el.hasAttribute("data-optional")) &&
          !validTime(el.value.trim()),
      )
    )
      return toast("Η ώρα πρέπει να είναι σε 24ωρη μορφή ΩΩ:ΛΛ (π.χ. 19:30).");
    const k = editKind,
      base = editing
        ? clone(data.find((x) => x.id === editing))
        : defaultRecord(k),
      v = (id) => $(id)?.value?.trim() || "",
      notes = v("notes");
    let r = {
      ...base,
      id: editing || uid(),
      kind: k,
      notes,
      pending: $("pendingRecord").checked,
    };
    if (k === "regular") {
      Object.assign(r, {
        title: v("regularTitle"),
        start: v("start"),
        end: v("end"),
        time: v("time"),
        simultaneous: $("simultaneous").checked,
        overrides: r.overrides || {},
        independent: r.independent || [],
        excluded: r.excluded || [],
      });
      if (r.end < r.start)
        return toast("Η τελευταία ημερομηνία προηγείται της πρώτης.");
    } else if (k === "special") {
      syncSessions();
      if (
        !sessionDates.length ||
        sessionDates.some((x) => !x) ||
        sessionTimes.some((x) => !x)
      )
        return toast("Συμπλήρωσε τις ημερομηνίες και τις ώρες.");
      Object.assign(r, {
        title: v("title"),
        template: v("template"),
        grade: v("grade"),
        dates: [...sessionDates],
        times: [...sessionTimes],
        replaces: r.replaces || [],
      });
    } else if (k === "lesson") {
      const cycles = +v("cycles"),
        equal = $("equalCycles").checked;
      if (!Number.isInteger(cycles) || cycles < 1 || cycles > 30)
        return toast("Έλεγξε το πλήθος κύκλων.");
      const sizes = Array.from({ length: cycles }, (_, i) =>
        equal ? +v("perCycle") : +v("cycleSize" + i),
      );
      const count = sizes.reduce((a, b) => a + b, 0);
      const startingNumber = +v("startingNumber");
      if (
        sizes.some((x) => !Number.isInteger(x) || x < 1) ||
        count > 150 ||
        !Number.isInteger(startingNumber) ||
        startingNumber < 1
      )
        return toast("Έλεγξε τους αριθμούς των μαθημάτων.");
      Object.assign(r, {
        title: v("title"),
        start: v("start"),
        time: v("time"),
        count,
        cycles,
        perCycle: sizes[0],
        startingNumber,
        excluded: r.excluded || [],
        overrides: r.overrides || {},
      });
      if (equal) delete r.cycleSizes;
      else r.cycleSizes = sizes;
    } else if (k === "external") {
      Object.assign(r, { title: v("title"), start: v("start"), end: v("end") });
      if (v("time")) r.time = v("time");
      else delete r.time;
      if (r.end < r.start) return toast("Έλεγξε τις ημερομηνίες.");
    } else if (k === "holiday") {
      Object.assign(r, {
        title: v("title"),
        start: v("start"),
        blocks: [
          ...($("editBlockRegular").checked ? ["regular"] : []),
          ...($("editBlockLesson").checked ? ["lesson"] : []),
        ],
      });
      if (
        data.some(
          (other) =>
            other.kind === "holiday" &&
            other.id !== r.id &&
            other.start === r.start,
        )
      )
        return toast("Υπάρχει ήδη αργία σε αυτή την ημερομηνία.");
    } else
      Object.assign(r, {
        title: v("title"),
        start: v("start"),
        time: v("time"),
      });
    if (!r.title || !(r.start || r.dates?.[0]))
      return toast("Συμπλήρωσε τίτλο και ημερομηνία.");
    const finish = () => {
      if (editing) data = data.map((x) => (x.id === editing ? r : x));
      else data.push(r);
      persist();
      editing = null;
      toast("Η καταχώριση ενημερώθηκε. Αποθηκεύστε το πρόχειρο.");
      section = "manage";
      renderAdmin();
    };
    if (k === "special") resolveSpecialConflicts(r, finish);
    else finish();
  }
  function adminSeriesTitle(r) {
    if (r.kind === "special") {
      const months = [
        "Ιανουάριος",
        "Φεβρουάριος",
        "Μάρτιος",
        "Απρίλιος",
        "Μάιος",
        "Ιούνιος",
        "Ιούλιος",
        "Αύγουστος",
        "Σεπτέμβριος",
        "Οκτώβριος",
        "Νοέμβριος",
        "Δεκέμβριος",
      ];
      const groups = new Map();
      for (const d of [...new Set(r.dates || [])].sort()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const key = d.slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(Number(d.slice(8, 10)));
      }
      const multiYear =
        new Set([...groups.keys()].map((k) => k.slice(0, 4))).size > 1;
      const label = [...groups]
        .map(
          ([k, days]) =>
            months[Number(k.slice(5)) - 1] +
            (multiYear ? " " + k.slice(0, 4) : "") +
            " (" +
            days.join(", ") +
            ")",
        )
        .join(" / ");
      return label ? r.title + " — " + label : r.title;
    }
    if (r.kind !== "regular" || !r.start) return r.title;
    const d = new Date(r.start + "T12:00:00Z");
    const days = [
      "Κυριακή",
      "Δευτέρα",
      "Τρίτη",
      "Τετάρτη",
      "Πέμπτη",
      "Παρασκευή",
      "Σάββατο",
    ];
    return Number.isNaN(d.getTime())
      ? r.title
      : r.title + " — " + days[d.getUTCDay()];
  }
  function renderManage() {
    let html = `<div class="spread"><h2>Όλες οι καταχωρίσεις</h2><span class="badgecount">${data.length} εγγραφές / πρότυπα</span></div><div class="inlinehelp">Επεξεργάσου την αρχική καταχώριση ή επίλεξε «Μετακίνηση» για να αλλάξεις ημερομηνίες χωρίς διαγραφή.</div>`;
    html += Object.entries({ ...types, holiday: "Αργίες" })
      .map(([kind, label]) => {
        const items = data
          .filter((r) => r.kind === kind)
          .sort(
            (a, b) =>
              a.title.localeCompare(b.title, "el", {
                sensitivity: "base",
                numeric: true,
              }) ||
              (
                (a.kind === "special"
                  ? [...(a.dates || [])].sort()[0]
                  : a.start) || ""
              ).localeCompare(
                (b.kind === "special"
                  ? [...(b.dates || [])].sort()[0]
                  : b.start) || "",
              ),
          );
        if (!items.length) return "";
        return (
          `<details ${kind === "holiday" ? "" : "open"} style="margin:12px 0"><summary style="calendarCursor():pointer;padding:12px;font-weight:700">${esc(label)} (${items.length})</summary>` +
          items
            .map(
              (r) =>
                `<div class="listrow"><div><strong>${esc(adminSeriesTitle(r))}</strong>${r.pending ? ' <span class="tag">Σε εκκρεμότητα</span>' : ""}<div class="tiny">${esc(types[r.kind])} · ${esc(r.kind === "special" ? (r.dates || []).map(dateGR).join(", ") : dateGR(r.start))} · ${sessions(r).length} γεγονότα</div></div><div class="row"><button class="btn small" data-edit="${esc(r.id)}">Αλλαγή</button><button class="btn small" data-move="${esc(r.id)}">Μετακίνηση</button><button class="btn small danger" data-delete="${esc(r.id)}">Διαγραφή</button></div></div>`,
            )
            .join("") +
          "</details>"
        );
      })
      .join("");
    $("adminContent").innerHTML = html;
    $("adminContent").onclick = (e) => {
      const b = e.target.closest(
        "button[data-edit],button[data-move],button[data-delete]",
      );
      if (!b) return;
      const id = b.dataset.edit || b.dataset.move || b.dataset.delete;
      if (b.dataset.edit) {
        editing = id;
        editKind = data.find((x) => x.id === id).kind;
        section = "new";
        renderAdmin();
      }
      if (b.dataset.move) openMove(id);
      if (b.dataset.delete) deleteRecord(id);
    };
  }
  function renderExceptions() {
    const candidates = data.filter(
      (r) => r.kind === "regular" || r.kind === "lesson",
    );
    $("adminContent").innerHTML =
      `<h2>Μετακινήσεις και εξαιρέσεις</h2><div class="inlinehelp">Η μετακίνηση κρατά την ίδια διοργάνωση. Στα μαθήματα, η ακύρωση μεταθέτει τα επόμενα μαθήματα. Στους τακτικούς αγώνες, η εξαίρεση αναπροσαρμόζει την αρίθμηση.</div><h3>Μετακίνηση ολόκληρης διοργάνωσης</h3>${data.map((r) => `<div class="listrow"><div><strong>${esc(adminSeriesTitle(r))}</strong>${r.pending ? ' <span class="tag">Σε εκκρεμότητα</span>' : ""}<div class="tiny">${esc(types[r.kind])}</div></div><button class="btn small" data-move="${esc(r.id)}">Μετακίνηση</button></div>`).join("")}<hr class="divider"><h3>Αλλαγή μίας ημερίδας ή μαθήματος</h3><label>Επιλογή σειράς<select id="exceptionSeries">${candidates.map((r) => `<option value="${r.id}">${esc(adminSeriesTitle(r))} · ${esc(dateGR(r.start))}</option>`).join("")}</select></label><div class="formgrid" style="margin-top:12px">${input("exceptionDate", "Ημερομηνία", "date", candidates[0]?.start || "2027-01-04")}<label>Ενέργεια<select id="exceptionAction"><option value="time">Αλλαγή ώρας</option><option value="exclude">Ακύρωση / παράλειψη</option><option value="independent">Ανεξάρτητη ημερίδα (μόνο αγώνες)</option><option value="restore">Επαναφορά ημερίδας</option></select></label>${input("exceptionTime", "Νέα ώρα", "time", "19:30")}</div><div class="row" style="margin-top:14px"><button class="btn primary" id="applyException">Εφαρμογή</button></div><div class="inlinehelp">Για μετακίνηση μίας ημερίδας, ανοίξτε τις λεπτομέρειές της από την προβολή πρόχειρου.</div>`;
    $("adminContent").onclick = (e) => {
      const b = e.target.closest("[data-move]");
      if (b) openMove(b.dataset.move);
    };
    $("exceptionSeries").onchange = () => {
      $("exceptionDate").value =
        data.find((r) => r.id === $("exceptionSeries").value)?.start || "";
    };
    $("applyException").onclick = () => {
      const r = data.find((x) => x.id === $("exceptionSeries").value),
        d = $("exceptionDate").value,
        action = $("exceptionAction").value;
      if (!r || !d) return;
      if (action === "independent" && r.kind !== "regular")
        return toast("Η ανεξάρτητη ημερίδα ισχύει μόνο για αγώνες.");
      r.excluded = r.excluded || [];
      r.independent = r.independent || [];
      r.overrides = r.overrides || {};
      if (action === "time" && !validTime($("exceptionTime").value))
        return toast("Χρησιμοποίησε ώρα ΩΩ:ΛΛ (24ωρο).");
      if (action === "time")
        r.overrides[d] = {
          ...(r.overrides[d] || {}),
          time: $("exceptionTime").value,
        };
      if (action === "exclude" && !r.excluded.includes(d)) r.excluded.push(d);
      if (action === "independent" && !r.independent.includes(d))
        r.independent.push(d);
      if (action === "restore") {
        r.excluded = r.excluded.filter((x) => x !== regularSlot(r, d));
        removeReplacementLinks(r.id, d);
        r.independent = r.independent.filter((x) => x !== d);
        delete r.overrides[d];
      }
      persist();
      toast("Η παρέμβαση εφαρμόστηκε στο πρόχειρο.");
      renderAdmin();
    };
  }
  function holidayRange(records, start, end, title, blocks) {
    const out = records.slice(),
      existing = new Set(
        records.filter((r) => r.kind === "holiday").map((r) => r.start),
      );
    let added = 0,
      skipped = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (existing.has(d)) {
        skipped++;
        continue;
      }
      out.push({
        id: uid(),
        kind: "holiday",
        title,
        start: d,
        blocks: [...blocks],
      });
      existing.add(d);
      added++;
    }
    return { records: out, added, skipped };
  }
  function renderHolidays() {
    const host = $("adminContent");
    delete host.dataset.autoHolidayDate;
    delete host.dataset.autoHolidayTitle;
    host.onclick = null;
    host.innerHTML = `<h2>Αργίες και κλείσιμο Ομίλου</h2><p class="muted">Οι επιλογές ισχύουν για όλες τις ημέρες από την έναρξη έως τη λήξη (συμπεριλαμβάνονται και οι δύο). Κάθε ημέρα αποθηκεύεται χωριστά. Οι ήδη καταχωρισμένες ημέρες διατηρούνται. Τα μαθήματα αναπληρώνονται. Οι έκτακτες και εξωτερικές διοργανώσεις δεν ακυρώνονται αυτόματα.</p><div class="formgrid">${input("holidayTitle", "Ονομασία", "text", "")}${input("holidayDate", "Από", "date", calendarCursor())}${input("holidayEnd", "Έως", "date", calendarCursor())}</div><label class="check"><input id="blockReg" type="checkbox" checked> Δεν γίνονται τακτικοί αγώνες</label><label class="check"><input id="blockLesson" type="checkbox" checked> Δεν γίνονται μαθήματα</label><button class="btn primary" id="saveHoliday">Αποθήκευση αργιών</button><hr><h3>Αυτόματες αργίες</h3>${input("autoYear", "Έτος", "number", calendarCursor().slice(0, 4))}<div id="autoHolidayList"></div><hr><h3>Καταχωρισμένες αργίες / κλεισίματα</h3>${data
      .filter((r) => r.kind === "holiday")
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(
        (r) =>
          `<div class="listrow"><div>${esc(r.title)} · ${esc(dateGR(r.start))}<div class="tiny">${esc(r.blocks?.map((k) => (k === "regular" ? "Τακτικές" : "Μαθήματα")).join(", ") || "Μόνο ένδειξη")}</div></div><button class="btn" data-holiday-delete="${esc(r.id)}">Αφαίρεση</button></div>`,
      )
      .join("")}`;
    const drawAuto = () => {
      const y = +$("autoYear").value;
      if (!Number.isInteger(y) || y < 1900 || y > 2199) return;
      $("autoHolidayList").innerHTML = greekHolidays(y)
        .map(
          (h) =>
            `<div class="listrow"><div>${esc(h.title)} · ${esc(dateGR(h.start))}<div class="tiny">${data.some((r) => r.kind === "holiday" && r.start === h.start && r.title === h.title) ? "Έχει καταχωριστεί ρύθμιση" : "Μόνο ένδειξη"}</div></div><button class="btn small" data-auto-date="${h.start}" data-auto-title="${esc(h.title)}">Ρύθμιση</button></div>`,
        )
        .join("");
    };
    $("autoYear").onchange = drawAuto;
    drawAuto();
    $("holidayDate").onchange = () => {
      if (
        !$("holidayEnd").value ||
        $("holidayEnd").value < $("holidayDate").value
      )
        $("holidayEnd").value = $("holidayDate").value;
    };
    $("saveHoliday").onclick = () => {
      const d = $("holidayDate").value,
        end = $("holidayEnd").value,
        t = $("holidayTitle").value.trim();
      if (!d || !end || !t)
        return toast("Συμπλήρωσε ονομασία και ημερομηνίες.");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
        d < "1900-01-01" ||
        end > "2199-12-31"
      )
        return toast("Μη έγκυρες ημερομηνίες.");
      if (end < d)
        return toast("Η λήξη πρέπει να είναι από την έναρξη και μετά.");
      const blocks = [
        ...($("blockReg").checked ? ["regular"] : []),
        ...($("blockLesson").checked ? ["lesson"] : []),
      ];
      const save = () => {
        if (
          d === end &&
          host.dataset.autoHolidayDate === d &&
          host.dataset.autoHolidayTitle === t
        ) {
          const h = data.find(
            (r) => r.kind === "holiday" && r.start === d && r.title === t,
          );
          if (h) {
            h.blocks = blocks;
            persist();
            render();
            toast("Η ρύθμιση ενημερώθηκε.");
            return;
          }
        }
        const result = holidayRange(data, d, end, t, blocks);
        data = result.records;
        persist();
        render();
        toast(
          "Νέες αργίες: " +
            result.added +
            " · Υπάρχουσες ημέρες: " +
            result.skipped,
        );
      };
      if (d < todayISO())
        decisionDialog(
          "Αναδρομική αλλαγή",
          [
            {
              label: "Μπορεί να αλλάξει την αρίθμηση παλαιότερων γεγονότων.",
              options: ["Όχι", "Συνέχεια"],
            },
          ],
          ([v]) => {
            if (v === 1) save();
          },
        );
      else save();
    };
    host.onclick = (e) => {
      const a = e.target.closest("[data-auto-date]");
      if (a) {
        host.dataset.autoHolidayDate = a.dataset.autoDate;
        host.dataset.autoHolidayTitle = a.dataset.autoTitle;
        $("holidayDate").value = a.dataset.autoDate;
        $("holidayEnd").value = a.dataset.autoDate;
        $("holidayTitle").value = a.dataset.autoTitle;
        const h = data.find(
          (r) =>
            r.kind === "holiday" &&
            r.start === a.dataset.autoDate &&
            r.title === a.dataset.autoTitle,
        );
        $("blockReg").checked = h ? !!h.blocks?.includes("regular") : true;
        $("blockLesson").checked = h ? !!h.blocks?.includes("lesson") : true;
        $("holidayTitle").scrollIntoView({ block: "center" });
        return;
      }
      const b = e.target.closest("[data-holiday-delete]");
      if (b)
        decisionDialog(
          "Αφαίρεση αργίας",
          [
            {
              label:
                "Οι δραστηριότητες που αποκλείστηκαν από αυτή την αργία θα επανυπολογιστούν.",
              options: ["Όχι", "Αφαίρεση"],
            },
          ],
          ([v]) => {
            if (v === 1) {
              data = data.filter((r) => r.id !== b.dataset.holidayDelete);
              persist();
              render();
            }
          },
        );
    };
  }
  function clearYearPlan(y) {
    const lo = y + "-01-01",
      hi = y + "-12-31",
      inside = (d) => d >= lo && d <= hi;
    const remove = [],
      keep = [];
    for (const r of data) {
      let dates =
        r.kind === "special"
          ? r.dates || []
          : r.kind === "lesson"
            ? [r.start, ...sessions(r).map((e) => e.date)]
            : [r.start, r.end || r.start];
      dates = dates.filter(Boolean).sort();
      if (!dates.length) continue;
      const touches =
        r.kind === "special"
          ? dates.some(inside)
          : dates[0] <= hi && dates[dates.length - 1] >= lo;
      if (!touches) continue;
      if (dates.every(inside)) remove.push(r);
      else keep.push(r);
    }
    return { remove, keep };
  }
  function renderClearYear() {
    const host = $("adminContent");
    host.onclick = null;
    host.innerHTML = `<h2>Εκκαθάριση έτους</h2><p>Αφαιρεί τις καταχωρίσεις που ανήκουν εξ ολοκλήρου στο επιλεγμένο έτος. Οι αυτόματες αργίες παραμένουν. Σειρές και μαθήματα που εκτείνονται σε άλλα έτη διατηρούνται, για να μη χαθεί η συνέχειά τους.</p>${input("clearYearValue", "Έτος προς εκκαθάριση", "number", calendarCursor().slice(0, 4), 'min="2000" max="2099"')}<button class="btn primary" id="clearPreviewBtn">Προεπισκόπηση εκκαθάρισης</button><div id="clearPreview"></div>`;
    $("clearPreviewBtn").onclick = () => {
      const y = Number($("clearYearValue").value);
      if (!Number.isInteger(y) || y < 2000 || y > 2099)
        return toast("Μη έγκυρο έτος.");
      const plan = clearYearPlan(y);
      const panel = $("clearPreview");
      panel.innerHTML = `<div class="clear-warning"><strong>${y}: ${plan.remove.length} καταχωρίσεις προς διαγραφή</strong><div class="clear-list">${plan.remove.map((r) => `<div>${esc(r.title)} · ${esc(types[r.kind] || r.kind)}</div>`).join("") || "Δεν υπάρχουν καταχωρίσεις προς διαγραφή."}</div>${plan.keep.length ? `<p><strong>Διατηρούνται ${plan.keep.length} καταχωρίσεις που εκτείνονται σε άλλα έτη:</strong></p><div class="clear-list">${plan.keep.map((r) => `<div>${esc(r.title)}</div>`).join("")}</div>` : ""}<p>Πριν την εκκαθάριση μπορείς να αποθηκεύσεις αντίγραφο όλων των δεδομένων.</p><button class="btn" id="clearBackup">Λήψη αντιγράφου JSON</button><label class="check"><input type="checkbox" id="clearAgree"> Επιβεβαιώνω τη διαγραφή των παραπάνω καταχωρίσεων του ${y}.</label><button class="btn clear-danger" id="clearExecute" disabled>Εκκαθάριση ${y}</button></div>`;
      $("clearBackup").onclick = () => $("export").click();
      $("clearAgree").onchange = () => {
        $("clearExecute").disabled =
          !$("clearAgree").checked || !plan.remove.length;
      };
      $("clearExecute").onclick = () => {
        if (!$("clearAgree").checked || Number($("clearYearValue").value) !== y)
          return toast("Κάνε νέα προεπισκόπηση.");
        const ids = new Set(plan.remove.map((r) => r.id));
        data = data.filter((r) => !ids.has(r.id));
        for (const r of data) {
          if (r.kind !== "special") continue;
          for (const field of ["replaces", "keepsCancelled"]) {
            if (r[field]) r[field] = r[field].filter((z) => !ids.has(z.id));
          }
        }
        persist();
        render();
        toast("Η εκκαθάριση του " + y + " ολοκληρώθηκε.");
      };
    };
    $("clearYearValue").oninput = () => {
      $("clearPreview").innerHTML = "";
    };
  }
  function renderRollover() {
    const host = $("adminContent");
    host.onclick = null;
    host.innerHTML = `<h2>Προετοιμασία επόμενου έτους</h2><p>Οι τακτικές σειρές αντιγράφονται στην ίδια ημέρα εβδομάδας. Τα μαθήματα συνεχίζονται αυτόματα και δεν αντιγράφονται. Οι βασικές αργίες υπολογίζονται αυτόματα. Οι έκτακτες μεταφέρονται στην κοντινότερη αντίστοιχη ημέρα εβδομάδας.</p>${input("sourceYear", "Έτος προέλευσης", "number", calendarCursor().slice(0, 4))}<label class="check"><input type="checkbox" id="copySpecial"> Αντιγραφή έκτακτων και άλλων εκδηλώσεων (ενδεικτικές ημερομηνίες, προς έλεγχο)</label><button class="btn primary" id="roll">Προετοιμασία</button><div id="rollPreview"></div>`;
    $("roll").onclick = () => {
      const y = +$("sourceYear").value;
      if (!Number.isInteger(y) || y < 2000 || y > 2098)
        return toast("Μη έγκυρο έτος.");
      const target = y + 1,
        shift = (d) => {
          const a = new Date(d + "T12:00:00Z");
          a.setUTCFullYear(target);
          return a.toISOString().slice(0, 10);
        },
        copies = [];
      for (const r of data) {
        const first = r.kind === "special" ? r.dates[0] : r.start;
        if (
          !first?.startsWith(String(y)) ||
          data.some((x) => x.copiedFrom === r.id && x.copyYear === target)
        )
          continue;
        if (r.kind === "regular") {
          let start = target + "-01-01",
            end = target + "-12-31";
          while (weekday(start) !== weekday(r.start)) start = addDays(start, 1);
          while (weekday(end) !== weekday(r.start)) end = addDays(end, -1);
          if (
            data.some(
              (x) =>
                x.kind === "regular" &&
                x.title === r.title &&
                weekday(x.start) === weekday(start) &&
                x.start <= end &&
                x.end >= start,
            )
          )
            continue;
          copies.push({
            ...clone(r),
            id: uid(),
            start,
            end,
            excluded: [],
            independent: [],
            overrides: {},
            copiedFrom: r.id,
            copyYear: target,
          });
        } else if (
          $("copySpecial").checked &&
          ["special", "other"].includes(r.kind)
        ) {
          const n = {
            ...clone(r),
            id: uid(),
            copiedFrom: r.id,
            copyYear: target,
            notes: (r.notes || "") + " · Προς επιβεβαίωση ημερομηνιών",
          };
          if (r.kind === "special") {
            const anchor = nearestWeekday(r.dates[0]);
            const offset = Math.round(
              (Date.parse(anchor) - Date.parse(r.dates[0])) / 86400000,
            );
            n.dates = r.dates.map((d) => addDays(d, offset));
            n.replaces = [];
            n.keepsCancelled = [];
          } else n.start = nearestWeekday(r.start);
          copies.push(n);
        }
      }
      $("rollPreview").innerHTML =
        `<p>${copies.length} νέες καταχωρίσεις για ${target}. Οι έκτακτες χρειάζονται έλεγχο συγκρούσεων και ημερομηνιών.</p>${copies.map((r) => `<div>${esc(r.title)} · ${esc(r.start ? dateGR(r.start) : r.dates.map(dateGR).join(", "))}</div>`).join("")}<button class="btn primary" id="rollSave" ${copies.length ? "" : "disabled"}>Επιβεβαίωση αντιγραφής</button>`;
      $("rollSave").onclick = () => {
        data.push(...copies);
        persist();
        render();
        toast("Το επόμενο έτος προετοιμάστηκε.");
      };
    };
  }
  function renderRules() {
    $("adminContent").innerHTML =
      `<h2>Κανόνες προγραμματισμού</h2><div class="stack"><div class="inlinehelp"><strong>Τακτικοί αγώνες</strong><div>Εβδομαδιαία επανάληψη, αρίθμηση 6ήμερων, μετατροπή τελευταίων σε 5ήμερα, εξαιρέσεις, ανεξάρτητες ημερίδες και μεταβολές ώρας.</div></div><div class="inlinehelp"><strong>Έκτακτες διοργανώσεις</strong><div>Πρότυπα ζευγών / ομάδων, βαθμίδα, διαφορετικές ώρες, μη συνεχόμενες ημερομηνίες, μετακίνηση ολόκληρου πολυημέρου.</div></div><div class="inlinehelp"><strong>Μαθήματα</strong><div>Κύκλοι, συνέχεια αρίθμησης, παράλειψη ακυρωμένων μαθημάτων και μεταφορά στο επόμενο διαθέσιμο εβδομαδιαίο μάθημα.</div></div><div class="inlinehelp"><strong>ΕΟΜ & άλλοι όμιλοι</strong><div>Εμφάνιση χωρίς ώρα και χωρίς αυτόματη επίδραση στο πρόγραμμα του ΟΜΗ.</div></div></div>`;
  }
  function openMove(id) {
    const r = data.find((x) => x.id === id);
    if (!r) return;
    const first = r.kind === "special" ? r.dates[0] : r.start;
    const html = `<div class="modalback" id="modalBack"><div class="modal"><div class="spread"><h2>Μετακίνηση διοργάνωσης</h2><button class="btn small" id="closeModal">✕</button></div><p><strong>${esc(adminSeriesTitle(r))}</strong>${r.pending ? ' <span class="tag">Σε εκκρεμότητα</span>' : ""}</p><p class="muted">Η μετακίνηση διατηρεί την καταχώριση και τις επιμέρους ώρες. Σε πολυήμερο, μεταφέρονται όλες οι ημερίδες κατά την ίδια διαφορά ημερών.</p><div class="formgrid">${input("moveFrom", "Αρχική ημερομηνία", "date", first, "disabled")}${input("moveTo", "Νέα ημερομηνία", "date", first)}</div><div class="row" style="margin-top:18px"><button class="btn primary" id="confirmMove">Μετακίνηση</button><button class="btn" id="cancelMove">Άκυρο</button></div></div></div>`;
    $("modalHost").innerHTML = html;
    const close = () => ($("modalHost").innerHTML = "");
    $("closeModal").onclick = close;
    $("cancelMove").onclick = close;
    $("modalBack").onclick = (e) => {
      if (e.target.id === "modalBack") close();
    };
    $("confirmMove").onclick = () => {
      const to = $("moveTo").value;
      if (!to) return;
      const diff = Math.round(
        (new Date(to + "T12:00:00Z") - new Date(first + "T12:00:00Z")) /
          86400000,
      );
      if (r.kind === "special") {
        const next = clone(r);
        next.dates = next.dates.map((d) => addDays(d, diff));
        resolveSpecialConflicts(next, () => {
          data = data.map((x) => (x.id === id ? next : x));
          persist();
          close();
          render();
          toast("Η διοργάνωση μετακινήθηκε.");
        });
        return;
      } else {
        const links = data
          .filter((record) => record.kind === "special")
          .flatMap((record) => [
            ...(record.replaces || []),
            ...(record.keepsCancelled || []),
          ])
          .filter((link) => link.id === r.id);
        const linkedDates = new Set(
          links.map((link) => regularSlot(r, link.date)),
        );
        r.start = addDays(r.start, diff);
        if (r.end) r.end = addDays(r.end, diff);
        if (r.excluded)
          r.excluded = r.excluded
            .filter((day) => !linkedDates.has(day))
            .map((day) => addDays(day, diff));
        if (r.independent)
          r.independent = r.independent.map((d) => addDays(d, diff));
        if (r.overrides)
          r.overrides = Object.fromEntries(
            Object.entries(r.overrides).map(([d, v]) => [
              addDays(d, diff),
              v.date ? { ...v, date: addDays(v.date, diff) } : v,
            ]),
          );
        if (links.length) {
          const dates = new Set(sessions(r).map((event) => event.date));
          r.excluded = [
            ...new Set([
              ...(r.excluded || []),
              ...links
                .filter((link) => dates.has(link.date))
                .map((link) => regularSlot(r, link.date)),
            ]),
          ];
        }
      }
      persist();
      close();
      render();
      toast("Η διοργάνωση μετακινήθηκε χωρίς διαγραφή.");
    };
  }
  function moveOccurrence(record, event) {
    const host = $("modalHost");
    host.onclick = null;
    host.innerHTML = `<div class="modalback"><div class="modal" role="dialog" aria-modal="true">
 <h2>Μετακίνηση ημερίδας</h2>${input("occurrenceDate", "Νέα ημερομηνία", "date", event.date)}
 <div class="row"><button class="btn primary" id="moveOccurrence">Μετακίνηση</button>
 <button class="btn" id="closeOccurrence">Άκυρο</button></div></div></div>`;
    $("closeOccurrence").onclick = () => host.replaceChildren();
    $("moveOccurrence").onclick = () => {
      const day = $("occurrenceDate").value;
      if (!day || day === event.date) return;
      const next = clone(record);
      const save = () => {
        data = data.map((r) => (r.id === next.id ? next : r));
        persist();
        host.replaceChildren();
        renderPublic();
      };
      if (record.kind === "special") {
        next.dates[event.number - 1] = day;
        return resolveSpecialConflicts(next, save);
      }
      if (sessions(record).some((e) => e.date === day))
        return toast(
          "Υπάρχει ήδη ημερίδα της ίδιας σειράς στη νέα ημερομηνία.",
        );
      next.overrides ??= {};
      next.overrides[event.sessionDate] = {
        ...next.overrides[event.sessionDate],
        date: day,
      };
      const overlaps = allEvents().filter((e) => e.date === day);
      if (overlaps.length)
        return decisionDialog(
          "Επικαλύψεις στη νέα ημερομηνία",
          [
            {
              label: overlaps
                .map((e) => e.title + (e.time ? " · " + e.time : ""))
                .join(", "),
              options: ["Συνύπαρξη", "Άκυρο"],
            },
          ],
          ([choice]) => {
            if (choice === 0) save();
          },
        );
      save();
    };
  }
  function showEvent(id, date, number) {
    const r = adminPreview
        ? data.find((x) => x.id === id) ||
          automaticHolidays(+date.slice(0, 4)).find((x) => x.id === id)
        : null,
      all = adminPreview
        ? r && sessions(r)
        : publicEvents.filter((x) => x.id === id),
      e =
        all &&
        all.find((x) => x.date === date && (!number || x.number === +number));
    if (!e) return;
    const actions =
      adminPreview && !r.automatic
        ? `<div class="quick-actions"><button class="btn primary" id="quickEdit">Επεξεργασία καταχώρισης</button><button class="btn" id="quickMove">Μετακίνηση διοργάνωσης</button>${["regular", "special"].includes(r.kind) ? '<button class="btn" id="quickMoveOne">Μετακίνηση ημερίδας</button>' : ""}${r.kind === "regular" || r.kind === "lesson" || r.kind === "special" ? '<button class="btn" id="quickTime">Αλλαγή ώρας γεγονότος</button>' : ""}${r.kind === "regular" || r.kind === "lesson" ? '<button class="btn danger" id="quickCancel">Ακύρωση γεγονότος</button>' : ""}<button class="btn danger" id="quickDelete">Διαγραφή</button></div>`
        : "";
    const close = displayEvent(e, actions);
    if (!adminPreview || r.automatic) return;
    if ($("quickDelete"))
      $("quickDelete").onclick = () => deleteRecord(id, date, e.number);
    $("quickEdit").onclick = () => {
      close();
      editing = id;
      editKind = r.kind;
      section = "new";
      showTab("admin");
    };
    $("quickMove").onclick = () => {
      close();
      openMove(id);
    };
    if ($("quickMoveOne"))
      $("quickMoveOne").onclick = () => moveOccurrence(r, e);
    if ($("quickTime"))
      $("quickTime").onclick = () => {
        const value = prompt("Νέα ώρα έναρξης (ΩΩ:ΛΛ)", e.time || "19:30");
        if (value === null) return;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
          toast("Η ώρα πρέπει να έχει μορφή ΩΩ:ΛΛ.");
          return;
        }
        if (r.kind === "special") {
          const index = e.number - 1;
          if (index < 0) return;
          r.times[index] = value;
        } else {
          r.overrides = r.overrides || {};
          r.overrides[e.sessionDate] = {
            ...(r.overrides[e.sessionDate] || {}),
            time: value,
          };
        }
        persist();
        close();
        renderPublic();
        toast("Η ώρα του γεγονότος ενημερώθηκε.");
      };
    if ($("quickCancel"))
      $("quickCancel").onclick = () => {
        decisionDialog(
          "Ακύρωση γεγονότος",
          [
            {
              label:
                r.title +
                " — " +
                dateGR(date) +
                (date < todayISO()
                  ? " · Αναδρομική αλλαγή: μπορεί να επηρεάσει την αρίθμηση."
                  : ""),
              options: [
                "Ακύρωση μόνο αυτής της ημερίδας",
                "Διατήρηση γεγονότος",
              ],
            },
          ],
          ([v]) => {
            if (v !== 0) return;
            r.excluded = r.excluded || [];
            if (!r.excluded.includes(e.sessionDate))
              r.excluded.push(e.sessionDate);
            persist();
            renderPublic();
            toast("Το γεγονός ακυρώθηκε.");
          },
        );
      };
  }

  function removeReplacementLinks(id, date) {
    const otherLink = (z) => z.id !== id || z.date !== date;
    for (const record of data) {
      if (record.kind !== "special") continue;
      if (record.replaces) record.replaces = record.replaces.filter(otherLink);
      if (record.keepsCancelled)
        record.keepsCancelled = record.keepsCancelled.filter(otherLink);
    }
  }
  function cancelledRegular(date) {
    return data.filter(
      (r) =>
        r.kind === "regular" &&
        r.excluded?.includes(regularSlot(r, date)) &&
        regularSlot(r, date) >= r.start &&
        regularSlot(r, date) <= r.end &&
        weekday(regularSlot(r, date)) === weekday(r.start),
    );
  }
  function restoreButtons(date) {
    return adminPreview
      ? cancelledRegular(date)
          .map(
            (r) =>
              `<button class="btn" data-restore="${esc(r.id)}" data-date="${date}">Επαναφορά: ${esc(r.title)}</button>`,
          )
          .join("")
      : "";
  }
  function showDay(date) {
    const list = filtered().filter((e) => e.date === date);
    displayDay(date, list, restoreButtons(date));
    $("modalHost").onclick = (e) => {
      const restore = e.target.closest("[data-restore]");
      if (restore) {
        const r = data.find((x) => x.id === restore.dataset.restore),
          d = restore.dataset.date;
        if (!r || !adminPreview) return;
        const owners = data.filter(
          (x) =>
            x.kind === "special" &&
            [...(x.replaces || []), ...(x.keepsCancelled || [])].some(
              (z) => z.id === r.id && z.date === d,
            ),
        );
        decisionDialog(
          "Επαναφορά τακτικής ημερίδας",
          [
            {
              label:
                r.title +
                " — " +
                dateGR(d) +
                (owners.length ? " · Συμπίπτει με έκτακτη διοργάνωση" : ""),
              options: ["Επαναφορά ημερίδας", "Διατήρηση ακύρωσης"],
            },
          ],
          ([v]) => {
            if (v === 0) {
              r.excluded = r.excluded.filter((x) => x !== regularSlot(r, d));
              removeReplacementLinks(r.id, d);
              persist();
              renderPublic();
              toast("Η ημερίδα επανήλθε.");
            }
          },
        );
        return;
      }
      const b = e.target.closest("[data-show]");
      if (b) showEvent(b.dataset.show, b.dataset.date, b.dataset.number);
      else if (e.target.id === "modalBack") $("modalHost").innerHTML = "";
    };
  }
  function formatDateInputs() {
    for (const el of document.querySelectorAll("input[data-date-picker]")) {
      if (el.dataset.formatted) continue;
      const native = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      let iso = native.get.call(el);
      Object.defineProperty(el, "value", {
        configurable: true,
        get() {
          return iso;
        },
        set(v) {
          iso = String(v ?? "");
          native.set.call(el, dateGR(iso));
        },
      });
      el.dataset.formatted = "1";
      el.value = iso;
    }
  }
  const dateObserver = new MutationObserver(formatDateInputs);
  dateObserver.observe(document.body, { childList: true, subtree: true });
  function openDatePicker(el) {
    let value = el.value || todayISO(),
      y = +value.slice(0, 4),
      m = +value.slice(5, 7);
    const back = document.createElement("div"),
      panel = document.createElement("div");
    back.className = "dpback";
    panel.className = "datepick";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Επιλογή ημερομηνίας");
    document.body.append(back, panel);
    const close = () => {
      back.remove();
      panel.remove();
    };
    back.onclick = close;
    function draw() {
      const first = `${y}-${String(m).padStart(2, "0")}-01`,
        offset = (weekday(first) + 6) % 7;
      panel.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><button class="btn small" data-step="-1">‹</button><strong>${fmt(first, { month: "long", year: "numeric" })}</strong><button class="btn small" data-step="1">›</button></div><div class="dpgrid">${["Δε", "Τρ", "Τε", "Πε", "Πα", "Σα", "Κυ"].map((t) => `<small>${t}</small>`).join("")}${"<span></span>".repeat(offset)}${Array.from(
        { length: monthLast(y, m) },
        (_, i) => {
          const d = addDays(first, i);
          return `<button data-date="${d}" class="${d === value ? "selected" : ""}">${i + 1}</button>`;
        },
      ).join(
        "",
      )}</div><div class="row" style="margin-top:10px"><button class="btn small" data-now>Σήμερα</button><button class="btn small" data-close>Κλείσιμο</button></div>`;
    }
    panel.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-close")) return close();
      if (b.hasAttribute("data-now")) {
        const t = todayISO();
        y = +t.slice(0, 4);
        m = +t.slice(5, 7);
        return draw();
      }
      if (b.dataset.step) {
        m += +b.dataset.step;
        if (m === 0) {
          m = 12;
          y--;
        }
        if (m === 13) {
          m = 1;
          y++;
        }
        return draw();
      }
      if (b.dataset.date) {
        el.value = b.dataset.date;
        close();
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    draw();
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("input[data-date-picker]");
    if (el && !el.disabled) {
      e.preventDefault();
      openDatePicker(el);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelector(".dpback")?.click();
    }
    if (
      (e.key === "Enter" || e.key === " ") &&
      e.target.matches("input[data-date-picker]")
    ) {
      e.preventDefault();
      openDatePicker(e.target);
    }
  });
  formatDateInputs();
  const storageStatus = () => $("storageStatus");
  let state,
    db,
    preservedRevision = 0,
    writeQueue = Promise.resolve(),
    unsaved = false;
  let writeNumber = 0,
    previewDraft,
    checking = false,
    lastChecked = false;
  const root =
    location.protocol === "file:"
      ? PAGES_ROOT
      : new URL("./", location.href).href;

  function invalidatePreview() {
    previewDraft = undefined;
    $("publish").disabled = true;
    if (active === "public" && !adminPreview) {
      publicEvents = [];
      showTab("admin");
    }
  }
  function persist() {
    invalidatePreview();
    state.records = data;
    persistState();
  }
  function persistState() {
    const value = structuredClone(state);
    const write = ++writeNumber;
    unsaved = true;
    storageStatus().textContent = "Το πρόχειρο αποθηκεύεται στη συσκευή…";
    writeQueue = writeQueue.then(async () => {
      try {
        if (!db)
          throw Error(
            "Η τοπική αποθήκευση δεν είναι διαθέσιμη σε αυτόν τον browser.",
          );
        preservedRevision = await storeState(db, value, preservedRevision);
        if (write === writeNumber) {
          unsaved = false;
          storageStatus().textContent = "Το πρόχειρο αποθηκεύτηκε στη συσκευή.";
        }
        return true;
      } catch (error) {
        if (write === writeNumber)
          storageStatus().textContent =
            (error?.message || "Αποτυχία τοπικής αποθήκευσης.") +
            " Εξαγάγετε ιδιωτικό αντίγραφο.";
        return false;
      }
    });
    return writeQueue;
  }
  function privateImport(file) {
    return file.text().then((source) => {
      if (file.size > MAX_PRIVATE_BYTES)
        throw Error("Το ιδιωτικό αντίγραφο υπερβαίνει τα 30 MB.");
      const backup = readBackup(JSON.parse(source));
      if (
        !confirm("Η εισαγωγή θα αντικαταστήσει το τοπικό πρόχειρο. Συνέχεια;")
      )
        return;
      // An older backup can replace a draft, while the current public version is still the baseline.
      const confirmed = lastChecked ? state.confirmed : backup.confirmed;
      const versions = [...backup.versions];
      if (lastChecked) {
        for (const entry of state.versions) {
          if (
            !versions.some(
              (version) =>
                version.document.publicationId === entry.document.publicationId,
            )
          )
            versions.push(entry);
        }
      }
      state = { ...backup, confirmed, versions };
      data = state.records;
      $("cutoff").value = state.cutoff;
      editing = null;
      section = "manage";
      persist();
      showTab("admin");
      renderConfirmed();
    });
  }
  function download(documentValue, name) {
    const blob = new Blob([JSON.stringify(documentValue, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderConfirmed() {
    let message = publicationLabel(state.confirmed);
    if (!lastChecked) message += " · Χωρίς νέο έλεγχο GitHub Pages.";
    try {
      confirmedVersion(state);
    } catch {
      message +=
        " Η ιδιωτική βάση αυτής της έκδοσης λείπει από τη συσκευή. Εισαγάγετε το αντίστοιχο ιδιωτικό αντίγραφο πριν εξαγάγετε νέο πρόγραμμα.";
    }
    $("publicationStatus").textContent = message;
  }
  async function refreshAdmin({ manual = false } = {}) {
    if (checking) return;
    checking = true;
    try {
      const confirmed = await loadPublished(root);
      const changed = !sameSnapshot(state.confirmed, confirmed);
      lastChecked = true;
      if (
        state.confirmed.publishedAt &&
        (!confirmed.publishedAt ||
          confirmed.publishedAt < state.confirmed.publishedAt)
      ) {
        throw Error("Το Pages επέστρεψε παλαιότερο στιγμιότυπο.");
      }
      if (changed || state.confirmed.publishedAt !== confirmed.publishedAt) {
        state.confirmed = confirmed;
        if (changed) {
          invalidatePreview();
          if (
            state.versions.some((entry) =>
              sameSnapshot(entry.document, confirmed),
            )
          )
            $("productionStatus").textContent =
              "Η έκδοση εμφανίζεται στο GitHub Pages.";
          else
            $("productionStatus").textContent =
              "Το GitHub Pages εμφανίζει διαφορετική έκδοση.";
        }
        await persistState();
      }
      renderConfirmed();
      if (manual)
        toast(
          changed
            ? "Το GitHub Pages επιβεβαίωσε διαφορετική δημόσια έκδοση."
            : "Ο έλεγχος GitHub Pages ολοκληρώθηκε.",
        );
    } catch {
      lastChecked = false;
      renderConfirmed();
      if (manual)
        toast(
          "Ο έλεγχος GitHub Pages απέτυχε. Ελέγξτε τη σύνδεση ή δοκιμάστε αργότερα.",
        );
    } finally {
      checking = false;
    }
  }
  function displayPreview(entry, pastChanges = 0) {
    previewDraft = entry;
    publicEvents = entry.document.events;
    adminPreview = false;
    $("modalHost").replaceChildren();
    $("publish").disabled = false;
    $("productionStatus").textContent =
      "Προεπισκόπηση έως " +
      entry.document.cutoff +
      " · " +
      publicEvents.length +
      " ημερίδες. " +
      (pastChanges
        ? "Αναδρομικές διαφορές σε " +
          pastChanges +
          " ημερίδες. " +
          ($("retroactive").checked
            ? "Η προεπισκόπηση περιλαμβάνει τις διορθώσεις."
            : "Διατηρείται το δημοσιευμένο ιστορικό.")
        : "");
    showTab("public");
  }
  function preview() {
    try {
      validateDraft({ records: data, cutoff: state.cutoff });
      const result = publication(
        {
          records: data,
          cutoff: state.cutoff,
          retroactive: $("retroactive").checked,
        },
        confirmedVersion(state),
      );
      const { rows, seriesIds } = projectPublic(result.events);
      const document = newSnapshot({
        basePublicationId: state.confirmed.publicationId,
        cutoff: state.cutoff,
        events: rows,
      });
      displayPreview(
        { document, records: structuredClone(result.records), seriesIds },
        result.pastChanges,
      );
    } catch (error) {
      toast(error.message);
    }
  }
  async function restoreFile(file) {
    if (!file) return;
    try {
      const archive = parsePublic(await file.text());
      if (!archive.publicationId)
        throw Error("Επιλέξτε προηγούμενη δημοσιευμένη έκδοση.");
      const previous = state.versions.find((entry) =>
        sameSnapshot(entry.document, archive),
      );

      const document = newSnapshot({
        basePublicationId: state.confirmed.publicationId,
        cutoff: archive.cutoff,
        events: archive.events,
        restoredFrom: archive.publicationId,
      });
      displayPreview({ records: null, seriesIds: null, ...previous, document });
      $("productionStatus").textContent =
        "Προεπισκόπηση επαναφοράς · " +
        archive.events.length +
        " ημερίδες. Το ιδιωτικό πρόχειρο διατηρείται.";
    } catch (error) {
      toast(error.message);
    }
  }
  function wireAdmin() {
    $("admin").inert = false;
    $("tools").inert = false;
    $("tabAdmin").onclick = () => {
      adminPreview = true;
      showTab("admin");
    };
    $("draftView").onclick = () => {
      adminPreview = true;
      showTab("public");
    };
    $("restoreDate").value = todayISO();
    $("restoreOpen").onclick = () => {
      if (adminPreview && $("restoreDate").value)
        showDay($("restoreDate").value);
    };
    $("adminMenu").onclick = (e) => {
      const button = e.target.closest("[data-section]");
      if (button) {
        section = button.dataset.section;
        editing = null;
        renderAdmin();
      }
    };
    $("cutoff").value = state.cutoff;
    $("cutoff").onchange = (e) => {
      state.cutoff = e.target.value;
      persist();
    };
    $("retroactive").onchange = invalidatePreview;
    $("export").onclick = () =>
      download(state, "OMH_PRIVATE_BACKUP_" + todayISO() + ".json");
    $("importBtn").onclick = () => $("importFile").click();
    $("importFile").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file)
        try {
          await privateImport(file);
        } catch (error) {
          toast(error.message);
        }
    };
    $("preview").onclick = preview;
    $("publish").onclick = async () => {
      const entry = previewDraft;
      if (!entry) return;
      $("publish").disabled = true;
      if (
        !state.versions.some(
          (version) =>
            version.document.publicationId === entry.document.publicationId,
        )
      )
        state.versions.push(entry);
      await persistState();
      download(entry.document, "calendar.json");
      $("productionStatus").textContent =
        "Το αρχείο ετοιμάστηκε. Εξαγάγετε ιδιωτικό αντίγραφο, ανεβάστε το calendar.json στο GitHub και πατήστε «Έλεγχος GitHub Pages».";
      $("publish").disabled = previewDraft !== entry;
    };
    $("checkPublication").onclick = () => refreshAdmin({ manual: true });
    $("restoreArchive").onclick = () => $("restoreFile").click();
    $("restoreFile").onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      void restoreFile(file);
    };
    window.addEventListener("beforeunload", (e) => {
      if (unsaved) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }
  async function initAdmin() {
    state = blankState();
    try {
      db = await openStorage(indexedDB);
      const stored = await storedState(db);
      if (stored) {
        state = readBackup(stored.value, { legacy: false });
        preservedRevision = stored.revision;
      } else {
        const legacy = localStorage.getItem("omh-calendar-source-v10-7");
        if (legacy) {
          state = readBackup({
            format: "omh-calendar-demo",
            version: 1,
            records: JSON.parse(legacy),
          });
          await persistState();
        }
      }
      if (!unsaved)
        storageStatus().textContent =
          "Οι αλλαγές αποθηκεύονται αυτόματα στη συσκευή.";
    } catch {
      db?.close();
      db = undefined;
      storageStatus().textContent =
        "Η τοπική αποθήκευση δεν άνοιξε. Εισαγάγετε ή εξαγάγετε ιδιωτικό αντίγραφο πριν κλείσετε τη σελίδα.";
    }
    data = state.records;
    adminPreview = true;
    wireAdmin();
    renderConfirmed();
    showTab("admin");
    void refreshAdmin();
  }
  void initAdmin();
})();
