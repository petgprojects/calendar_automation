# Outlook calendar notes importer

> **Implementation update (19 September 2026):** the first release is now a **local ICS-only Electron application**. Microsoft authentication, Graph, registration and connected-calendar work below are historical future-scope proposals, not first-release dependencies. See `README.md` for launch instructions, `TASKS.md` for implementation status, and `VERIFICATION.md` for actual test/build evidence. Supplied calendar and Word originals remain unchanged.

Planning status: core requirements agreed on 19 September 2026, including a subsequently requested local master-ICS import option. Peter is an external volunteer developer with no contacts at the recipient's workplace. Workplace approval is an unverified dependency for live Microsoft access, not something Peter can arrange directly. File import must work independently of that access. The implementation below is proposed; no application code has been written and the sample files have not been changed.

## Task list

- [x] Inspect both calendar examples and all five Word files, including rendered pages.
- [x] Research Outlook access, desktop packaging, and workplace constraints.
- [x] Resolve platform, execution, import history, content, update, storage, accessibility, and setup ownership questions.
- [x] Document the proposed implementation and acceptance checks.
- [x] Revisit registration and consent requirements for an external developer without workplace contacts.
- [x] Inspect the supplied master calendar export and confirm its events match the individual samples.
- [x] Add local master-ICS import, repeat-import rules, and source limitations to the plan.
- [ ] Validate Microsoft sign-in and retrieval of a real inline image on the target account during implementation.
- [ ] Build and verify the importer against copies of the supplied files.
- [ ] Package, sign, and test releases on Windows and Mac.

## Agreed requirements

| Area | Decision |
| --- | --- |
| Computers | Windows and Mac |
| Outlook account | Work/school Microsoft 365 account; the user's own calendar |
| Input methods | Live Outlook connection or one local master `.ics` file; file mode is available immediately, including if consent fails |
| Execution | User opens the app and clicks **Update now** |
| First setup | Choose input method; connect/select calendar or choose an ICS file; choose notes folder and annual rollover month/day |
| Existing records | Person/year DOCX files already exist; preserve their format |
| First import | Import all available history from the chosen source and review possible duplicates; a file supplies only the events actually exported |
| Content | Text and inline images available in the input; a file cannot supply images or formatting omitted by the exporter |
| Later calendar edits | Update the imported entry; ask if the Word entry was also edited |
| Storage | Ordinary local folders; only one computer updates each set |
| Accessibility | Prioritize mouse and keyboard; minimize clicking and typing |
| Microsoft setup | Peter can handle developer-side registration; he has no workplace affiliation or IT contacts. Whether the recipient can consent or must request approval is unknown. |
| Dependencies | End user installs no language runtime, packages, or command-line tools |

## Evidence from the examples

- `events/ATT0005.ics` contains four notes dated 17 August 2026.
- `events/ATT00023.ics` contains four notes dated 20 August 2026.
- The eight notes belong to five people. Brenda, Esther, and Rohan Khosh have two notes each; Mandy and Rohan Savard have one each.
- The delimiter is a person's full name followed by `:-`, with variable spaces. Embedded emails span many paragraphs. Blank lines are not note boundaries.
- Both events are all-day events. Use their event dates, not export timestamps or the day the importer runs.
- All five DOCX files contain a two-column body table with 17 rows, including unused rows. The columns contain date and comments. Display dates follow `Aug 17/26`.
- Logos, person details, column labels, and signature areas are in header/footer parts. Student and teacher forms differ. Preserve both forms rather than rebuilding them from one generic template.
- Existing notes already cover all eight sample notes. Five match after whitespace normalization. Three have capitalization or wording differences, including a corrected typo and an added parenthetical. These differences must not be silently discarded.
- Screenshot placeholders are literal text in the supplied examples. They do not demonstrate actual inline-image retrieval. The embedded DOCX media is the form branding.
- The August 2026 examples are filed under `2025-2026`, consistent with a rollover later in the year, such as 1 September. The actual rollover remains a setup setting.
- The additional `calendar.ics` at `/Users/petergelgor/Library/Mobile Documents/com~apple~CloudDocs/Downloads/calendar.ics` is 4,783 bytes and contains one calendar named `Automation`, one timezone definition, and two nonrecurring events, dated 17 and 20 August 2026. Both UIDs and decoded descriptions match the individual event files exactly: eight notes across five people.
- This master file contains no attachment properties, image payloads, image references, or HTML alternative descriptions. Screenshot placeholders are text only. Both event sequences are zero, there are no `LAST-MODIFIED` fields, and `DTSTAMP` values must not be assumed to prove when note content changed.

## Recommended application

Use Electron and TypeScript, with a small accessible interface, two input adapters (Microsoft Graph and local ICS), one shared local import engine, and targeted DOCX editing. The adapters produce the same event/note model so name matching, year routing, document preservation, conflict review, and backups behave consistently. File mode must not initialize Microsoft authentication or make network requests. Electron bundles Chromium and Node into platform-specific apps, so the recipient needs no development tools. The tradeoff is a larger application download. [Electron introduction](https://www.electronjs.org/docs/latest/)

Distribute a signed Windows app and a signed, notarized Mac app. Target installation in user-writable locations where workplace policy allows it. Exact supported OS versions and CPU builds should be checked against the recipient's machines before release. Signing and packaging are developer responsibilities; they cannot guarantee that a managed work computer will allow the app. [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

The importer edits DOCX files directly. Microsoft Word, Outlook desktop, Python, Node, and LibreOffice are not runtime prerequisites. Word or another viewer is only needed if the user wants to open the resulting documents. Rendering tools used by the developer for layout checks are not shipped as end-user dependencies.

## User experience

First launch is a short wizard:

1. **Choose how to get notes** offers **Connect Outlook** and **Import calendar file**. Neither option requires trying the other first.
2. In connected mode, Microsoft's sign-in page opens in the normal browser, including MFA when required; **Choose calendar** then lists calendars by name. In file mode, **Choose calendar file** opens a normal `.ics` file picker. Parse and validate the file, then show its event count and observed date range. A sign-in approval failure also offers **Import calendar file** directly.
3. **Choose notes folder** uses the normal folder picker. The app checks file access and detects the available person/year documents.
4. **School year starts on** asks for a month and day and shows example date-to-filename mappings. Propose 1 September as an editable default, with no silent commitment to it.
5. **Update now** scans the selected source. Straightforward notes import automatically; ambiguous matches remain available in **Review items**.

Subsequent launches show the selected source, notes folder, last completed update, and one large **Update now** button. Connected mode shows the account and calendar. File mode remembers the file path and offers **Choose newer file**; replacing the file at the remembered path also works. The user must obtain a fresh export to import later calendar changes. Show when the file was last imported and make clear that file mode does not refresh from Outlook. Show progress and then a plain-language result, for example: “12 notes added, 3 updated, 2 need review.” Distinguish a completed scan with held items from an interrupted scan.

Use large click targets, visible keyboard focus, a logical Tab order, keyboard-operable dialogs, resizable text, and screen-reader labels. Avoid drag-and-drop requirements, hover-only controls, time-limited messages, and technical configuration fields. Settings and recovery controls remain secondary. The actual user should try the short setup and normal update flow before release.

## Microsoft access

Register a public desktop client in a Microsoft Entra directory Peter controls or has permission to use, configured to accept accounts from other organizations (a multitenant registration). Do not assume access to the recipient's workplace directory or ask the recipient to register the app as part of normal setup. A workplace-owned registration is an alternative only if its IT team later agrees to manage one. Registration identifiers ship with the app; the end user does not type them. Do not embed a client secret. Being an external developer does not itself prevent sign-in, but the recipient organization's consent policies still apply. [Microsoft multitenant registration and consent](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant)

Use MSAL Node with authorization code flow and PKCE through the system browser. Microsoft documents this flow for Electron. [Microsoft desktop authentication tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop)

Request delegated `Calendars.Read` and the sign-in/session scopes required by MSAL. `Calendars.ReadBasic` excludes event bodies and attachments, so it cannot meet this task. Do not request calendar-write permission. Calendar selection restricts what the app processes, while the delegated permission itself is broader than a single selected calendar. [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference#calendarsread)

Keep the token cache encrypted using the operating system's credential protection; on Mac, account for any initial Keychain prompt. Keep credentials out of the notes folder and support logs. [Electron credential protection](https://www.electronjs.org/docs/latest/api/safe-storage)

Delegated `Calendars.Read` does not inherently require administrator consent, but the workplace can prohibit user consent or restrict it to selected permissions and verified publishers. A newly registered app from an unverified external publisher may also trigger Microsoft's risk-based consent restrictions. Therefore, do not promise that the recipient can approve this app themselves. Code signing the desktop executable is separate from Microsoft publisher verification; neither overrides workplace policy. [Microsoft consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent), [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)

Before investing in the full live integration, build a minimal sign-in/calendar-read test using the intended app registration and have the recipient try it with their work account. If consent is permitted, continue. If Microsoft displays an administrator-approval requirement, the recipient can use an offered approval-request workflow or their normal workplace help desk; Peter cannot grant that approval from his own directory. Do not assume an approval workflow is enabled. Authorization to read the calendar and permission to run the desktop app on the work computer are separate feasibility checks. Work on the local importer can proceed independently if live access is unavailable.

Local calendar-file import is now an agreed input option, including when live access cannot be approved. It requires no Graph consent or Microsoft sign-in in the app. Exporting still adds user steps, and the importer can only process the history and image data actually present in the file.

## Master ICS file import

Accept one `.ics` file containing many `VEVENT` components, as well as the existing single-event samples. Use a standards-aware bundled parser for line folding, escaped text, Unicode, dates, timezone definitions, recurrence rules, additional recurrence dates, exclusions, and modified occurrences. Timezone transition rules must not be confused with recurring calendar events. Treat file contents as data: do not execute instructions, scripts, or automatically retrieve linked resources.

The supplied master file is a verified fixture for the text workflow. Its event IDs and descriptions exactly match the two single-event fixtures, so importing the files in either order should resolve to the same eight notes without adding duplicates.

Give each configured calendar source a persistent local identity, independent of the download filename, path, or whole-file hash. Track ICS events by `UID` and recurrence-instance identity, then apply the existing per-note identity rules. Preserve this identity when the user selects a newer export of the same calendar. Detect malformed or conflicting UIDs and hold ambiguous entries instead of guessing. Calendar name alone does not prove two exports came from the same calendar.

Compare note content on every import, including when `SEQUENCE` or modification fields are absent or unchanged. Use trustworthy revision information where present. Do not treat file modification time or `DTSTAMP` alone as authoritative content revision order. Recognize previously imported older versions and prevent silent rollback; if differing snapshots cannot be ordered safely, send affected changes to review. Unambiguous newer edits use the agreed automatic-update behavior when the Word entry is unchanged.

An ICS file is a snapshot, not proof of complete calendar history. Show the dates observed in it without claiming that everything between those dates is present. Do not infer deletion from an event's absence in a later file: exports may cover different ranges. An explicit cancellation or a removed note within an identifiable updated event follows the existing preserve-and-review policy.

Switching between file and live mode requires source reconciliation. Use available calendar, event, occurrence, date, and content evidence to connect existing entries; do not assume Graph IDs and ICS UIDs are interchangeable in every recurrence/export case. Hold uncertain matches rather than duplicating them. A text-only export must not strip images or richer formatting previously imported from Graph or manually added in Word.

For embedded images or HTML actually present in an ICS file, preserve supported data using the same note model and layout rules. External attachment references, unsupported payloads, and unresolved image placement need a clear review item. If an export omits all evidence of an image, the app cannot detect or reconstruct the omission; explain that file imports include only content saved in the export. Actual image-bearing ICS fixtures are still needed before claiming equivalent image support to Graph.

### Obtaining the file

The user's described Outlook web **Publish a calendar** route produces a downloadable ICS file, but it also publishes calendar access through shareable links. Microsoft's documentation describes this as allowing anyone to view or subscribe. Do not present publishing with full details as a private export or make it a prerequisite of the app. [Outlook web calendar publishing](https://support.microsoft.com/en-gb/outlook/share-your-calendar-in-outlook-on-the-web)

Where classic Outlook for Windows is available, Microsoft's documented **File > Save Calendar > More Options** route permits selecting the whole calendar and detail level to save a local ICS file. Check the actual client/version and workplace settings before writing end-user export instructions; this route is not assumed available on Mac or new Outlook. [Microsoft calendar export instructions](https://support.microsoft.com/en-us/office/export-an-outlook-calendar-to-google-calendar-662fa3bb-0794-4b18-add8-9968b665f4e6)

For real student/teacher notes, prefer an authorized private export. If real records were inadvertently published, recommend using Outlook's **Unpublish** control; do not change the user's calendar settings automatically. Do not add public feed subscriptions or personal-account copies as part of this fallback.

## Import rules and proposed defaults

These are implementation defaults for review, not additional answers attributed to the user.

### History and dates

- In live mode, interpret full history as all events still available in the selected calendar through today. In file mode, process the corresponding history actually present in the export. Future-dated notes wait until their event date. Deleted, retention-expired, or unexported history cannot be reconstructed by this app.
- Enumerate all pages of calendar events to discover the available history, including recurring-series start dates. Expand recurring occurrences in finite date windows through today. Do not silently impose a recent-history cutoff or import a series master as an extra note. Graph lists series masters separately from expanded instances. [List events](https://learn.microsoft.com/en-us/graph/api/calendar-list-events?view=graph-rest-1.0), [Calendar view](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
- Initially favor a complete rescan of the selected source on each click, comparing saved versions to avoid unnecessary work. Live rescans catch late edits to old events; file rescans catch them only after a fresh export is supplied. Measure real calendar size before introducing incremental synchronization.
- Use the all-day calendar date as written. For timed events, use the start date in the configured calendar timezone, detected initially and changeable in settings. Do not shift dates according to the computer's current travel timezone.
- A recurring occurrence is a distinct dated source. A multi-day event produces notes on its start date.
- Route by the event date and rollover rule, not the import date. With a 1 September rollover, 31 August 2026 maps to `2025-2026`; 1 September maps to `2026-2027`.
- Changing the rollover setting after importing requires a review of affected entries before moving anything between files.

### Parsing and name matching

- Read the complete body, including HTML where supplied. Convert it into ordered paragraphs, text formatting, and images; do not use the truncated body preview.
- A note starts with a full-name heading ending in `:-` at the beginning of a logical line/paragraph. Support spaces around the delimiter. Continue until the next heading.
- Preserve text, punctuation, paragraphs, and basic inline formatting such as italics. Do not summarize, correct spelling, infer missing text, or apply AI rewriting.
- Use safe normalization for names: Unicode normalization, case, and repeated spaces. Match the whole name; do not guess from first names, abbreviations in event titles, or fuzzy similarity.
- Index existing filenames by full name and school-year suffix, allowing the spacing and capitalization variations shown in the samples. Inspect the internal person label to detect mismatches. Use an explicit saved mapping for names that cannot be resolved unambiguously.
- Search the chosen folder and its subfolders, excluding backups, temporary files, and Word lock files. Do not follow links outside the selected root.
- Unknown names, duplicate candidate files, inconsistent person labels, missing year files, or unfamiliar table layouts go to review. Do not create replacement files or use a different year as a fallback.
- Preserve multiple notes for the same person as separate entries. Track their identities across source edits; if repeated headings make that correspondence ambiguous, hold the affected entries for review rather than trusting their position.
- Content before the first heading, or a heading-shaped line with an unknown name, must not be silently attached to the preceding person's record.

### Inline images

- Keep each image with the note containing it, in source order. Scale to fit the comments column while keeping its aspect ratio.
- Resolve embedded images from the body and corresponding event attachments. Microsoft file attachments expose inline status, content IDs, and content bytes. [Graph file attachments](https://learn.microsoft.com/en-us/graph/api/resources/fileattachment?view=graph-rest-1.0)
- Confirm real Outlook image representation during the access prototype. Neither the individual ICS fixtures nor the master export contains real screenshot payloads. Validate image-bearing file exports separately. Hosted image URLs may need different handling from embedded attachment references.
- If an image cannot be retrieved or assigned to a person, hold that note and explain the issue. Do not report a complete import while silently losing the image.
- Separate attached documents are outside the first version's agreed scope. Preserve literal screenshot-placeholder text; do not treat it as an instruction to retrieve an email attachment.

### Word layout

- Modify the existing document package selectively. Fill suitable blank rows, insert dated rows in chronological position when needed, and clone the template's row/cell formatting when more rows are required.
- Keep the template's date format, column widths, fonts, headers, logos, signature areas, and existing manual content. Let long text and images flow across pages without fixed heights that clip content.
- Add only the media files, relationships, and content-type entries needed for new images. Do not regenerate unrelated document parts.
- Verify resulting pagination and appearance in both template types, including long notes, images, and rows extending beyond the existing blank space.

## Duplicate prevention and later edits

Maintain a local import journal and embed unobtrusive source markers with app-managed entries in the DOCX. Store account/calendar identity, event identity, occurrence identity, per-note identity, source version, target person/year, and last-written content fingerprints. Use Graph immutable event IDs where available; these remain stable within a mailbox, subject to documented exceptions. [Immutable Outlook IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)

On first import, compare the person, date, and complete note content with existing rows. Normalize representation-only whitespace differences, but do not erase wording differences. Only adopt an unambiguous exact match automatically. Similar matches appear side by side with **Keep Word version**, **Use calendar version**, and **Add as separate note** actions. Save the choice so unchanged sources do not prompt repeatedly.

For the supplied eight notes, the expected initial reconciliation is five matching entries and three requiring review; there should not be eight newly appended rows. Choosing to keep a differing Word version records a manual override, so a later calendar change returns that entry to review instead of silently erasing the retained edits.

On later runs:

| Situation | Proposed behavior |
| --- | --- |
| Source unchanged | No write |
| Source changed; managed Word entry unchanged | Update the linked entry |
| Source and Word entry both changed | Hold the entry for review |
| Word changed; source unchanged | Preserve the Word edit |
| Previously imported source deleted/cancelled, or note removed | Preserve Word entry; surface the change for review |
| Person or date changes and requires a different destination | Review the proposed move before changing existing records |
| Entry marker missing or note identity ambiguous | Reconcile safely; do not append blindly |

Do not rely on a content hash alone as note identity: an edit changes the hash. Do not rely on a row number: insertion and manual Word edits move rows. Source removal must not be inferred from a failed or incomplete API scan.

## Safe writes and recovery

- Finish calendar discovery successfully before applying a batch. Stage planned changes and any review issues first.
- Use a single-running-instance guard for each document set. Local folders and one writer per set are the agreed scope; simultaneous cross-computer editing is outside it.
- Detect Word lock indicators and available operating-system locks. Recheck the original file's fingerprint immediately before replacement; defer a document that changed during the operation.
- Back up every document that will change. Write to a temporary file beside it, validate the DOCX package, then replace the original using the platform's safe file-replacement operation.
- Journal the write so a crash between DOCX replacement and state saving can be reconciled using the embedded entry markers. A second run must not duplicate committed notes.
- Skip unavailable or locked documents with a clear message and continue independent documents. Never truncate an original on failure.
- Provide recovery of the last update. If the file was subsequently edited, recover into a separate copy or ask for a conflict decision rather than overwriting those edits.
- Keep notes, images, backups, and import state on the user's computer. File importing works offline. In connected mode, network traffic is for Microsoft authentication and retrieval; no AI service is needed. Avoid note bodies, tokens, and images in diagnostic logs.

## Implementation sequence and acceptance checks

1. **Input and packaging feasibility.** Verify a bundled app opens on Windows and Mac without development runtimes and can read a locally chosen ICS file. Separately register the external developer's multitenant app and test whether the recipient can consent with their work account before relying on live integration. If available, retrieve an event body and a real pasted image. Live-access failure must not block file-mode development. Confirm workplace execution restrictions and minimum OS versions early.
2. **Shared importer and file mode.** Implement the local master-ICS adapter using the same normalized note model planned for Graph. The master export and the two individual fixtures must produce the same eight notes; importing both forms in either order must not duplicate them. On empty copies of the templates, obtain eight correctly routed entries. Against supplied populated copies, reconcile five matches and three review candidates. Test repeat exports, renamed downloads, partial date ranges, stale snapshots, and recurrence exceptions. Preserve all source wording.
3. **DOCX preservation and repeatability.** Render and inspect outputs; check package integrity, original header/footer/media preservation, inline images, date order, row growth, and long-note pagination. Verify a second identical import makes no duplicate entries. Test both agreed update behavior and retained manual overrides.
4. **Live adapter and reliability.** When access is available, implement Graph retrieval and exercise paging, recurring exceptions, old edits, revoked sign-in, API throttling, and network interruption. For both modes, test all-day/timed dates, both sides of rollover, missing documents, ambiguous names, image failures, Word locks, source switching, and recovery after partial completion. Verify that a poorer file export never silently removes existing images.
5. **Accessible interface and distribution.** Add the source-choice wizard, file picker, Update now, review actions, persistent progress/results, and recovery. Verify file mode works with no sign-in or network access and that approval errors offer it directly. Test keyboard-only navigation and large text with the user. Produce signed platform packages and verify on machines with no Python, Node, or developer tools installed.

Planning is complete enough to begin this sequence when implementation is requested. The first milestone tests computer constraints and, independently, live account access; neither should be mistaken for already verified deployment. Local master-file import is part of the agreed first-version scope.
