import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { Settings } from "../src/core/model";
import { WordDocument } from "../src/core/docx";
export const fixture = path.resolve("tests/fixtures/calendar.ics");
export const fixtureNotes = "tests/fixtures/docs";
export const files = (await fs.readdir(fixtureNotes))
  .filter((n) => n.endsWith(".docx"))
  .sort();
export const mandy = files.find((n) => n.startsWith("Mandy"))!;
export const brenda = files.find((n) => n.startsWith("Brenda"))!;
export const escapeIcs = (s: string) =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
export function event(
  description = "Mandy Turner :- A new note.",
  options: { uid?: string; date?: string; seq?: number; extra?: string } = {},
) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:${options.uid ?? "synthetic"}\r\nDTSTART;VALUE=DATE:${(options.date ?? "2026-08-18").replaceAll("-", "")}\r\nSEQUENCE:${options.seq ?? 0}\r\nDESCRIPTION:${escapeIcs(description)}\r\n${options.extra ?? ""}END:VEVENT\r\nEND:VCALENDAR\r\n`;
}
export async function workspace(blank = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "calendar-notes-test-"));
  const folder = path.join(root, "notes");
  await fs.mkdir(folder);
  for (const name of files) {
    const data = await fs.readFile(path.join(fixtureNotes, name));
    if (blank) {
      const doc = await WordDocument.load(data);
      for (const row of doc.rows())
        for (const cell of Array.from(row.element.getElementsByTagName("w:tc")))
          for (const p of Array.from(cell.getElementsByTagName("w:p")))
            while (p.lastChild && p.lastChild.nodeName !== "w:pPr")
              p.removeChild(p.lastChild);
      await fs.writeFile(path.join(folder, name), await doc.save());
    } else await fs.writeFile(path.join(folder, name), data);
  }
  const icsPath = path.join(root, "calendar.ics");
  await fs.copyFile(fixture, icsPath);
  const settings: Settings = {
    icsPath,
    folder,
    month: 9,
    day: 1,
    timezone: "source",
    confirmed: true,
  };
  return {
    root,
    folder,
    settings,
    write: (text: string) => fs.writeFile(icsPath, text),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
export async function readDoc(folder: string, file = mandy) {
  return WordDocument.load(await fs.readFile(path.join(folder, file)));
}
export async function replaceWord(
  folder: string,
  file: string,
  old: string,
  next: string,
) {
  const full = path.join(folder, file),
    zip = await JSZip.loadAsync(await fs.readFile(full));
  const xml = await zip.file("word/document.xml")!.async("string");
  if (!xml.includes(old)) throw Error("Test Word edit anchor missing");
  zip.file("word/document.xml", xml.replace(old, next));
  await fs.writeFile(full, await zip.generateAsync({ type: "nodebuffer" }));
}
