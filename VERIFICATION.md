# Verification evidence

Verified on 19 September 2026, macOS Darwin 25.6.0, Apple Silicon arm64. Development Node 24.13.0; bundled Electron 44.4.3. No supplied ICS or DOCX original was edited. Tests use temporary copies; renderer experiments use `artifacts/`.

## Automated behavior

`npm run build` passes TypeScript checking and bundles main/preload/renderer. **`npm test`: 26 passed, 0 failed** (about 6–7 seconds). Checks include:

- Actual master and both individual ICS fixtures resolve to the identical eight UID/occurrence/person notes.
- Supplied populated forms: exactly **5 adopted, 3 reviewed, 0 added**. Differences are Brenda Jones, Esther Briggs and Rohan Khosh on 20 August 2026.
- Keeping the three Word versions persists decisions; identical reimport is **8 unchanged, 0 review, 0 added**. Renaming the download and importing each individual file afterward are duplicate-free.
- Empty copies of the five actual forms receive eight entries, reuse the existing 17 rows, preserve wording/paragraphs and literal screenshot placeholders.
- All pre-existing ZIP parts except `word/document.xml` are byte-identical for text imports, including headers, footers, logos and media. Image imports change only the expected additional relationship/content-type/media parts.
- Newer revisions update unedited entries; Word-only edits remain; both-edited conflicts, manual overrides, obsolete review tokens, same-sequence ambiguity, known old snapshots and contradictory metadata are safe.
- Unicode, line folding, escapes, multi-paragraph text, full-name validation, repeated headings, unknown names, RRULE/RDATE/EXDATE, moved/cancelled exceptions, embedded timezone/DST conversion, floating/all-day behavior and future filtering.
- Both rollover boundaries, historical 1999 two-digit Word dates, row growth beyond 17 rows, chronological insertion, distinct same-day events, changed date/person/year routing and missing-event non-deletion.
- Synthetic PNG data-URL and CID images retain bytes, ordering, aspect ratio and italic runs. A later text-only export cannot silently remove an imported image. Unresolved/remote images are held. **The supplied samples do not demonstrate image payload support.**
- Missing/duplicate files, mismatched internal names, merged layouts, both Word lock filename forms, missing bookmarks, symlink exclusions, malformed calendars, concurrent writers and unreadable state.
- Simulated interruption immediately before and immediately after replacement: retry commits once, with exact backups and no duplicates. Concurrent edits reject replacement. Post-crash manual edits are preserved and held for assisted recovery. Undo restores the exact original and corresponding import state; later-edited files receive separate recovery copies.

## Real desktop exercise

`npx playwright test`: **1 end-to-end desktop scenario passed**, against both development Electron and the actual bundled `Calendar Notes.app` executable. This is not a mocked renderer.

The test exercises native picker IPC (dialog selection is automated), first setup, rollover confirmation, keyboard activation, 52px-or-larger primary controls, offline import, all three review decisions, repeat import, settings/reconciliation across full app restart and blocked external fetches. The polished daily-use view puts Update now above collapsed settings. Screenshots are in `artifacts/desktop-review.png` and `artifacts/desktop-complete.png`.

Not yet verified: real recipient usability, a full keyboard-only setup with native file dialogs, VoiceOver/NVDA audit, 200% text scaling on every supported OS, and actual Word's platform-specific lock behavior.

## DOCX rendering

`npx tsx scripts/render-fixtures.ts` generated seven modified DOCX copies. LibreOffice 25.8.4.2 converted all successfully. macOS PDFKit rendered **23 pages** to PNG. The contact sheet and selected full-resolution pages were visually inspected.

| Output | Pages |
| --- | ---: |
| Brenda teacher form | 2 |
| Esther student form | 3 |
| Mandy student form | 2 |
| Rohan Khosh student form | 2 |
| Rohan Savard student form | 2 |
| Teacher form with synthetic inline image | 2 |
| Student form with >17 rows and a long 45-paragraph note | 10 |

Headers/logos, person details, date/comments widths and signature areas remain visible. Long notes flow across pages without fixed-height clipping. The visible synthetic image sits between the correct text paragraphs, with italic text preserved. All 45 numbered paragraphs were also found in extracted PDF text. Original blank rows are deliberately retained, so some forms have mostly blank trailing pages; pagination/spacing is not redesigned.

Artifacts: `artifacts/render-input/`, `artifacts/render-pdf/`, `artifacts/render-pages/`, especially `contact-sheet.png`. These are ignored by git. Rendering is a LibreOffice check, **not a claim of Microsoft Word visual testing**.

## Packaging and integrity

`CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- --arm64` built:

- `release/mac-arm64/Calendar Notes.app` — bundled app, approximately 292 MB.
- `release/Calendar Notes-1.0.0-arm64.dmg`.
- `release/Calendar Notes-1.0.0-arm64-mac.zip`.

The packaged executable was launched and exercised through the complete desktop test. DMG checksum verification and ZIP archive testing passed. Runtime Node/Chromium and all parsing/editing libraries are bundled; no end-user dependency installation is necessary. `npm audit` reported zero vulnerabilities at verification time.

`git diff --exit-code -- notes events` passes; the external master export still matches the copied test fixture byte-for-byte. Original LibreOffice lock files were not removed.

**Not signed with a distribution certificate; not notarized.** No certificates were available and signing was explicitly skipped. Windows x64/arm64 NSIS and Intel Mac/arm64 distribution targets are configured; Windows and Intel Mac builds/runtime tests have not been performed here. CI configuration is supplied, but no hosted CI run is claimed. macOS Gatekeeper and workplace approval remain release prerequisites.

## Remaining conservative limitations

Only the documented two-column forms/date formats and full-name/year filenames are supported. Unsupported/ambiguous files, repeated same-person headings, renamed people, moved destinations and lost bookmarks require correction or assisted reconciliation, not guessing. Image review uses textual placeholders rather than visual thumbnails; inspect Word/export content before choosing a rich-content replacement. External image retrieval, general attachment import, arbitrary HTML tables and connected calendars are intentionally absent.

One writer/computer per folder; no multi-computer synchronization protocol. Word reserialization can cause extra conservative conflicts. A crash followed by unrelated manual changes before journal recovery needs assistance; neither version is overwritten. Safety budgets and unencrypted local backup retention are documented in `README.md` and `ARCHITECTURE.md`.
