import type { Choice, Report, Settings } from "../core/model";
declare global {
  interface Window {
    calendarNotes: {
      settings(): Promise<{ settings: Settings; error: string }>;
      choose(kind: "ics" | "folder"): Promise<Settings>;
      configure(value: Partial<Settings>): Promise<Settings>;
      update(choices?: Choice[]): Promise<Report>;
      recover(): Promise<string[]>;
      showFolder(): Promise<void>;
      onProgress(callback: (message: string) => void): void;
    };
  }
}
const api = window.calendarNotes;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let settings: Settings;
let busy = false;
let dirty = false;
const month = el<HTMLSelectElement>("month"),
  day = el<HTMLSelectElement>("day"),
  timezone = el<HTMLSelectElement>("timezone"),
  teacherTag = el<HTMLInputElement>("teacher-tag"),
  studentTag = el<HTMLInputElement>("student-tag");
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
months.forEach((name, i) => month.add(new Option(name, String(i + 1))));
function year(date: Date, m: number, d: number) {
  let start = date.getFullYear();
  if (
    date.getMonth() + 1 < m ||
    (date.getMonth() + 1 === m && date.getDate() < d)
  )
    start--;
  return `${start}-${start + 1}`;
}
function examples() {
  const m = Number(month.value),
    d = Number(day.value),
    y = new Date().getFullYear();
  const start = new Date(y, m - 1, d),
    before = new Date(y, m - 1, d - 1);
  el("year-examples").textContent =
    `For example: ${before.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} → “… Progress Note ${year(before, m, d)}.docx”; ${start.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} → “… Progress Note ${year(start, m, d)}.docx”. Uses the event date, not today.`;
}
function days() {
  const selected = Number(day.value) || settings?.day || 1;
  day.replaceChildren();
  for (let i = 1; i <= new Date(2001, Number(month.value), 0).getDate(); i++)
    day.add(new Option(String(i), String(i)));
  day.value = String(Math.min(selected, day.options.length));
  examples();
}
function buttons() {
  document
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => (b.disabled = busy));
  el<HTMLButtonElement>("update").disabled =
    busy ||
    !settings?.icsPath ||
    !settings?.folder ||
    !settings?.confirmed ||
    dirty;
  [month, day, timezone, teacherTag, studentTag].forEach(
    (s) => (s.disabled = busy),
  );
  el("confirmed").textContent =
    settings?.confirmed && !dirty
      ? "School-year date confirmed."
      : "Please confirm the date and save any changed settings.";
}
function showSettings() {
  const ready = Boolean(
    settings.confirmed && settings.icsPath && settings.folder,
  );
  el<HTMLDetailsElement>("setup-details").open = !ready;
  el("choose-newer").hidden = !ready;
  if (ready) el("setup-section").before(el("update-section"));
  el("selected-summary").textContent = ready
    ? `Calendar: ${settings.icsPath.split(/[\\/]/).at(-1)} · Notes folder: ${settings.folder.split(/[\\/]/).at(-1)}`
    : "";
  el("ics-path").textContent = settings.icsPath || "No calendar selected";
  el("folder-path").textContent = settings.folder || "No folder selected";
  el("choose-ics").textContent = settings.icsPath
    ? "Choose newer file…"
    : "Choose calendar file…";
  month.value = String(settings.month);
  days();
  day.value = String(settings.day);
  if (![...timezone.options].some((o) => o.value === settings.timezone))
    timezone.add(new Option(settings.timezone, settings.timezone));
  timezone.value = settings.timezone;
  teacherTag.value = settings.broadcastTags?.teacher ?? "";
  studentTag.value = settings.broadcastTags?.student ?? "";
  el("last-run").textContent = settings.lastRun
    ? `Last scan: ${new Date(settings.lastRun).toLocaleString()}. This is a local snapshot, not a live calendar.`
    : "No update has run yet.";
  examples();
  buttons();
}
async function task(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  el("error").hidden = true;
  buttons();
  try {
    await fn();
  } catch (e) {
    el("error").textContent = (e as Error).message;
    el("error").hidden = false;
    el("status").textContent =
      "The operation did not complete. Your documents have not been silently reset. See the message above.";
  } finally {
    busy = false;
    buttons();
  }
}
month.addEventListener("change", () => {
  dirty = true;
  days();
  buttons();
});
day.addEventListener("change", () => {
  dirty = true;
  examples();
  buttons();
});
timezone.addEventListener("change", () => {
  dirty = true;
  buttons();
});
for (const input of [teacherTag, studentTag])
  input.addEventListener("input", () => {
    dirty = true;
    buttons();
  });
el("year-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void task(async () => {
    settings = await api.configure({
      month: Number(month.value),
      day: Number(day.value),
      timezone: timezone.value,
      broadcastTags: { teacher: teacherTag.value, student: studentTag.value },
    });
    dirty = false;
    showSettings();
  });
});
for (const [id, kind] of [
  ["choose-ics", "ics"],
  ["choose-newer", "ics"],
  ["choose-folder", "folder"],
] as const)
  el(id).addEventListener(
    "click",
    () =>
      void task(async () => {
        settings = await api.choose(kind);
        showSettings();
      }),
  );
function text(
  tag: string,
  value: string,
  parent: HTMLElement,
  className?: string,
) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function display(report: Report) {
  const summary = `${report.added} added · ${report.adopted} linked/kept · ${report.updated} updated · ${report.unchanged} unchanged · ${report.held} review items.`;
  el("status").textContent =
    `${report.completed ? "Scan complete." : "Scan interrupted for one or more documents; independent documents may have completed."} ${summary}`;
  el("results").replaceChildren();
  text(
    "p",
    `${report.events} events read; ${report.notes} individual/group notes through today; ${report.future} future occurrences encountered and skipped (future series are not fully expanded).`,
    el("results"),
  );
  if (report.dates.length)
    text(
      "p",
      `Observed dates: ${report.dates[0]} to ${report.dates.at(-1)}. This does not prove complete calendar history.`,
      el("results"),
      "hint",
    );
  const reviews = el("reviews");
  reviews.replaceChildren();
  el("review-section").hidden = !report.issues.length;
  for (const issue of report.issues) {
    const card = document.createElement("article");
    card.className = "review";
    reviews.append(card);
    text(
      "h3",
      [issue.person, issue.date].filter(Boolean).join(" — ") ||
        "Import needs attention",
      card,
    );
    text("p", issue.message, card);
    if (issue.file) text("p", issue.file, card, "path");
    if (issue.source !== undefined || issue.word !== undefined) {
      const compare = document.createElement("div");
      compare.className = "comparison";
      card.append(compare);
      for (const [name, value] of [
        ["Word document", issue.word],
        ["Calendar export", issue.source],
      ])
        if (value !== undefined) {
          const section = document.createElement("div");
          compare.append(section);
          text("h4", name!, section);
          const v = text("div", value!, section, "version");
          v.tabIndex = 0;
        }
    }
    for (const action of issue.choices ?? []) {
      const button = document.createElement("button");
      button.textContent =
        action === "keep"
          ? "Keep Word version"
          : action === "use"
            ? "Use calendar version"
            : "Add as separate note";
      button.addEventListener(
        "click",
        () => void update([{ id: issue.id, token: issue.token!, action }]),
      );
      card.append(button);
    }
  }
  settings.lastRun = report.at;
  el("last-run").textContent =
    `Last scan: ${new Date(report.at).toLocaleString()}.`;
  el("status").focus();
}
async function update(choices: Choice[] = []) {
  await task(async () => {
    el("status").textContent = "Starting a safe local update…";
    el("results").replaceChildren();
    display(await api.update(choices));
  });
}
el("update").addEventListener("click", () => void update());
api.onProgress((message) => {
  el("status").textContent = message;
});
el("recover").addEventListener(
  "click",
  () =>
    void task(async () => {
      const messages = await api.recover();
      el("results").replaceChildren();
      messages.forEach((m) => text("p", m, el("results")));
      el("reviews").replaceChildren();
      el("review-section").hidden = true;
      el("status").textContent =
        "Recovery finished. Read the results below before updating again.";
    }),
);
el("show-folder").addEventListener(
  "click",
  () =>
    void task(async () => {
      await api.showFolder();
    }),
);
void task(async () => {
  const loaded = await api.settings();
  settings = loaded.settings;
  showSettings();
  if (loaded.error) throw Error(loaded.error);
  if (settings.confirmed && settings.folder && settings.icsPath)
    el("status").textContent =
      "Ready. Update now rereads your selected export.";
});
