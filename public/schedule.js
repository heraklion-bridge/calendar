const addDays = (s, n) => {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (s) => new Date(s + "T12:00:00Z").getUTCDay();
const fmt = (s, opt = {}) =>
  new Intl.DateTimeFormat("el-GR", { timeZone: "UTC", ...opt }).format(
    new Date(s + "T12:00:00Z"),
  );
const dateGR = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s || "")
    ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(2, 4)
    : s || "";
const dateLabel = (s) => fmt(s, { weekday: "long" }) + " " + dateGR(s);
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const todayISO = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function cat(r) {
  return {
    regular: "reg",
    special: "special",
    lesson: "lesson",
    external: "external",
    other: "other",
    holiday: "holiday",
  }[r.kind];
}
function countSpecial(t) {
  if (t.includes("Τριήμερο")) return 3;
  if (t.includes("Διήμερο")) return 2;
  return 1;
}
function greekHolidays(y) {
  const a = y % 4,
    b = y % 7,
    c = y % 19,
    d = (19 * c + 15) % 30,
    e = (2 * a + 4 * b - d + 34) % 7,
    m = Math.floor((d + e + 114) / 31),
    day = ((d + e + 114) % 31) + 1;
  const easter = addDays(
    `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    Math.floor(y / 100) - Math.floor(y / 400) - 2,
  );
  return [
    ["01-01", "Πρωτοχρονιά"],
    ["01-06", "Θεοφάνεια"],
    ["03-25", "25η Μαρτίου"],
    ["05-01", "Πρωτομαγιά"],
    ["08-15", "Κοίμηση της Θεοτόκου"],
    ["10-28", "28η Οκτωβρίου"],
    ["12-25", "Χριστούγεννα"],
    ["12-26", "Σύναξη της Θεοτόκου"],
  ]
    .map(([d, t]) => [y + "-" + d, t])
    .concat(
      [
        [-48, "Καθαρά Δευτέρα"],
        [-2, "Μεγάλη Παρασκευή"],
        [0, "Κυριακή του Πάσχα"],
        [1, "Δευτέρα του Πάσχα"],
        [50, "Αγίου Πνεύματος"],
      ].map(([n, t]) => [addDays(easter, n), t]),
    )
    .map(([start, title]) => ({
      id: "auto-holiday-" + start + "-" + title,
      kind: "holiday",
      start,
      title,
      blocks: [],
      automatic: true,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
function automaticHolidays(y, data) {
  return greekHolidays(y).filter(
    (h) =>
      !data.some(
        (r) =>
          r.kind === "holiday" && r.start === h.start && r.title === h.title,
      ),
  );
}
function closed(d, k, data) {
  return data.some(
    (h) => h.kind === "holiday" && h.start === d && h.blocks?.includes(k),
  );
}
function lessonPosition(r, number) {
  if (Array.isArray(r.cycleSizes) && r.cycleSizes.length) {
    let remaining = number;
    for (let i = 0; i < r.cycleSizes.length; i++) {
      const size = r.cycleSizes[i];
      if (remaining <= size) return { cycle: i + 1, cycleNumber: remaining };
      remaining -= size;
    }
    const size = r.cycleSizes.at(-1);
    return {
      cycle: r.cycleSizes.length + Math.ceil(remaining / size),
      cycleNumber: ((remaining - 1) % size) + 1,
    };
  }
  const size = Math.max(1, Number(r.perCycle) || 1);
  return {
    cycle: Math.ceil(number / size),
    cycleNumber: ((number - 1) % size) + 1,
  };
}
function sessions(r, data) {
  let out = [];
  if (r.kind === "regular") {
    let dates = [];
    for (let d = r.start; d <= r.end && dates.length < 400; d = addDays(d, 7)) {
      if (
        !r.excluded?.includes(d) &&
        !closed(r.overrides?.[d]?.date || d, "regular", data)
      )
        dates.push(d);
    }
    const labels = {};
    const byYear = new Map();
    for (const d of dates) {
      if (r.independent?.includes(d)) continue;
      const y = d.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(d);
    }
    for (const counted of byYear.values()) {
      const groupSizes = [];
      const totalCount = counted.length;
      const groups = Math.ceil(totalCount / 6),
        fives = 6 * groups - totalCount;
      if (fives <= groups) {
        for (let g = 0; g < groups; g++)
          groupSizes.push(g < groups - fives ? 6 : 5);
      } else {
        let remaining = totalCount;
        while (remaining > 0) {
          const size = Math.min(6, remaining);
          groupSizes.push(size);
          remaining -= size;
        }
      }
      let index = 0;
      groupSizes.forEach((size, g) => {
        for (let k = 1; k <= size; k++) {
          labels[counted[index++]] = { n: k, g: g + 1, total: size };
        }
      });
    }
    out = dates.map((d) => ({
      date: r.overrides?.[d]?.date || d,
      time: r.overrides?.[d]?.time || r.time,
      title: r.title,
      category: cat(r),
      id: r.id,
      sessionDate: d,
      number: labels[d]?.n,
      group: labels[d]?.g,
      groupTotal: labels[d]?.total,
      independent: !labels[d],
      simultaneous: r.overrides?.[d]?.simultaneous ?? r.simultaneous,
      note: r.notes || "",
      pending: r.pending === true,
    }));
  } else if (r.kind === "special") {
    out = (r.dates || []).map((d, i) => ({
      date: d,
      time: r.times?.[i] || "",
      title: r.title,
      category: cat(r),
      id: r.id,
      sessionDate: d,
      number: i + 1,
      total: r.dates.length,
      grade: r.grade,
      note: r.notes || "",
      pending: r.pending === true,
    }));
  } else if (r.kind === "lesson") {
    let d = r.start,
      n = 0,
      guard = 0;
    const max = Math.min(150, Math.max(1, Number(r.count) || 1));
    while (n < max && guard++ < 250) {
      if (!r.excluded?.includes(d) && !closed(d, "lesson", data)) {
        const number = (Number(r.startingNumber) || 1) + n;
        out.push({
          date: d,
          time: r.overrides?.[d]?.time || r.time,
          title: r.title,
          category: cat(r),
          id: r.id,
          sessionDate: d,
          number,
          ...lessonPosition(r, number),
          note: r.notes || "",
          pending: r.pending === true,
        });
        n++;
      }
      d = addDays(d, 7);
    }
  } else if (r.kind === "external") {
    for (
      let d = r.start;
      d <= (r.end || r.start) && out.length < 50;
      d = addDays(d, 1)
    )
      if (!r.excluded?.includes(d))
        out.push({
          date: d,
          time: r.time || "",
          title: r.title,
          category: cat(r),
          id: r.id,
          sessionDate: d,
          note: r.notes || "",
          pending: r.pending === true,
        });
  } else
    out = [
      {
        date: r.start,
        time: r.time || "",
        title: r.title,
        category: cat(r),
        id: r.id,
        sessionDate: r.start,
        note: r.notes || "",
        pending: r.pending === true,
      },
    ];
  return out;
}
export {
  greekHolidays,
  countSpecial,
  addDays,
  weekday,
  fmt,
  dateGR,
  dateLabel,
  validTime,
  todayISO,
  automaticHolidays,
  sessions,
};
