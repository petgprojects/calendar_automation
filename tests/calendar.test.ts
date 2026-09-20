import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseCalendar } from "../src/core/calendar";
import { validateRollover, revisionOrder } from "../src/core/model";
import { event, escapeIcs, fixture } from "./helpers";
const through = "2026-09-19";
test("master and individual exports have identical UID, occurrence, note identity and content", async () => {
  const master = parseCalendar(await fs.readFile(fixture, "utf8"), through);
  const individual = (
    await Promise.all(
      ["events/ATT0005.ics", "events/ATT00023.ics"].map(async (f) =>
        parseCalendar(await fs.readFile(f, "utf8"), through),
      ),
    )
  ).flatMap((c) => c.notes);
  assert.equal(master.events, 2);
  assert.equal(master.notes.length, 8);
  assert.deepEqual(master.issues, []);
  assert.deepEqual(
    master.notes.map((n) => [n.key, n.hash]).sort(),
    individual.map((n) => [n.key, n.hash]).sort(),
  );
});
test("Unicode, escaped text, folded lines and paragraphs survive", () => {
  const data = event(
    "Élodie O’Neil :- First, semi; slash\\.\n\nSecond paragraph.",
  ).replace("First\\,", "Fi\r\n rst\\,");
  const n = parseCalendar(data, through).notes[0];
  assert.equal(n.person, "Élodie O’Neil");
  assert.equal(n.text, "First, semi; slash\\.\n\nSecond paragraph.");
});
test("RRULE, RDATE, EXDATE, moved and cancelled exceptions", () => {
  const base = event("Mandy Turner :- original", {
    date: "2026-08-01",
    extra:
      "RRULE:FREQ=DAILY;COUNT=4\r\nEXDATE;VALUE=DATE:20260802\r\nRDATE;VALUE=DATE:20260807\r\n",
  }).replace(
    "END:VCALENDAR",
    "BEGIN:VEVENT\r\nUID:synthetic\r\nRECURRENCE-ID;VALUE=DATE:20260803\r\nDTSTART;VALUE=DATE:20260805\r\nDESCRIPTION:Mandy Turner :- moved\r\nSEQUENCE:1\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:synthetic\r\nRECURRENCE-ID;VALUE=DATE:20260804\r\nDTSTART;VALUE=DATE:20260804\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR",
  );
  const parsed = parseCalendar(base, through);
  assert.deepEqual(
    parsed.notes.map((n) => n.date),
    ["2026-08-01", "2026-08-05", "2026-08-07"],
  );
  assert.equal(parsed.notes[1].occurrence, "2026-08-03");
  assert.equal(parsed.notes[1].text, "moved");
  assert.equal(parsed.issues.length, 1);
});
test("all-day dates never shift, explicit UTC conversion and floating times are intentional", () => {
  assert.equal(
    parseCalendar(event(), through, "America/Vancouver").notes[0].date,
    "2026-08-18",
  );
  const utc = event().replace(
    "DTSTART;VALUE=DATE:20260818",
    "DTSTART:20260818T003000Z",
  );
  assert.equal(
    parseCalendar(utc, through, "America/Toronto").notes[0].date,
    "2026-08-17",
  );
  const unknown = utc.replace(
    "DTSTART:20260818T003000Z",
    "DTSTART;TZID=NotAZone:20260818T003000",
  );
  assert.equal(parseCalendar(unknown, through).notes.length, 0);
  assert.match(parseCalendar(unknown, through).issues[0].message, /Timezone/);
});
test("unknown/repeated headings, preambles, unresolved images and conflicting UID are review items", () => {
  for (const body of [
    "Preamble\nMandy Turner :- text",
    "Mandy Turner :- A\nMandy Turner :- B",
    "Mandy :- text",
  ])
    assert.equal(parseCalendar(event(body), through).notes.length, 0);
  assert.equal(
    parseCalendar(event("Unknown Person :- A note"), through).notes[0].person,
    "Unknown Person",
  );
  const attached = event(undefined, {
    extra: "ATTACH:https://example.invalid/image.png\r\n",
  });
  assert.match(
    parseCalendar(attached, through).issues[0].message,
    /Attachments/,
  );
  const html = event(undefined, {
    extra: `X-ALT-DESC;FMTTYPE=text/html:${escapeIcs('<p>Mandy Turner :- Text <img src="https://example.invalid/image.png"></p>')}\r\n`,
  });
  assert.match(parseCalendar(html, through).issues[0].message, /image/);
  const a = event().match(/BEGIN:VEVENT[\s\S]*END:VEVENT/)![0],
    b = event("Mandy Turner :- B").match(/BEGIN:VEVENT[\s\S]*END:VEVENT/)![0];
  const r = parseCalendar(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${a}\r\n${b}\r\nEND:VCALENDAR`,
    through,
  );
  assert.equal(r.notes.length, 0);
  assert.match(r.issues[0].message, /Conflicting/);
});
test("rollover validity and contradictory version metadata are conservative", () => {
  assert.throws(() => validateRollover(2, 29));
  assert.throws(() => validateRollover(4, 31));
  assert.doesNotThrow(() => validateRollover(9, 1));
  assert.equal(
    revisionOrder(
      { sequence: 2, modified: "2025-01-01" },
      { sequence: 1, modified: "2026-01-01" },
    ),
    "unknown",
  );
});
