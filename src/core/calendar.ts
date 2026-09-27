import ICAL from "ical.js";
import { parseFragment } from "parse5";
import {
  Blocks,
  BroadcastTags,
  Inline,
  Issue,
  Note,
  hash,
  normalizeName,
  validPerson,
  namesMatch,
  broadcastRole,
  validateBroadcastTags,
} from "./model";

export type Calendar = {
  notes: Note[];
  issues: Issue[];
  events: number;
  future: number;
  dates: string[];
  eventKeys: Set<string>;
  cancelledKeys: Set<string>;
};
const MAX_OCCURRENCES = 50000;
// Outlook's HTML extension is RFC 5545 TEXT, including escaped commas and semicolons.
ICAL.design.icalendar.property["x-alt-desc"] = { defaultType: "text" };
function image(src: string): Inline["image"] {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    src,
  );
  if (!m)
    throw Error(
      "An image is linked externally or has an unsupported format. Use an embedded PNG or JPEG; no links are downloaded.",
    );
  const b = Buffer.from(m[2], "base64");
  if (b.length > 10 * 1024 * 1024)
    throw Error("An embedded image exceeds 10 MB.");
  let width = 0,
    height = 0;
  if (
    m[1] === "image/png" &&
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  }
  if (m[1] === "image/jpeg" && b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 8 < b.length) {
      if (b[p] !== 255) break;
      const marker = b[p + 1],
        len = b.readUInt16BE(p + 2);
      if ([192, 193, 194].includes(marker)) {
        height = b.readUInt16BE(p + 5);
        width = b.readUInt16BE(p + 7);
        break;
      }
      if (len < 2) break;
      p += 2 + len;
    }
  }
  if (!width || !height || width > 30000 || height > 30000)
    throw Error("An embedded image is invalid or too large.");
  return {
    base64: b.toString("base64"),
    mime: m[1] as "image/png" | "image/jpeg",
    width,
    height,
  };
}
function body(component: ICAL.Component): Blocks {
  const html = component.getFirstProperty("x-alt-desc");
  const attachments = component.getAllProperties("attach");
  if (!html) {
    if (attachments.length)
      throw Error(
        "Attachments are present but their position in the notes is unknown. Add inline images to an HTML export or review them manually.",
      );
    return String(component.getFirstPropertyValue("description") ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((text) => [{ text }]);
  }
  if (String(html.getParameter("fmttype")).toLowerCase() !== "text/html")
    throw Error("This alternative description is not supported HTML.");
  const used = new Set<ICAL.Property>();
  const blocks: Blocks = [[]];
  const newline = () => blocks.push([]);
  const walk = (n: any, style: Partial<Inline> = {}) => {
    if (n.nodeName === "#text") {
      const text = n.value.replace(/\s+/g, " ");
      if (text) blocks.at(-1)!.push({ ...style, text });
      return;
    }
    const tag = n.tagName;
    if (["script", "style", "iframe", "object", "svg", "table"].includes(tag))
      throw Error(
        `Unsupported HTML content (${tag}); review the export without losing content.`,
      );
    if (tag === "br") {
      newline();
      return;
    }
    const block = ["p", "div", "li", "h1", "h2", "h3", "blockquote"].includes(
      tag,
    );
    if (block && blocks.at(-1)!.length) newline();
    const next = { ...style };
    if (["b", "strong"].includes(tag)) next.bold = true;
    if (["i", "em"].includes(tag)) next.italic = true;
    if (tag === "u") next.underline = true;
    const css = String(
      n.attrs?.find((a: any) => a.name === "style")?.value ?? "",
    );
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) next.bold = true;
    if (/font-style\s*:\s*italic/i.test(css)) next.italic = true;
    if (/text-decoration(?:-line)?\s*:[^;]*underline/i.test(css))
      next.underline = true;
    if (tag === "img") {
      let src = n.attrs.find((a: any) => a.name === "src")?.value ?? "";
      if (src.startsWith("cid:")) {
        const cid = src.slice(4).replace(/^<|>$/g, "");
        const matches = attachments.filter((a) =>
          ["x-cid", "cid", "x-filename"].some(
            (k) =>
              String(a.getParameter(k) ?? "").replace(/^<|>$/g, "") === cid,
          ),
        );
        if (matches.length !== 1)
          throw Error(
            "An inline image has a missing or ambiguous attachment (CID).",
          );
        const a = matches[0];
        if (String(a.getParameter("encoding")).toUpperCase() !== "BASE64")
          throw Error("The inline attachment is not embedded base64 data.");
        src = `data:${a.getParameter("fmttype")};base64,${a.getFirstValue()}`;
        used.add(a);
      }
      blocks.at(-1)!.push({ image: image(src) });
    }
    for (const child of n.childNodes ?? []) walk(child, next);
    if (block) newline();
  };
  walk(parseFragment(String(html.getFirstValue())));
  if (attachments.some((a) => !used.has(a)))
    throw Error(
      "An attachment cannot be assigned to a note. Review it manually.",
    );
  return blocks;
}
function blockText(b: Inline[]) {
  return b.map((i) => i.text ?? (i.image ? "[Embedded image]" : "")).join("");
}
function trimBlocks(blocks: Blocks) {
  while (blocks.length && !blockText(blocks[0]).trim()) blocks.shift();
  while (blocks.length && !blockText(blocks.at(-1)!).trim()) blocks.pop();
  if (blocks[0]?.[0]?.text) blocks[0][0].text = blocks[0][0].text.trimStart();
  if (blocks.at(-1)?.at(-1)?.text)
    blocks.at(-1)!.at(-1)!.text = blocks.at(-1)!.at(-1)!.text!.trimEnd();
  return blocks;
}
export function splitNotes(
  blocks: Blocks,
  tags: BroadcastTags = { teacher: "", student: "" },
): { person: string; blocks: Blocks }[] {
  const notes: { person: string; blocks: Blocks }[] = [];
  for (const original of blocks) {
    const line = blockText(original);
    const h = /^\s*([^:\n]+?)\s*:\s*-\s*/u.exec(line);
    if (h) {
      const person = h[1].trim();
      if (!broadcastRole(person, tags) && !validPerson(person))
        throw Error(
          `A heading is not a full name or first-name/last-initial: ${person}. Correct it in the calendar and export again.`,
        );
      let skip = h[0].length;
      const rest = original
        .map((i) => {
          if (!i.text) return i;
          const text = i.text.slice(skip);
          skip = Math.max(0, skip - i.text.length);
          return { ...i, text };
        })
        .filter((i) => i.image || i.text);
      notes.push({ person, blocks: [rest] });
    } else if (notes.length) notes.at(-1)!.blocks.push(original);
    else if (line.trim())
      throw Error(
        "Text appears before the first name heading. Add a full name or first-name/last-initial followed by :- to assign it safely.",
      );
  }
  const names: string[] = [];
  for (const n of notes) {
    if (
      names.some((name) =>
        broadcastRole(name, tags) || broadcastRole(n.person, tags)
          ? normalizeName(name) === normalizeName(n.person)
          : namesMatch(name, n.person),
      )
    )
      throw Error(
        `Repeated heading for ${n.person}: note identity is ambiguous. Combine that person’s notes under one heading.`,
      );
    names.push(n.person);
    trimBlocks(n.blocks);
    if (!n.blocks.length)
      throw Error(
        `The note for ${n.person} is empty. Review instead of deleting Word content.`,
      );
  }
  return notes;
}
function recurrenceIdentity(time: ICAL.Time) {
  return time.isDate || time.zone.tzid === "floating"
    ? time.toString()
    : new Date(time.toUnixTime() * 1000).toISOString();
}
function timeDate(time: ICAL.Time, timezone: string) {
  if (time.isDate || timezone === "source") return time.toString().slice(0, 10);
  // Explicit calendar timezone is interpreted independently of this computer's timezone.
  if (time.zone.tzid === "floating")
    throw Error(
      "A floating event time has no source timezone. Use “Event dates” or fix the export.",
    );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time.toUnixTime() * 1000));
  return ["year", "month", "day"]
    .map((t) => parts.find((p) => p.type === t)!.value)
    .join("-");
}
export function parseCalendar(
  text: string,
  through: string,
  timezone = "source",
  broadcastTags?: BroadcastTags,
): Calendar {
  const tags = validateBroadcastTags(broadcastTags);
  if (Buffer.byteLength(text) > 30 * 1024 * 1024)
    throw Error("The calendar exceeds 30 MB. Export smaller date ranges.");
  if (!/^BEGIN:VCALENDAR\s*$/m.test(text.replace(/\r/g, "")))
    throw Error("Choose an exported .ics calendar file.");
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== "vcalendar") throw Error("Invalid calendar container.");
  ICAL.TimezoneService.reset();
  for (const c of root.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(c);
    ICAL.TimezoneService.register(tz, tz.tzid);
  }
  const result: Calendar = {
    notes: [],
    issues: [],
    events: 0,
    future: 0,
    dates: [],
    eventKeys: new Set(),
    cancelledKeys: new Set(),
  };
  const groups = new Map<string, ICAL.Component[]>();
  const issue = (id: string, message: string) =>
    result.issues.push({ id: hash(id), kind: "calendar", message });
  for (const c of root.getAllSubcomponents("vevent")) {
    result.events++;
    const uid = String(c.getFirstPropertyValue("uid") ?? "").trim();
    if (!uid) {
      issue(
        c.toString(),
        "An event has no UID. Export again from Outlook; it cannot be tracked safely.",
      );
      continue;
    }
    const group = groups.get(uid) ?? [];
    group.push(c);
    groups.set(uid, group);
  }
  let expanded = 0;
  for (const [uid, components] of groups) {
    const before = result.notes.length;
    const knownKeys = new Set(result.eventKeys);
    const knownCancelled = new Set(result.cancelledKeys);
    try {
      const byId = new Map<string, ICAL.Component>();
      for (const c of components) {
        const id = String(c.getFirstPropertyValue("recurrence-id") ?? "single");
        const old = byId.get(id);
        if (old && old.toString() !== c.toString())
          throw Error(
            "Conflicting copies of an event UID/occurrence. Export a single consistent calendar snapshot.",
          );
        byId.set(id, c);
      }
      const masters = [...byId.values()].filter(
        (c) => !c.hasProperty("recurrence-id"),
      );
      const exceptions = [...byId.values()].filter((c) =>
        c.hasProperty("recurrence-id"),
      );
      for (const c of byId.values())
        for (const p of c.getAllProperties("dtstart")) {
          const tz = String(p.getParameter("tzid") ?? "");
          if (tz && !ICAL.TimezoneService.has(tz))
            throw Error(
              `Timezone “${tz}” has no VTIMEZONE definition. Export with timezone definitions.`,
            );
        }
      const emit = (
        c: ICAL.Component,
        start: ICAL.Time,
        occurrence: string,
      ) => {
        if (++expanded > MAX_OCCURRENCES) throw Error("EXPANSION_LIMIT");
        const date = timeDate(start, timezone);
        result.dates.push(date);
        if (date > through) {
          result.future++;
          return;
        }
        const eventKey = hash(JSON.stringify([uid, occurrence]));
        const cancelled =
          String(c.getFirstPropertyValue("status") ?? "").toUpperCase() ===
            "CANCELLED" ||
          String(root.getFirstPropertyValue("method")).toUpperCase() ===
            "CANCEL";
        if (cancelled) {
          result.eventKeys.add(eventKey);
          result.cancelledKeys.add(eventKey);
          issue(
            eventKey,
            "A calendar occurrence is cancelled. Existing Word notes are preserved; review them manually.",
          );
          return;
        }
        const parsed = splitNotes(body(c), tags);
        const sequence = Number(c.getFirstPropertyValue("sequence") ?? 0);
        if (!Number.isSafeInteger(sequence) || sequence < 0)
          throw Error("Invalid source sequence number.");
        const modified = c.getFirstPropertyValue("last-modified")?.toString();
        for (const n of parsed) {
          const audience = broadcastRole(n.person, tags);
          const key = hash(
            JSON.stringify(
              audience
                ? [eventKey, "broadcast", audience, normalizeName(n.person)]
                : [eventKey, normalizeName(n.person)],
            ),
          );
          const sourceHash = hash(JSON.stringify([date, n.blocks]));
          result.notes.push({
            key,
            eventKey,
            audience,
            uid,
            occurrence,
            person: n.person,
            date,
            blocks: n.blocks,
            text: n.blocks.map(blockText).join("\n"),
            hash: sourceHash,
            revision: { sequence, modified },
            cancelled: false,
          });
        }
        result.eventKeys.add(eventKey);
      };
      if (!masters.length) {
        for (const c of exceptions) {
          const e = new ICAL.Event(c);
          emit(c, e.startDate, recurrenceIdentity(e.recurrenceId));
        }
        continue;
      }
      const c = masters[0];
      const event = new ICAL.Event(c, {
        exceptions: exceptions.map((e) => new ICAL.Event(e)),
      });
      if (!event.startDate) throw Error("An event has no start date.");
      if (!event.isRecurring()) {
        if (exceptions.length)
          throw Error("Exceptions have no recurring master.");
        emit(c, event.startDate, "single");
        continue;
      }
      // Range exceptions shift subsequent occurrences; ICAL.Event resolves them.
      // Expand far enough for negative THISANDFUTURE shifts and timezone date boundaries.
      const maxBackshift = Math.max(
        0,
        ...exceptions
          .filter(
            (ex) =>
              ex.getFirstProperty("recurrence-id")?.getParameter("range") ===
              "THISANDFUTURE",
          )
          .map((ex) => {
            const e = new ICAL.Event(ex);
            return e.recurrenceId.toUnixTime() - e.startDate.toUnixTime();
          }),
      );
      const expandThrough = new Date(
        Date.parse(through + "T00:00:00Z") + maxBackshift * 1000 + 2 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      const iter = event.iterator();
      const seen = new Set<string>();
      let count = 0;
      let occurrence: ICAL.Time | null;
      while ((occurrence = iter.next())) {
        if (++count > MAX_OCCURRENCES) throw Error("EXPANSION_LIMIT");
        const detail = event.getOccurrenceDetails(occurrence);
        const id = recurrenceIdentity(occurrence);
        seen.add(id);
        emit(detail.item.component, detail.startDate, id);
        if (occurrence.toString().slice(0, 10) > expandThrough) break;
      }
      // Explicit exceptions moved into history from a future recurrence must not be missed.
      for (const ex of exceptions) {
        const e = new ICAL.Event(ex);
        if (
          !seen.has(recurrenceIdentity(e.recurrenceId)) &&
          timeDate(e.startDate, timezone) <= through
        )
          emit(ex, e.startDate, recurrenceIdentity(e.recurrenceId));
      }
    } catch (e) {
      result.notes.splice(before);
      result.eventKeys = knownKeys;
      result.cancelledKeys = knownCancelled;
      const message = (e as Error).message;
      if (message === "EXPANSION_LIMIT")
        throw Error(
          "Calendar expansion exceeds 50,000 occurrences. No documents were changed. Export smaller ranges.",
        );
      issue(uid, `Event ${uid.slice(0, 18)}…: ${message}`);
    }
  }
  result.notes.sort(
    (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
  );
  result.dates = [...new Set(result.dates)].sort();
  return result;
}
