import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { runImport } from "../src/core/importer";
import { parseCalendar } from "../src/core/calendar";
import { Store } from "../src/core/storage";
import { workspace, event, mandy, readDoc, replaceWord } from "./helpers";
const through = "2026-09-19";
test("historical two-digit Word years use filename school-year context", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  const old = mandy.replace("2025-2026", "1998-1999");
  await fs.rename(path.join(w.folder, mandy), path.join(w.folder, old));
  await replaceWord(w.folder, old, "Aug 17/26", "Aug 17/99");
  const doc = await readDoc(w.folder, old);
  await w.write(
    event("Mandy Turner :- " + doc.rows()[0].text, { date: "1999-08-17" }),
  );
  const r = await runImport(w.settings, { through });
  assert.equal(r.adopted, 1);
  assert.equal(r.added, 0);
  assert.equal(r.issues.length, 0);
});
async function changePart(
  file: string,
  part: string,
  change: (text: string) => string,
) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  zip.file(part, change(await zip.file(part)!.async("string")));
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
}

test("mismatched internal labels and merged table layouts are actionable and unchanged", async (t) => {
  for (const scenario of ["label", "layout"]) {
    const w = await workspace();
    t.after(w.cleanup);
    await w.write(event());
    const full = path.join(w.folder, mandy);
    await changePart(
      full,
      scenario === "label" ? "word/header2.xml" : "word/document.xml",
      (text) =>
        scenario === "label"
          ? text.replace("Mandy Turner", "Someone Else")
          : text.replace("<w:tcPr>", '<w:tcPr><w:gridSpan w:val="2"/>'),
    );
    const before = await fs.readFile(full);
    const r = await runImport(w.settings, { through });
    assert.match(
      r.issues[0].message,
      scenario === "label" ? /internal.*Name/ : /merged/,
    );
    assert.deepEqual(await fs.readFile(full), before);
  }
});
test("a Word-only edit is retained; Keep Word remains an override on later source changes", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  await runImport(w.settings, { through });
  await replaceWord(w.folder, mandy, "A new note.", "User wording.");
  assert.equal((await runImport(w.settings, { through })).unchanged, 1);
  assert.equal((await readDoc(w.folder)).rows()[1].text, "User wording.");
  await w.write(event("Mandy Turner :- Source revision.", { seq: 1 }));
  const r = await runImport(w.settings, { through });
  const c = r.issues[0];
  await runImport(w.settings, {
    through,
    choices: [{ id: c.id, token: c.token!, action: "keep" }],
  });
  assert.equal((await runImport(w.settings, { through })).issues.length, 0);
  await w.write(event("Mandy Turner :- Another revision.", { seq: 2 }));
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "conflict",
  );
  assert.equal((await readDoc(w.folder)).rows()[1].text, "User wording.");
});
test("same-day distinct events stay separate when both UIDs are observed", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  const first = event("Mandy Turner :- First note.", { uid: "first" });
  const second = event("Mandy Turner :- Second note.", { uid: "second" }).match(
    /BEGIN:VEVENT[\s\S]*END:VEVENT/,
  )![0];
  await w.write(first.replace("END:VCALENDAR", second + "\r\nEND:VCALENDAR"));
  const r = await runImport(w.settings, { through });
  assert.equal(r.added, 2);
  assert.equal(r.issues.length, 0);
  assert.equal((await runImport(w.settings, { through })).unchanged, 2);
  assert.equal(
    (await readDoc(w.folder)).rows().filter((r) => r.date === "2026-08-18")
      .length,
    2,
  );
});
test("changed person, changed date and changed rollover never silently move a linked entry", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  await runImport(w.settings, { through });
  await w.write(event("Rohan Savard :- Renamed note.", { seq: 1 }));
  const renamed = await runImport(w.settings, { through });
  assert.equal(renamed.added, 0);
  assert.ok(renamed.issues.some((i) => i.kind === "identity"));
  await w.write(
    event("Mandy Turner :- A new note.", { date: "2026-08-19", seq: 1 }),
  );
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "route",
  );
  await w.write(event());
  await fs.copyFile(
    path.join(w.folder, mandy),
    path.join(w.folder, mandy.replace("2025-2026", "2026-2027")),
  );
  assert.equal(
    (await runImport({ ...w.settings, month: 8, day: 1 }, { through }))
      .issues[0].kind,
    "route",
  );
});
test("optimistic concurrency refuses a changed file; an unavailable original is never truncated", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  const store = new Store(await fs.realpath(w.folder)),
    file = path.join(w.folder, mandy),
    before = await fs.readFile(file);
  await store.locked(async () => {
    await replaceWord(w.folder, mandy, "School Visit", "Changed Visit");
    const edited = await fs.readFile(file);
    await assert.rejects(
      store.commit(mandy, before, before, {}, "probe"),
      /changed during/,
    );
    assert.deepEqual(await fs.readFile(file), edited);
  });
  await fs.writeFile(path.join(w.folder, "~$" + mandy.slice(2)), "lock");
  await w.write(event());
  assert.equal((await runImport(w.settings, { through })).completed, false);
});
test("a crash followed by manual Word edits preserves both versions and stops pending recovery", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  await assert.rejects(
    runImport(w.settings, { through, failpoint: "after-replace" }),
    /SIMULATED/,
  );
  await replaceWord(w.folder, mandy, "A new note.", "Edited after crash.");
  const before = await fs.readFile(path.join(w.folder, mandy));
  await assert.rejects(
    runImport(w.settings, { through }),
    /interrupted update/,
  );
  assert.deepEqual(await fs.readFile(path.join(w.folder, mandy)), before);
});
test("symlinked folders are not indexed and malformed calendars make no changes", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await fs.mkdir(path.join(w.root, "outside"));
  await fs.rename(
    path.join(w.folder, mandy),
    path.join(w.root, "outside", mandy),
  );
  await fs.symlink(
    path.join(w.root, "outside"),
    path.join(w.folder, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await w.write(event());
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "missing",
  );
  await w.write("not a calendar");
  await assert.rejects(runImport(w.settings, { through }), /exported/);
});
test("embedded timezone with DST converts correctly; future-moved recurrence exception is included", () => {
  const data = event()
    .replace(
      "BEGIN:VEVENT",
      "BEGIN:VTIMEZONE\r\nTZID:Example/Eastern\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT",
    )
    .replace(
      "DTSTART;VALUE=DATE:20260818",
      "DTSTART;TZID=Example/Eastern:20260818T233000",
    );
  assert.equal(parseCalendar(data, through, "UTC").notes[0].date, "2026-08-19");
  const recurring = event("Mandy Turner :- daily", {
    date: "2026-09-18",
    extra: "RRULE:FREQ=DAILY;COUNT=5\r\n",
  }).replace(
    "END:VCALENDAR",
    "BEGIN:VEVENT\r\nUID:synthetic\r\nRECURRENCE-ID;VALUE=DATE:20260922\r\nDTSTART;VALUE=DATE:20260917\r\nDESCRIPTION:Mandy Turner :- Moved earlier\r\nEND:VEVENT\r\nEND:VCALENDAR",
  );
  const result = parseCalendar(recurring, through);
  assert.ok(result.notes.some((n) => n.date === "2026-09-17"));
  assert.equal(result.notes.length, 3);
});
