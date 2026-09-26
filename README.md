# Calendar Notes — offline desktop app

Local ICS → existing Word progress notes. **No Microsoft account, app registration, Graph, network connection, publishing, Python or Node installation is needed by the end user.** Connected-calendar features from `PLAN.md` are deferred. `TASKS.md` is the implementation ledger.

## Launch on this Mac

Open **`release/mac-arm64/Calendar Notes.app`** in Finder. This is the bundled Apple Silicon build, exercised on this machine. It can be copied to Applications. Installable artifacts are `release/Calendar Notes-1.0.0-arm64.dmg` and `release/Calendar Notes-1.0.0-arm64-mac.zip`.

This development release is **not Developer ID signed or notarized**. macOS/workplace policy may prevent opening a downloaded copy; do not disable organizational security controls. Intel Mac and Windows packaging are configured but have not been verified on those machines. Have the developer supply an approved signed release before general deployment.

## Use

1. Work with **copies** of your notes while evaluating this first release. Close the documents in Word/LibreOffice.
2. Choose one private exported `.ics` file and the folder with your existing DOCX documents.
3. Set and confirm the annual school-year month/day. The examples show the filename years on either side of the boundary. September 1 is a suggestion, not silently confirmed.
4. Click **Update now**. Settings collapse after setup; the update button moves to the top for subsequent use.
5. Resolve review items side by side: **Keep Word version**, **Use calendar version**, or, for an initial differing entry, **Add as separate note**. No choice is made automatically for a wording difference. Other review items explain what needs correction.

Update now rereads the remembered path. **Choose newer export** retains source identity. Later Outlook changes require a fresh export; this app does not refresh Outlook. It does not require calendar publishing. Never publish confidential calendar details merely to use this app.

Dates come from the event, not the import date. History in the export is processed through today; future recurrences are not exhaustively expanded. All-day dates never shift. Timed events use their source dates by default; advanced settings offer common calendar timezones. An observed date range does not prove a complete export.

### Expected documents and notes

- Headings: `Full Name :-`, at the start of a logical line. Blank lines are preserved inside a note.
- Filenames: `Full Name- Student PROGRESS NOTE 2025-2026.docx` or `Full Name-Teacher Progress Note 2025-2026.docx`. Case and harmless spacing are normalized. Subfolders are searched; symlinks, backup and temporary folders are excluded.
- Existing two-column date/comments body table, with dates like `Aug 17/26`, and an internal Student/Teacher Name label matching the filename. Headers, footers, logos and other package parts stay intact. Merged tables, tracked changes, fields, protected documents, ambiguous matches and unfamiliar layouts need review; no replacement forms are generated.
- All eight supplied sample notes already exist in Word: **five are linked after whitespace normalization; three require review**. Sample screenshot placeholders remain literal text.
- Embedded PNG/JPEG images in `X-ALT-DESC;FMTTYPE=text/html` are supported as data URLs or embedded CID attachments (`X-CID`, `CID`, or `X-FILENAME`). Basic bold/italic/underline formatting is supported. External links are never fetched. Unassigned attachments, unsupported HTML structures/formats and unresolved images hold the event for review. Image tests use synthetic fixtures, not the supplied samples.

### Safety, repeat imports and recovery

The hidden **`.calendar-import`** folder beside the documents contains source identity, import state, write-ahead journal, transaction history and original DOCX backups. Keep it with the documents. A document's invisible `ca_…` bookmarks link entries to this state; do not remove them. Selecting a renamed/partial/newer export does not reset identity. One configured notes folder represents one calendar source; mixing unrelated calendars is not a supported workflow.

- Repeats do not duplicate notes, including master → individual sample imports.
- Ordered newer revisions update unchanged linked entries. SEQUENCE/LAST-MODIFIED are compared; DTSTAMP and download modification time are **not** revision evidence. Older, previously seen, ambiguous or contradictory versions are held.
- Word-only edits stay. Source + Word edits, or later source edits after **Keep Word**, need review.
- Missing events never imply deletion. Explicit cancellations or removed headings preserve Word content and are reported.
- Every changed document is backed up. New packages are validated, flushed to a same-directory temporary file, checked for concurrent edits/Word locks and atomically renamed. Access-denied/sharing errors are reported without truncating originals. Use one computer per folder and close Word first; advisory lock files cannot prevent all external/cloud races.
- Interrupted writes resume from a durable journal. **Recover last update** restores documents and associated state when unchanged; if edited later, it saves a separate recovery copy and preserves those edits.
- If a crash is followed by an unrelated Word edit before journal recovery, or bookmarks/state are missing, the app deliberately stops rather than guesses. Keep all files and ask the developer to reconcile the journal and backups. Do not delete `.calendar-import` to clear an error.

Notes, images and backups remain local, without built-in encryption or automatic backup pruning. A user-selected cloud-synced folder may still sync through its own software. Use authorized storage and normal computer security. Logs do not contain note bodies. Review data is rendered as text, never executable HTML.

## Reset / start over

**Rebuilding, reinstalling, or opening another copy of the app does not reset setup.** Normal launches share settings stored separately from the app. No rebuild is needed to reset them.

### Reset saved setup (macOS)

This clears the selected calendar and notes folder, school-year date confirmation, timezone choice, and last-run information. It does **not** undo Word edits or erase import history.

1. Wait for any update to finish, then **quit all copies of Calendar Notes with Command-Q**. Closing only the window is not enough on macOS.
2. Run this in Terminal. It moves only `settings.json` into a new, uniquely named backup folder; it does not delete directories or overwrite previous backups:

```sh
settings_dir="$HOME/Library/Application Support/calendar-notes-offline"
if [ -f "$settings_dir/settings.json" ]; then
  backup_dir="$(mktemp -d "$settings_dir/settings-backup.XXXXXX")" &&
    mv -n "$settings_dir/settings.json" "$backup_dir/settings.json" &&
    printf 'Settings backed up to: %s/settings.json\n' "$backup_dir"
else
  printf 'No saved settings found; nothing was changed.\n'
fi
```

3. Reopen Calendar Notes normally. You should see **No calendar selected**, **No folder selected**, and an unconfirmed school-year date. Choose your files and confirm the date to complete setup again.

**To undo the reset:** quit the app again. If you have saved new settings, run the backup command first to preserve those too. In Finder, use **Go → Go to Folder** and enter `~/Library/Application Support/calendar-notes-offline/`. Copy `settings.json` from the backup folder you want to restore into that parent folder, then reopen the app. Keep the backup folder.

Developer note: if you deliberately launch with `CALENDAR_NOTES_USER_DATA`, its directory holds that profile's `settings.json` instead; the command above resets only the normal profile.

### Start a completely fresh import test

1. Reset setup as above if you also want to repeat first-time setup.
2. Create a **new notes folder** and copy in original DOCX files from **before this app imported or linked any entries**. Copy only those clean documents, not an old `.calendar-import` folder. Simply copying already-imported documents does not reset them: their invisible import links travel with them.
3. Select the new folder and your ICS export in Calendar Notes, confirm the school-year date, then click **Update now**.

Keep the old notes folder and its `.calendar-import` folder together and untouched. **Do not delete `.calendar-import` while keeping already-imported documents, and do not strip their invisible bookmarks.** Setup reset is not an import rollback; **Recover last update** is a separate recovery operation, not a full reset.

## Developer commands

Node 24+ and npm are developer requirements only.

```sh
npm ci
npm test                 # importer / DOCX / recovery acceptance tests
npm run test:ui          # launches real Electron, uses temporary document copies
npm start               # builds and launches development app
npm run package:mac -- --arm64
npm run dist:mac -- --arm64
npm run dist:win -- --x64
```

`package-lock.json` pins dependencies. On this machine the default npm cache has pre-existing ownership problems; a developer can use `--cache /tmp/calendar-notes-npm-cache` without changing ownership.

For packaged smoke tests, set `CALENDAR_NOTES_APP` to the executable inside the bundle and run `npx playwright test`. Tests isolate Electron settings via `CALENDAR_NOTES_USER_DATA`; ordinary launches use Electron's per-user Application Support/app-data location.

Signing credentials are intentionally absent. Electron-builder's standard certificate and Apple notarization environment variables can be supplied by the release owner. CI configuration builds unsigned macOS/Windows artifacts; configuration is not evidence those hosted jobs ran. Verify Windows sharing/rename behavior, Intel Mac, Word's actual rendering, VoiceOver/NVDA, user accessibility and managed-machine policies before deployment.

### Rendering (developer-only, macOS)

```sh
npx tsx scripts/render-fixtures.ts
/Applications/LibreOffice.app/Contents/MacOS/soffice \
  -env:UserInstallation=file:///tmp/calendar-notes-render-profile --headless \
  --convert-to pdf --outdir artifacts/render-pdf artifacts/render-input/*.docx
swift scripts/pdf-preview.swift artifacts/render-pdf artifacts/render-pages
swift scripts/contact-sheet.swift artifacts/render-pages
```

Rendering uses LibreOffice/PDFKit only during development; neither is shipped nor required at runtime. See `VERIFICATION.md` for measured results and unverified limitations.
