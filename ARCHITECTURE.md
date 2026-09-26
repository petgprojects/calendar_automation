# Implementation notes

## Execution path

`src/renderer/app.ts` → narrow sandboxed preload IPC → `src/electron/main.ts` → `runImport` in `src/core/importer.ts`.

1. Validate setup; acquire a per-notes-folder exclusive writer lock. The desktop also uses Electron's single-instance guard.
2. Reconcile pending journal first; do not reset unreadable state.
3. Parse the entire ICS with bundled `ical.js`, register VTIMEZONEs, group UID/recurrence identity and expand RRULE/RDATE/EXDATE/exception occurrences through the history boundary. Expansion is bounded; exceeding the budget aborts discovery before any document write.
4. Decode plain TEXT or Outlook HTML; split headings without splitting blank-line paragraphs. Canonical key = SHA-256(UID + original occurrence identity + normalized full name). Paths, download names, DTSTAMP and note hashes are not identities. The notes folder has a persistent source ID. Timed recurrence IDs are canonicalized by instant where possible; floating/all-day identities retain their calendar representation.
5. Index full-name/year filenames, excluding links and backup files; verify internal labels and supported OOXML structure. Do not fuzzy-match people, select between duplicate files or move records on changed rollover/date/name.
6. Plan per-document row operations and held issues. Initial exact person/date/text matches are adopted only when unambiguous. Review tokens bind a decision to the current source revision, Word fingerprint and saved state, preventing stale UI actions.
7. Use bookmarks for durable row links, not row positions. Store accepted source hashes, full revision metadata, seen versions, last-written row fingerprint and manual overrides. Row fingerprints conservatively include OOXML formatting and embedded image bytes; a Word re-save can create an extra safe conflict.
8. Edit only the relevant body XML; add image relationships/content types/media only when required. Reuse blank rows and insert clones in date order. Existing manual rows and unrelated ZIP parts are not reconstructed. Rows can flow over pages.
9. Validate the generated package, back up the exact original bytes, write/fsync a temporary package, persist a write-ahead transaction, check locks and original fingerprint again, rename, then persist state and archive the transaction.

## Recovery protocol

`pending.json` contains before/after file hashes, backup location and before/after record patches. If the original still equals the before-image, discard the pending transaction and replan. If it equals the after-image, apply the after-state without inserting again. If it equals neither, stop and retain both versions for assisted recovery. No inferred deletion or blind retry is used.

Undo is itself a journaled transaction. Exact unchanged after-images are restored with their prior records; later-edited files produce recovery copies instead. Backups and transaction archives are retained. Per-file commit boundaries allow unrelated documents to succeed, while a failed document is reported separately. Filesystem sharing/permission errors are non-destructive; no tool can prevent another application from ignoring advisory locks during the final check/rename race.

## Offline/security boundary

Renderer has no Node, no arbitrary filesystem IPC, sandbox/context isolation, strict CSP and text-only review rendering. Navigation/popups/permissions are denied. All non-file network requests are blocked at the Electron session. HTML parsing uses parse5, not a browser DOM; no resources or scripts execute. OOXML DTD/entities are rejected. Symlink targets outside the selected root are not followed. Packages and recurrence expansion have explicit safety budgets. There is no auth, Graph client, token cache, telemetry, updater or connected mode.

## Conservative limits

30 MB calendar, 60 MB compressed / 150 MB expanded DOCX, 10 MB per embedded PNG/JPEG, 50,000 occurrence expansion budget, 20,000 folder entries. Exceeding limits gives actionable errors; it never reports a silently truncated successful import. Multiple headings for the same name within one occurrence, unsupported HTML/table constructs, unresolved images, missing links, changed destinations and unfamiliar Word layouts are held. Name/file remapping and automatic moves are not implemented; users can correct filenames/labels or request assistance.
