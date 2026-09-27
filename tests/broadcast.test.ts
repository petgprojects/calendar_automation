import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parseCalendar } from "../src/core/calendar";
import { runImport, recoverLastUpdate } from "../src/core/importer";
import { validateBroadcastTags } from "../src/core/model";
import { indexDocuments } from "../src/core/storage";
import {
  workspace,
  files,
  mandy,
  brenda,
  event,
  escapeIcs,
  readDoc,
  replaceWord,
} from "./helpers";
import { samplePng } from "./image-fixture";

const through = "2026-09-19";
const tags = { teacher: "ALL TEACHERS", student: "ALL STUDENTS" };
const students = files.filter((file) => file !== brenda);
const messages = (report: { issues: unknown[] }) =>
  JSON.stringify(report.issues);
async function replacePackageText(file: string, old: string, next: string) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  for (const part of Object.keys(zip.files).filter((name) =>
    /^word\/.*\.xml$/.test(name),
  ))
    zip.file(
      part,
      (await zip.file(part)!.async("string")).replaceAll(old, next),
    );
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
}

test("broadcast tags are opt-in, validated, normalized exact headings and may be non-names", () => {
  assert.deepEqual(validateBroadcastTags(undefined), {
    teacher: "",
    student: "",
  });
  assert.deepEqual(
    validateBroadcastTags({ teacher: " @staff ", student: "@learners" }),
    { teacher: "@staff", student: "@learners" },
  );
  for (const invalid of [
    null,
    [],
    "staff",
    { teacher: 42 },
    { student: "a\nb" },
    { teacher: "tag :-" },
    { student: "x".repeat(101) },
    { teacher: " ALL   PEOPLE ", student: "all people" },
  ])
    assert.throws(() => validateBroadcastTags(invalid));
  const custom = { teacher: "@staff", student: "@learners" };
  const parsed = parseCalendar(
    event(
      "@STAFF :- Staff note\n@learners :- Learner note\nMandyT :- Personal",
    ),
    through,
    "source",
    custom,
  );
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(
    parsed.notes.map((n) => n.audience),
    ["teacher", "student", undefined],
  );
  assert.equal(parsed.notes[0].text, "Staff note");
  const normalized = parseCalendar(
    event("  all   TEACHERS :- Meeting"),
    through,
    "source",
    tags,
  );
  assert.equal(normalized.notes[0].audience, "teacher");
  const abbreviation = parseCalendar(
    event("AllT :- Personal"),
    through,
    "source",
    tags,
  );
  assert.equal(abbreviation.notes[0].audience, undefined);
  assert.match(
    parseCalendar(event("@staff :- A\n@STAFF :- B"), through, "source", custom)
      .issues[0].message,
    /Repeated/,
  );
  assert.equal(
    parseCalendar(event("ALL TEACHERS :- Meeting"), through).notes[0].audience,
    undefined,
  );
  assert.equal(
    parseCalendar(event("@staff :- Meeting"), through).notes.length,
    0,
  );
});

test("both broadcast groups reach all matching documents, subfolders and only the event school year", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = tags;
  const secondTeacher = brenda.replace("Brenda Jones", "Taylor Smith");
  await fs.copyFile(
    path.join(w.folder, brenda),
    path.join(w.folder, secondTeacher),
  );
  await replacePackageText(
    path.join(w.folder, secondTeacher),
    "Brenda Jones",
    "Taylor Smith",
  );
  const recipients = [...files, secondTeacher];
  await fs.mkdir(path.join(w.folder, "next-year"));
  for (const file of recipients)
    await fs.copyFile(
      path.join(w.folder, file),
      path.join(w.folder, "next-year", file.replace("2025-2026", "2026-2027")),
    );
  await fs.mkdir(path.join(w.folder, "nested"));
  await fs.rename(
    path.join(w.folder, mandy),
    path.join(w.folder, "nested", mandy),
  );
  const tagFile = brenda.replace("Brenda Jones", "ALL TEACHERS");
  await fs.copyFile(path.join(w.folder, brenda), path.join(w.folder, tagFile));
  const untouched = await fs.readFile(path.join(w.folder, tagFile));
  const indexed = await indexDocuments(w.folder);
  assert.equal(indexed.find((c) => c.file === brenda)!.role, "teacher");
  assert.equal(
    indexed.find((c) => c.person === "Mandy Turner")!.role,
    "student",
  );
  const description =
    "ALL TEACHERS :- Staff only\nALL STUDENTS :- Students only";
  await w.write(event(description));
  const first = await runImport(w.settings, { through });
  assert.equal(first.added, 6, messages(first));
  assert.deepEqual(first.issues, []);
  for (const c of indexed.filter((c) => c.file !== tagFile)) {
    const rows = (await readDoc(w.folder, c.file))
      .rows()
      .filter((r) => !r.blank);
    assert.deepEqual(
      rows.map((r) => r.text),
      c.year === "2025-2026"
        ? [c.role === "teacher" ? "Staff only" : "Students only"]
        : [],
      c.file,
    );
  }
  assert.deepEqual(await fs.readFile(path.join(w.folder, tagFile)), untouched);
  assert.equal((await runImport(w.settings, { through })).unchanged, 6);
  await w.write(event(description, { uid: "new-year", date: "2026-09-01" }));
  const rollover = await runImport(w.settings, { through });
  assert.equal(rollover.added, 6, messages(rollover));
  assert.deepEqual(rollover.issues, []);
  assert.equal(
    (await indexDocuments(w.folder)).length,
    indexed.length,
    "never creates a tag-named document",
  );
});

test("group and individual notes coexist; repeats, revisions and conflicts are independent per recipient", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = { teacher: "@staff", student: "@learners" };
  const description = (text: string) =>
    `@learners :- ${text}\nMandyT :- Personal note`;
  await w.write(event(description("Group original")));
  const first = await runImport(w.settings, { through });
  assert.equal(first.added, 5, messages(first));
  assert.deepEqual(first.issues, []);
  assert.equal((await runImport(w.settings, { through })).unchanged, 5);
  await replaceWord(w.folder, mandy, "Group original", "Local group wording");
  const other = students.find((f) => f !== mandy)!;
  await replaceWord(w.folder, other, "Group original", "Other local wording");
  await w.write(event(description("Group revised"), { seq: 1 }));
  const changed = await runImport(w.settings, { through });
  assert.equal(changed.updated, 2, messages(changed));
  assert.equal(changed.issues.length, 2);
  assert.equal(new Set(changed.issues.map((i) => i.id)).size, 2);
  const selected = changed.issues.find((i) => i.file === mandy)!;
  const resolved = await runImport(w.settings, {
    through,
    choices: [{ id: selected.id, token: selected.token!, action: "use" }],
  });
  assert.equal(resolved.updated, 1);
  assert.equal(resolved.issues.length, 1);
  assert.equal(resolved.issues[0].file, other);
  assert.deepEqual(
    (await readDoc(w.folder))
      .rows()
      .filter((r) => !r.blank)
      .map((r) => r.text),
    ["Group revised", "Personal note"],
  );
  assert.ok(
    (await readDoc(w.folder, other))
      .rows()
      .some((r) => r.text === "Other local wording"),
  );
  const state = JSON.parse(
    await fs.readFile(
      path.join(w.folder, ".calendar-import/state.json"),
      "utf8",
    ),
  );
  assert.equal(Object.keys(state.records).length, 5);
  assert.equal(
    Object.values(state.records).filter((r: any) => r.sourceKey).length,
    4,
  );
});

test("new recipient documents join a broadcast on rescan without duplicate or removed-heading warnings", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = tags;
  const pending = path.join(w.root, mandy);
  await fs.rename(path.join(w.folder, mandy), pending);
  await w.write(event("ALL STUDENTS :- Shared"));
  assert.equal((await runImport(w.settings, { through })).added, 3);
  await fs.rename(pending, path.join(w.folder, mandy));
  const next = await runImport(w.settings, { through });
  assert.equal(next.added, 1, messages(next));
  assert.equal(next.unchanged, 3);
  assert.deepEqual(next.issues, []);
});

test("missing groups, ambiguous duplicates and mismatched role labels are held without misdelivery", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = tags;
  await fs.rm(path.join(w.folder, brenda));
  await fs.mkdir(path.join(w.folder, "duplicates"));
  await fs.copyFile(
    path.join(w.folder, mandy),
    path.join(w.folder, "duplicates", mandy),
  );
  const mismatch = students.find((f) => f !== mandy)!;
  await replacePackageText(path.join(w.folder, mismatch), "Student", "Teacher");
  const before = await fs.readFile(path.join(w.folder, mismatch));
  await w.write(event("ALL TEACHERS :- Teachers\nALL STUDENTS :- Students"));
  const r = await runImport(w.settings, { through });
  assert.equal(r.added, 2, messages(r));
  assert.equal(r.issues.filter((i) => i.kind === "ambiguous").length, 2);
  assert.ok(
    r.issues.some(
      (i) => i.kind === "missing" && /teacher documents/.test(i.message),
    ),
  );
  assert.ok(
    r.issues.some(
      (i) => i.file === mismatch && /recipient group/.test(i.message),
    ),
  );
  assert.deepEqual(await fs.readFile(path.join(w.folder, mismatch)), before);
  assert.equal(
    (await readDoc(w.folder)).rows().filter((r) => !r.blank).length,
    0,
  );
});

test("changing, disabling or reassigning an imported tag preserves old entries and holds identity changes", async (t) => {
  for (const mode of ["rename", "disable", "reassign", "remove"] as const) {
    const w = await workspace(true);
    t.after(w.cleanup);
    w.settings.broadcastTags = tags;
    await w.write(event("ALL STUDENTS :- Original"));
    assert.equal((await runImport(w.settings, { through })).added, 4);
    if (mode === "rename") {
      w.settings.broadcastTags = { teacher: tags.teacher, student: "Learners" };
      await w.write(event("Learners :- Original", { seq: 1 }));
    } else if (mode === "disable")
      w.settings.broadcastTags = { teacher: "", student: "" };
    else if (mode === "reassign")
      w.settings.broadcastTags = { teacher: tags.student, student: "" };
    else await w.write(event("Brenda Jones :- Replacement", { seq: 1 }));
    const next = await runImport(w.settings, { through });
    assert.equal(next.added, 0, mode);
    assert.equal(next.updated, 0, mode);
    assert.ok(
      next.issues.some((i) => i.kind === "identity"),
      messages(next),
    );
    assert.equal(next.issues.filter((i) => i.kind === "removed").length, 4);
    for (const file of students)
      assert.deepEqual(
        (await readDoc(w.folder, file))
          .rows()
          .filter((r) => !r.blank)
          .map((r) => r.text),
        ["Original"],
      );
  }
});

test("broadcast date/year changes retain route protection, and recovery restores all recipient documents", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = tags;
  for (const file of students)
    await fs.copyFile(
      path.join(w.folder, file),
      path.join(w.folder, file.replace("2025-2026", "2026-2027")),
    );
  const before = await Promise.all(
    students.map((f) => fs.readFile(path.join(w.folder, f))),
  );
  await w.write(event("ALL STUDENTS :- Original"));
  assert.equal((await runImport(w.settings, { through })).added, 4);
  await w.write(
    event("ALL STUDENTS :- Original", { date: "2026-09-01", seq: 1 }),
  );
  const moved = await runImport(w.settings, { through });
  assert.equal(moved.added, 0);
  assert.equal(moved.issues.filter((i) => i.kind === "route").length, 4);
  await recoverLastUpdate(w.folder);
  for (let i = 0; i < students.length; i++)
    assert.deepEqual(
      await fs.readFile(path.join(w.folder, students[i])),
      before[i],
    );
});

test("formatted HTML and embedded images survive fan-out to every student", async (t) => {
  const w = await workspace(true);
  t.after(w.cleanup);
  w.settings.broadcastTags = tags;
  const html = `<p>ALL STUDENTS :- <b>Shared image</b></p><p><img src="data:image/png;base64,${samplePng().toString("base64")}"></p>`;
  await w.write(
    event(undefined, {
      extra: `X-ALT-DESC;FMTTYPE=text/html:${escapeIcs(html)}\r\n`,
    }),
  );
  const first = await runImport(w.settings, { through });
  assert.equal(first.added, 4, messages(first));
  assert.deepEqual(first.issues, []);
  for (const file of students) {
    const doc = await readDoc(w.folder, file);
    assert.equal(doc.rows().filter((r) => r.images).length, 1);
    assert.match(
      await doc.zip.file("word/document.xml")!.async("string"),
      /<w:b[\s/>]/,
    );
  }
  assert.equal((await runImport(w.settings, { through })).unchanged, 4);
});
