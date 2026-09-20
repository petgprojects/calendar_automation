# Offline release task list / acceptance ledger

Scope: local ICS only. Microsoft authentication, Graph, registration and connected calendars are deferred. Supplied originals must remain unchanged.

- [x] Read PLAN.md and both event examples and master export; enumerate all supplied DOCX inputs.
- [x] Inspect all DOCX structures and confirm 5 exact / 3 differing notes using the real parser.
- [x] Implement bounded standards-aware ICS expansion, exceptions, names, paragraphs, dates and embedded-image handling.
- [x] Implement selective DOCX table editing, chronological insertion and durable bookmarks.
- [x] Implement persistent source versions, initial reconciliation and actionable conflict decisions.
- [x] Implement backups, locking, safe replacement, write-ahead recovery and undo.
- [x] Build accessible local-only Electron setup, settings, review and recovery UI.
- [x] Test real fixtures, repeats, updates, stale versions, recurrence, boundaries, image handling and failures.
- [x] Render and inspect modified student and teacher forms, long notes and added images.
- [x] Package and exercise the app on available macOS platform; document unverified Windows/signing.
- [x] Finish launch instructions, limitations and test evidence.

## Release evidence

- 26 core acceptance tests pass; real Electron end-to-end test passes in development and packaged macOS app.
- Rendered seven modified DOCX files (23 pages); inspected all pages in a contact sheet and key pages at full size. All 45 long-note paragraphs are present.
- Apple Silicon `.app`, `.dmg` and `.zip` built. DMG/ZIP integrity checked; no end-user runtime install.
- Originals verified unchanged. `npm audit`: zero known vulnerabilities at verification time.

## Explicitly deferred / unverified (not claimed complete)

- [ ] Developer ID / Windows signing certificates and Apple notarization.
- [ ] Windows and Intel Mac builds and runtime/Word testing on those platforms.
- [ ] Microsoft Word visual inspection; current rendering evidence is LibreOffice + PDFKit.
- [ ] Recipient accessibility acceptance and full assistive-technology audit.
- [ ] Microsoft sign-in, Graph, registration and connected calendars — outside this release.
