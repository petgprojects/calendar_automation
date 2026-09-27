import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseCalendar } from "./calendar";
import { WordDocument, Row } from "./docx";
import { Store, indexDocuments, assertUnlocked } from "./storage";
import {
  Choice,
  Issue,
  Note,
  RecordEntry,
  Report,
  Settings,
  hash,
  namesMatch,
  normalizeName,
  broadcastRole,
  validateBroadcastTags,
  revisionOrder,
  schoolYear,
  today,
  validateRollover,
  whitespace,
} from "./model";
export type RunOptions = {
  through?: string;
  choices?: Choice[];
  failpoint?: string;
  onProgress?: (message: string) => void;
};
export async function runImport(
  settings: Settings,
  options: RunOptions = {},
): Promise<Report> {
  validateRollover(settings.month, settings.day);
  const tags = validateBroadcastTags(settings.broadcastTags);
  if (!settings.confirmed)
    throw Error("Confirm the school-year start date first.");
  if (!settings.icsPath || !settings.folder)
    throw Error("Choose a calendar file and notes folder first.");
  const root = await fs.realpath(settings.folder);
  const store = new Store(root);
  return store.locked(async () => {
    options.onProgress?.("Reading every event in the calendar…");
    if ((await fs.stat(settings.icsPath)).size > 30 * 1024 * 1024)
      throw Error("The calendar exceeds 30 MB. Export smaller date ranges.");
    const calendar = parseCalendar(
      await fs.readFile(settings.icsPath, "utf8"),
      options.through ?? today(),
      settings.timezone,
      tags,
    );
    const report: Report = {
      added: 0,
      adopted: 0,
      updated: 0,
      unchanged: 0,
      held: 0,
      future: calendar.future,
      events: calendar.events,
      notes: calendar.notes.length,
      dates: calendar.dates,
      issues: [...calendar.issues],
      completed: true,
      at: new Date().toISOString(),
    };
    const candidates = await indexDocuments(root);
    const batch = randomUUID();
    const sourceKeys = new Set(calendar.notes.map((n) => n.key));
    const knownSourceKeys = new Set(
      Object.values(store.state.records).map((r) => r.sourceKey ?? r.key),
    );
    const presentKeys = new Set<string>();
    const renamedEvents = new Set(
      Object.values(store.state.records)
        .filter(
          (r) =>
            calendar.eventKeys.has(r.eventKey) &&
            !sourceKeys.has(r.sourceKey ?? r.key),
        )
        .map((r) => r.eventKey),
    );
    const grouped = new Map<string, Note[]>();
    const issue = (note: Note, kind: string, message: string, file?: string) =>
      report.issues.push({
        id: note.key,
        kind,
        message,
        person: note.person,
        date: note.date,
        file,
        source: note.text,
      });
    for (const note of calendar.notes) {
      if (!knownSourceKeys.has(note.key) && renamedEvents.has(note.eventKey)) {
        issue(
          note,
          "identity",
          "A person heading changed or disappeared in this event. Review the old and new names before importing to a different person; no new entry was added.",
        );
        continue;
      }
      const year = schoolYear(note.date, settings.month, settings.day);
      const matches = candidates.filter(
        (c) =>
          c.year === year &&
          (note.audience
            ? c.role === note.audience && !broadcastRole(c.person, tags)
            : namesMatch(c.person, note.person)),
      );
      if (!matches.length || (!note.audience && matches.length !== 1)) {
        issue(
          note,
          matches.length ? "ambiguous" : "missing",
          note.audience
            ? `No ${note.audience} documents match ${year} for broadcast tag “${note.person}”. Add existing, correctly labelled documents to the notes folder; no tag-named file is created.`
            : matches.length
              ? `More than one file matches ${note.person}, ${year}. Move duplicate files outside the notes folder, then update again.`
              : `No file matches ${note.person}, ${year}. Place a matching full-name or first-name/last-initial Student/Teacher Progress Note ${year}.docx in the selected folder.`,
        );
        continue;
      }
      for (const match of matches) {
        // One source heading has a separate, stable journal/bookmark per recipient.
        // The source key also prevents roster changes from looking like renamed headings.
        const recipient: Note = note.audience
          ? {
              ...note,
              sourceKey: note.key,
              key: hash(
                JSON.stringify([note.key, normalizeName(match.person)]),
              ),
              person: match.person,
            }
          : note;
        presentKeys.add(recipient.key);
        if (
          note.audience &&
          matches.some(
            (other) =>
              other.file !== match.file &&
              namesMatch(other.person, match.person),
          )
        ) {
          issue(
            recipient,
            "ambiguous",
            `More than one ${note.audience} file matches ${match.person}, ${year}. Move duplicate files outside the notes folder, then update again.`,
            match.file,
          );
          continue;
        }
        const file = match.file;
        const saved = store.state.records[recipient.key];
        if (saved && (saved.file !== file || saved.date !== recipient.date)) {
          issue(
            recipient,
            "route",
            "This entry now has a different date, filename or school year. The old entry is preserved. Review/move it with assistance before importing; nothing is moved automatically.",
            file,
          );
          continue;
        }
        const notes = grouped.get(file) ?? [];
        notes.push(recipient);
        grouped.set(file, notes);
      }
    }
    // Only an explicitly observed occurrence may suggest a removed heading. Missing events in partial exports never imply deletion.
    for (const record of Object.values(store.state.records))
      if (
        calendar.eventKeys.has(record.eventKey) &&
        !sourceKeys.has(record.sourceKey ?? record.key) &&
        !calendar.cancelledKeys.has(record.eventKey)
      )
        report.issues.push({
          id: `removed-${record.key}`,
          kind: "removed",
          person: record.person,
          date: record.date,
          file: record.file,
          message:
            "A previously imported person heading is absent from this occurrence. The Word entry is preserved. Check whether the name changed or the note was deliberately removed.",
        });
    for (const [file, notes] of grouped) {
      const candidate = candidates.find((c) => c.file === file)!;
      const filenamePerson = candidate.person;
      const expectedRole = notes.some((note) => note.audience)
        ? candidate.role
        : undefined;
      options.onProgress?.(`Checking ${file}…`);
      const beforeCounts = {
        added: report.added,
        adopted: report.adopted,
        updated: report.updated,
        unchanged: report.unchanged,
      };
      try {
        const full = await store.target(file);
        await assertUnlocked(full);
        const before = await fs.readFile(full);
        const yearContext = Number(
          schoolYear(notes[0].date, settings.month, settings.day).slice(0, 4),
        );
        const doc = await WordDocument.load(
          before,
          notes.map((note) => note.person),
          yearContext,
          filenamePerson,
          expectedRole,
        );
        await doc.prepareImages();
        let dirty = false;
        const patch: Record<string, RecordEntry> = {};
        for (const note of notes) {
          const record = store.state.records[note.key];
          const marker = `ca_${note.key.slice(0, 32)}`;
          const linked = doc.marker(marker);
          let row: Row | undefined;
          if (record) {
            if (linked.length !== 1) {
              issue(
                note,
                "link",
                "The Word source bookmark is missing or duplicated. Do not append another note. Restore the linked document from backup or ask for reconciliation help.",
                file,
              );
              continue;
            }
            row = linked[0];
          } else if (linked.length) {
            issue(
              note,
              "link",
              "This Word entry already has a source link but its journal is missing. Restore the .calendar-import folder from backup; no duplicate was added.",
              file,
            );
            continue;
          }
          let action: "keep" | "use" | "separate" | "adopt" | "none" = "none";
          let problem: Issue | undefined;
          if (record) {
            if (record.sourceHash === note.hash) {
              report.unchanged++;
              const revision =
                revisionOrder(note.revision, record.revision) === "newer"
                  ? note.revision
                  : record.revision;
              if (revision !== record.revision)
                patch[note.key] = { ...record, revision };
              continue;
            }
            const order = revisionOrder(note.revision, record.revision);
            const stale = record.seen.includes(note.hash) || order === "older";
            const modified = row!.fingerprint !== record.wordHash;
            if (stale || order !== "newer" || modified || record.override) {
              const kind = stale
                ? "stale"
                : order !== "newer"
                  ? "version"
                  : "conflict";
              problem = {
                id: note.key,
                kind,
                message: stale
                  ? "This is a previously seen or older source version. It will not overwrite Word automatically."
                  : order !== "newer"
                    ? "The source wording changed, but SEQUENCE/LAST-MODIFIED cannot establish a newer version. Export timestamps do not prove revision order."
                    : "Both the source and Word changed, or you previously kept the Word version. Choose which version to retain.",
                choices: ["keep", "use"],
              };
            } else if (
              row!.images &&
              !note.blocks.some((b) => b.some((i) => i.image))
            ) {
              problem = {
                id: note.key,
                kind: "image",
                message:
                  "The new source lacks images that exist in Word. Review before replacing the richer entry.",
                choices: ["keep", "use"],
              };
            } else action = "use";
          } else {
            const dated = doc.rows().filter((r) => r.date === note.date);
            const exact = dated.filter(
              (r) =>
                !r.images &&
                !note.blocks.some((b) => b.some((i) => i.image)) &&
                whitespace(r.text) === whitespace(note.text),
            );
            if (exact.length === 1 && exact[0].markers.length === 0) {
              row = exact[0];
              action = "adopt";
            } else if (
              dated.length &&
              dated.every(
                (r) =>
                  r.markers.length === 1 &&
                  [
                    ...Object.values(store.state.records),
                    ...Object.values(patch),
                  ].some(
                    (owner) =>
                      owner.marker === r.markers[0] &&
                      presentKeys.has(owner.key) &&
                      owner.key !== note.key,
                  ),
              )
            ) {
              action = "separate";
            } else if (exact.length || dated.length > 1) {
              issue(
                note,
                "ambiguous",
                "Several entries or an already-linked entry may match this note. Review the same-date rows in Word; the app will not guess or append.",
                file,
              );
              continue;
            } else if (dated.length === 1) {
              row = dated[0];
              if (row.markers.length) {
                issue(
                  note,
                  "identity",
                  "A different source already owns this dated Word entry. Check the event UID; nothing was duplicated.",
                  file,
                );
                continue;
              }
              problem = {
                id: note.key,
                kind: "initial",
                message:
                  "A Word entry on this date differs from the calendar. Compare both versions; wording will never be corrected automatically.",
                choices: ["keep", "use", "separate"],
              };
            } else action = "separate";
          }
          if (problem) {
            problem = {
              ...problem,
              person: note.person,
              date: note.date,
              file,
              source: note.text,
              word: row?.text,
              token: hash(
                JSON.stringify([
                  note.hash,
                  note.revision,
                  row?.fingerprint,
                  record ?? null,
                ]),
              ),
            };
            const choice = options.choices?.find(
              (c) =>
                c.id === note.key &&
                c.token === problem!.token &&
                problem!.choices!.includes(c.action),
            );
            if (!choice) {
              report.issues.push(problem);
              continue;
            }
            action = choice.action;
          }
          if (action === "separate") {
            row = doc.insert(note.date, note.blocks, marker);
            report.added++;
          } else if (action === "use") {
            row = doc.write(row!, note.date, note.blocks, marker);
            report.updated++;
          } else if (action === "adopt" || action === "keep") {
            doc.mark(row!, marker);
            row = doc.marker(marker)[0];
            report.adopted++;
          } else continue;
          dirty = true;
          patch[note.key] = {
            key: note.key,
            sourceKey: note.sourceKey,
            eventKey: note.eventKey,
            person: note.person,
            date: note.date,
            file,
            marker,
            sourceHash: note.hash,
            revision: note.revision,
            seen: [...new Set([...(record?.seen ?? []), note.hash])],
            wordHash: row!.fingerprint,
            override: action === "keep",
          };
        }
        if (dirty) {
          const after = await doc.save();
          await WordDocument.load(
            after,
            notes.map((note) => note.person),
            yearContext,
            filenamePerson,
            expectedRole,
          );
          await store.commit(
            file,
            before,
            after,
            patch,
            batch,
            options.failpoint,
          );
        } else if (Object.keys(patch).length) {
          Object.assign(store.state.records, patch);
          await store.save();
        }
      } catch (e) {
        if ((e as Error).message === "SIMULATED_CRASH") throw e;
        Object.assign(report, beforeCounts);
        report.completed = false;
        report.issues.push({
          id: hash(file),
          kind: "document",
          file,
          message: `${(e as Error).message} No further changes were attempted for this document. Close Word, check permissions/free space, and update again.`,
        });
        // A pending transaction must be settled before touching another file.
        try {
          await store.recover();
        } catch (err) {
          report.issues.push({
            id: "recovery",
            kind: "recovery",
            message: (err as Error).message,
          });
          break;
        }
      }
    }
    report.held = report.issues.length;
    return report;
  });
}
export async function recoverLastUpdate(folder: string) {
  return new Store(await fs.realpath(folder)).undoLast();
}
