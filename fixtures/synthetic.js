export const regular = {
  id: "private-series",
  kind: "regular",
  title: "Συνθετικά ζεύγη",
  start: "2026-12-21",
  end: "2028-12-25",
  time: "19:30",
  excluded: ["2027-03-01"],
  overrides: { "2027-03-08": { time: "18:30", simultaneous: true } },
  independent: ["2027-03-15"],
  notes: "ΑΠΟΚΛΕΙΣΤΙΚΑ ΙΔΙΩΤΙΚΟ ΚΕΙΜΕΝΟ",
};
export const pending = {
  id: "private-pending",
  kind: "special",
  title: "Ιδιωτική συνθετική δοκιμή",
  dates: ["2027-03-01"],
  times: ["19:30"],
  pending: true,
  replaces: [{ id: regular.id, date: "2027-03-01" }],
};
export const special = {
  id: "synthetic-special",
  kind: "special",
  title: "Διπλή ημερίδα",
  dates: ["2027-03-03", "2027-03-03", "2027-04-03"],
  times: ["16:00", "19:30", "19:00"],
  grade: "Χωρίς βαθμίδα",
  notes: "<img src=x onerror=alert(1)>",
};
export const lesson = {
  id: "synthetic-lesson",
  kind: "lesson",
  title: "Συνθετικά μαθήματα",
  start: "2026-12-28",
  count: 29,
  cycles: 3,
  perCycle: 9,
  cycleSizes: [9, 10, 10],
  startingNumber: 1,
  time: "18:00",
};
const rows = (count, base) =>
  Array.from({ length: count }, (_, index) => ({
    ...base,
    id: base.kind + "-" + index,
    title: base.title + " " + (index + 1),
  }));
export const records = [
  regular,
  ...rows(3, { ...regular, title: "Ζεύγη", excluded: [] }),
  pending,
  special,
  ...rows(12, {
    ...special,
    title: "Άλλη διοργάνωση",
    dates: ["2028-02-03"],
    times: ["19:30"],
  }),
  lesson,
  ...rows(4, lesson),
  ...rows(13, { kind: "external", title: "Εξωτερική", start: "2028-03-01" }),
  {
    id: "synthetic-other",
    kind: "other",
    title: "<img src=x onerror=alert(1)>",
    start: "2027-03-31",
    time: "20:00",
  },
  ...rows(24, {
    kind: "holiday",
    title: "Συνθετική αργία",
    start: "2027-01-04",
    blocks: ["lesson"],
  }),
];
