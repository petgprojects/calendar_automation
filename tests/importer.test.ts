import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { runImport, recoverLastUpdate } from "../src/core/importer";
import { hash, schoolYear } from "../src/core/model";
import { Store } from "../src/core/storage";
import {
  workspace,
  fixtureNotes,
  files,
  mandy,
  brenda,
  event,
  readDoc,
  replaceWord,
} from "./helpers";
const through = "2026-09-19";

test("real supplied files: 5 adopt, 3 review; originals/parts preserved; renamed and individual repeats", async (t) => {
  const originals = await Promise.all(
    files.map((n) => fs.readFile(path.join(fixtureNotes, n))),
  );
  const w = await workspace();
  t.after(w.cleanup);
  const first = await runImport(w.settings, { through });
  assert.equal(first.adopted, 5);
  assert.equal(first.issues.length, 3);
  assert.equal(first.added, 0);
  assert.deepEqual(first.issues.map((i) => i.person).sort(), [
    "Brenda Jones",
    "Esther Briggs",
    "Rohan Khosh",
  ]);
  for (let i = 0; i < files.length; i++) {
    const before = await JSZip.loadAsync(originals[i]),
      after = await JSZip.loadAsync(
        await fs.readFile(path.join(w.folder, files[i])),
      );
    for (const p of Object.keys(before.files).filter(
      (p) => p !== "word/document.xml" && !before.files[p].dir,
    ))
      assert.deepEqual(
        await after.file(p)!.async("nodebuffer"),
        await before.file(p)!.async("nodebuffer"),
        p,
      );
  }
  const repeat = await runImport(w.settings, { through });
  assert.equal(repeat.unchanged, 5);
  assert.equal(repeat.issues.length, 3);
  assert.equal(repeat.added, 0);
  const resolved = await runImport(w.settings, {
    through,
    choices: first.issues.map((i) => ({
      id: i.id,
      token: i.token!,
      action: "keep",
    })),
  });
  assert.equal(resolved.issues.length, 0);
  assert.equal(resolved.adopted, 3);
  await fs.rename(w.settings.icsPath, path.join(w.root, "renamed.ics"));
  w.settings.icsPath = path.join(w.root, "renamed.ics");
  assert.equal((await runImport(w.settings, { through })).unchanged, 8);
  for (const file of ["events/ATT0005.ics", "events/ATT00023.ics"]) {
    w.settings.icsPath = path.resolve(file);
    const r = await runImport(w.settings, { through });
    assert.equal(r.unchanged, 4);
    assert.equal(r.added, 0);
    assert.equal(r.issues.length, 0);
  }
  for (let i = 0; i < files.length; i++)
    assert.deepEqual(
      await fs.readFile(path.join(fixtureNotes, files[i])),
      originals[i],
    );
});
test("compact document names and headings import across school years, including a full heading and a missing dash", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  const people = [
    ["Brenda Jones", "BrendaJ"],
    ["Esther Briggs", "EstherB"],
    ["Mandy Turner", "MandyT"],
    ["Rohan Khosh", "RohanK"],
    ["Rohan Savard", "RohanS"],
  ];
  await fs.mkdir(path.join(w.folder, "2025-2026"));
  await fs.mkdir(path.join(w.folder, "2026-2027"));
  for (const [full, short] of people) {
    const original = files.find((file) => file.startsWith(full))!;
    const compact =
      short === "MandyT"
        ? original.replace("Mandy Turner- ", "MandyT ")
        : original.replace(full, short);
    const old = path.join(w.folder, "2025-2026", compact);
    await fs.rename(path.join(w.folder, original), old);
    await fs.copyFile(
      old,
      path.join(
        w.folder,
        "2026-2027",
        compact.replace("2025-2026", "2026-2027"),
      ),
    );
  }
  const note = (date: string, uid: string, fullMandy: boolean) =>
    event(
      people
        .map(
          ([full, short]) =>
            `${fullMandy && short === "MandyT" ? full : short} :- ${uid} note`,
        )
        .join("\n\n"),
      { date, uid },
    );
  const first = note("2026-08-18", "old-year", false);
  const second = note("2026-09-07", "new-year", true).match(
    /BEGIN:VEVENT[\s\S]*END:VEVENT/,
  )![0];
  await w.write(first.replace("END:VCALENDAR", second + "\r\nEND:VCALENDAR"));
  const r = await runImport(w.settings, { through });
  assert.equal(r.added, 10, JSON.stringify(r.issues));
  assert.equal(r.issues.length, 0);
  assert.equal((await runImport(w.settings, { through })).unchanged, 10);
  assert.ok(
    (
      await readDoc(
        w.folder,
        "2025-2026/MandyT Student PROGRESS NOTE 2025-2026.docx",
      )
    )
      .rows()
      .some((row) => row.text === "old-year note"),
  );
});
test("abbreviation collisions and internal full-name mismatches never choose a document", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  const original = files.find((file) => file.startsWith("Rohan Khosh"))!;
  const khosh = original.replace("Rohan Khosh", "RohanK");
  await fs.rename(path.join(w.folder, original), path.join(w.folder, khosh));
  await w.write(event("RohanK :- Test"));
  const other = khosh.replace("RohanK", "Rohan King");
  await fs.copyFile(path.join(w.folder, khosh), path.join(w.folder, other));
  const ambiguous = await runImport(w.settings, { through });
  assert.equal(ambiguous.issues[0].kind, "ambiguous");
  assert.equal(ambiguous.added, 0);
  await fs.rm(path.join(w.folder, other));
  await w.write(event("Rohan Khosh :- First\nRohan King :- Second"));
  const shared = await runImport(w.settings, { through });
  assert.equal(shared.added, 0);
  assert.equal(shared.issues[0].kind, "document");
  await w.write(event("Rohan Khosh :- Test"));
  const full = path.join(w.folder, khosh);
  const zip = await JSZip.loadAsync(await fs.readFile(full));
  for (const part of Object.keys(zip.files).filter((name) =>
    /^word\/header\d+\.xml$/.test(name),
  ))
    zip.file(
      part,
      (await zip.file(part)!.async("string")).replaceAll(
        "Rohan Khosh",
        "Rohan King",
      ),
    );
  await fs.writeFile(full, await zip.generateAsync({ type: "nodebuffer" }));
  const mismatch = await runImport(w.settings, { through });
  assert.equal(mismatch.added, 0);
  assert.match(mismatch.issues[0].message, /internal.*Name/);
});
test("changing a tracked full heading to an abbreviation requires review", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  await w.write(event());
  assert.equal((await runImport(w.settings, { through })).added, 1);
  await w.write(event("MandyT :- A new note.", { seq: 1 }));
  const r = await runImport(w.settings, { through });
  assert.equal(r.added, 0);
  assert.ok(r.issues.some((i) => i.kind === "identity"));
  assert.ok(r.issues.some((i) => i.kind === "removed"));
});
test("empty real forms receive eight notes, blank rows reused, source paragraphs preserved", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  const r = await runImport(w.settings, { through });
  assert.equal(r.added, 8);
  assert.equal(r.issues.length, 0);
  for (const file of files) {
    const d = await readDoc(w.folder, file);
    assert.equal(d.rows().length, 17);
    assert.ok(
      d
        .rows()
        .filter((r) => r.date)
        .every((r) => r.markers.length === 1),
    );
  }
  const d = await readDoc(w.folder, brenda);
  assert.match(d.rows()[1].text, /Hi Brenda,\n\nHope/);
  assert.match(d.rows()[1].text, /\{SCREENSHOT/);
  assert.equal((await runImport(w.settings, { through })).unchanged, 8);
});
test("ordered revisions update untouched Word; edited Word conflicts; stale/ambiguous snapshots never revert", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  assert.equal((await runImport(w.settings, { through })).added, 1);
  await w.write(event("Mandy Turner :- Newer wording.", { seq: 1 }));
  assert.equal((await runImport(w.settings, { through })).updated, 1);
  await w.write(event());
  const stale = await runImport(w.settings, { through });
  assert.equal(stale.issues[0].kind, "stale");
  assert.equal(
    (await readDoc(w.folder))
      .rows()
      .filter((r) => r.date)
      .at(-1)!.text,
    "Newer wording.",
  );
  await w.write(
    event("Mandy Turner :- Same sequence, different words.", { seq: 1 }),
  );
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "version",
  );
  await replaceWord(
    w.folder,
    mandy,
    "Newer wording.",
    "Manually edited in Word.",
  );
  await w.write(
    event("Mandy Turner :- New source and Word differ.", { seq: 2 }),
  );
  const conflict = await runImport(w.settings, { through });
  assert.equal(conflict.issues[0].kind, "conflict");
  const c = conflict.issues[0];
  assert.equal(
    (
      await runImport(w.settings, {
        through,
        choices: [{ id: c.id, token: c.token!, action: "use" }],
      })
    ).updated,
    1,
  );
  assert.match((await readDoc(w.folder)).rows().at(1)!.text, /New source/);
});
test("Keep Word is a persistent override, separate adds once, obsolete review token is rejected", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  const first = await runImport(w.settings, { through });
  const c = first.issues.find((i) => i.person === "Brenda Jones")!;
  await replaceWord(
    w.folder,
    c.file!,
    "mailed Brenda",
    "mailed Brenda (manual edit)",
  );
  const obsolete = await runImport(w.settings, {
    through,
    choices: [{ id: c.id, token: c.token!, action: "use" }],
  });
  assert.equal(obsolete.issues.length, 3);
  const next = obsolete.issues.find((i) => i.id === c.id)!;
  await runImport(w.settings, {
    through,
    choices: [{ id: next.id, token: next.token!, action: "separate" }],
  });
  assert.equal(
    (await readDoc(w.folder, brenda))
      .rows()
      .filter((r) => r.date === "2026-08-20").length,
    2,
  );
  assert.equal((await runImport(w.settings, { through })).issues.length, 2);
});
test("missing, ambiguous, label mismatch, unsupported layout, open Word and missing links are held", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  await fs.mkdir(path.join(w.folder, "copy"));
  await fs.copyFile(
    path.join(w.folder, mandy),
    path.join(w.folder, "copy", mandy),
  );
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "ambiguous",
  );
  await fs.rm(path.join(w.folder, "copy"), { recursive: true });
  const lock = path.join(w.folder, `~$${mandy}`);
  await fs.writeFile(lock, "lock");
  assert.match(
    (await runImport(w.settings, { through })).issues[0].message,
    /lock/,
  );
  await fs.rm(lock);
  await runImport(w.settings, { through });
  const data = await fs.readFile(path.join(w.folder, mandy)),
    zip = await JSZip.loadAsync(data);
  zip.file(
    "word/document.xml",
    (await zip.file("word/document.xml")!.async("string")).replaceAll(
      /ca_[a-f0-9]+/g,
      "deleted",
    ),
  );
  await fs.writeFile(
    path.join(w.folder, mandy),
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "link",
  );
  await fs.rm(path.join(w.folder, mandy));
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "missing",
  );
});
test("both crash windows recover without duplication and backups are exact", async (t) => {
  for (const failpoint of ["before-replace", "after-replace"]) {
    const w = await workspace();
    t.after(w.cleanup);
    await w.write(event());
    const before = await fs.readFile(path.join(w.folder, mandy));
    await assert.rejects(
      runImport(w.settings, { through, failpoint }),
      /SIMULATED_CRASH/,
    );
    const r = await runImport(w.settings, { through });
    assert.equal(r.issues.length, 0);
    assert.equal(
      (await readDoc(w.folder)).rows().filter((r) => r.date === "2026-08-18")
        .length,
      1,
    );
    const backupFiles = await fs.readdir(
      path.join(w.folder, ".calendar-import/backups"),
    );
    assert.ok(
      await Promise.all(
        backupFiles.map((n) =>
          fs.readFile(path.join(w.folder, ".calendar-import/backups", n)),
        ),
      ).then((bs) => bs.some((b) => hash(b) === hash(before))),
    );
    assert.equal((await runImport(w.settings, { through })).unchanged, 1);
  }
});
test("undo restores linked state; later Word changes produce a recovery copy", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  const original = await fs.readFile(path.join(w.folder, mandy));
  await runImport(w.settings, { through });
  assert.match((await recoverLastUpdate(w.folder))[0], /Recovered:/);
  assert.deepEqual(await fs.readFile(path.join(w.folder, mandy)), original);
  assert.equal((await runImport(w.settings, { through })).added, 1);
  await replaceWord(w.folder, mandy, "A new note.", "Edited after import.");
  const edited = await fs.readFile(path.join(w.folder, mandy));
  assert.match((await recoverLastUpdate(w.folder))[0], /Later edits preserved/);
  assert.deepEqual(await fs.readFile(path.join(w.folder, mandy)), edited);
});
test("chronology, rollover boundaries, history through today, and more than 17 rows", async (t) => {
  assert.equal(schoolYear("2026-08-31", 9, 1), "2025-2026");
  assert.equal(schoolYear("2026-09-01", 9, 1), "2026-2027");
  const w = await workspace(true);
  t.after(w.cleanup);
  await fs.copyFile(
    path.join(w.folder, mandy),
    path.join(w.folder, mandy.replace("2025-2026", "2026-2027")),
  );
  for (const [date, uid] of [
    ["2026-08-31", "a"],
    ["2026-08-01", "b"],
    ["2026-09-01", "c"],
    ["2027-01-01", "future"],
  ]) {
    await w.write(event("Mandy Turner :- " + date, { date, uid }));
    const r = await runImport(w.settings, { through });
    assert.equal(r.added, date.startsWith("2027") ? 0 : 1);
  }
  assert.deepEqual(
    (await readDoc(w.folder))
      .rows()
      .filter((r) => r.date)
      .map((r) => r.date),
    ["2026-08-01", "2026-08-31"],
  );
  assert.equal(
    (await readDoc(w.folder, mandy.replace("2025-2026", "2026-2027"))).rows()[0]
      .date,
    "2026-09-01",
  );
  await w.write(
    event("Mandy Turner :- recurring note", {
      date: "2026-08-01",
      extra: "RRULE:FREQ=DAILY;COUNT=25\r\n",
    }),
  );
  const r = await runImport(w.settings, { through });
  assert.ok(r.added >= 23);
  assert.ok((await readDoc(w.folder)).rows().length > 17);
});
test("partial exports never delete; removed headings and cancellations preserve entries", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  await w.write(event());
  await runImport(w.settings, { through });
  await w.write(event("Rohan Savard :- Different event", { uid: "other" }));
  assert.equal((await runImport(w.settings, { through })).issues.length, 0);
  assert.ok(
    (await readDoc(w.folder)).rows().some((r) => r.text === "A new note."),
  );
  await w.write(event("", { seq: 1 }));
  assert.equal(
    (await runImport(w.settings, { through })).issues[0].kind,
    "removed",
  );
  await w.write(event("", { seq: 2, extra: "STATUS:CANCELLED\r\n" }));
  assert.match(
    (await runImport(w.settings, { through })).issues[0].message,
    /cancelled/,
  );
});
test("concurrent folder lock and invalid state never start a second writer", async (t) => {
  const w = await workspace();
  t.after(w.cleanup);
  const store = new Store(w.folder);
  await store.locked(async () => {
    await assert.rejects(runImport(w.settings, { through }), /already running/);
  });
  await fs.writeFile(
    path.join(w.folder, ".calendar-import/state.json"),
    "invalid",
  );
  await assert.rejects(
    runImport(w.settings, { through }),
    /state was not reset/,
  );
});
