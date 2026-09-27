import { createHash } from "node:crypto";
export type Inline = {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  image?: {
    base64: string;
    mime: "image/png" | "image/jpeg";
    width: number;
    height: number;
  };
};
export type Blocks = Inline[][];
export type Revision = { sequence: number; modified?: string };
export type RecipientRole = "teacher" | "student";
export type BroadcastTags = Record<RecipientRole, string>;
export type Note = {
  key: string;
  sourceKey?: string;
  audience?: RecipientRole;
  eventKey: string;
  uid: string;
  occurrence: string;
  person: string;
  date: string;
  blocks: Blocks;
  text: string;
  hash: string;
  revision: Revision;
  cancelled: boolean;
};
export type Issue = {
  id: string;
  kind: string;
  message: string;
  person?: string;
  date?: string;
  file?: string;
  source?: string;
  word?: string;
  choices?: ("keep" | "use" | "separate")[];
  token?: string;
};
export type Settings = {
  icsPath: string;
  folder: string;
  month: number;
  day: number;
  timezone: string;
  confirmed: boolean;
  broadcastTags?: BroadcastTags;
  lastRun?: string;
};
export type RecordEntry = {
  key: string;
  sourceKey?: string;
  eventKey: string;
  person: string;
  date: string;
  file: string;
  marker: string;
  sourceHash: string;
  revision: Revision;
  seen: string[];
  wordHash: string;
  override: boolean;
};
export type State = {
  version: 1;
  sourceId: string;
  records: Record<string, RecordEntry>;
};
export type Choice = {
  id: string;
  token: string;
  action: "keep" | "use" | "separate";
};
export type Report = {
  added: number;
  adopted: number;
  updated: number;
  unchanged: number;
  held: number;
  future: number;
  events: number;
  notes: number;
  dates: string[];
  issues: Issue[];
  completed: boolean;
  at: string;
};
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const normalizeName = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
// Match either an exact full name or its first-name/last-initial abbreviation.
// An abbreviation never establishes which of two people with the same initials is meant;
// callers must reject multiple matching documents.
export const compactName = (s: string) => {
  const parts = normalizeName(s).split(" ");
  return parts.length > 1 ? parts[0] + parts.at(-1)![0] : undefined;
};
export const namesMatch = (a: string, b: string) =>
  normalizeName(a) === normalizeName(b) ||
  (compactName(a) !== undefined && compactName(a) === normalizeName(b)) ||
  (compactName(b) !== undefined && compactName(b) === normalizeName(a));
// Tags are exact normalized headings, never first-name/last-initial aliases.
export function broadcastRole(
  heading: string,
  tags: BroadcastTags,
): RecipientRole | undefined {
  return (["teacher", "student"] as const).find(
    (role) =>
      tags[role] && normalizeName(tags[role]) === normalizeName(heading),
  );
}
export function validateBroadcastTags(value: unknown): BroadcastTags {
  if (
    value !== undefined &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    throw Error("Broadcast tags must contain teacher and student headings.");
  const tags: BroadcastTags = { teacher: "", student: "" };
  for (const role of ["teacher", "student"] as const) {
    const tag = (value as Partial<BroadcastTags> | undefined)?.[role] ?? "";
    if (
      typeof tag !== "string" ||
      tag.length > 100 ||
      /[:\r\n\u2028\u2029]/u.test(tag)
    )
      throw Error(
        "Use broadcast tags of at most 100 characters, without colons or line breaks. Enter only the heading, not :-.",
      );
    tags[role] = tag.trim();
  }
  if (
    tags.teacher &&
    normalizeName(tags.teacher) === normalizeName(tags.student)
  )
    throw Error("Teacher and student broadcast tags must be different.");
  return tags;
}
export const validPerson = (s: string) =>
  /^[\p{L}\p{M}][\p{L}\p{M}'’.\-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'’.\-]*)+$/u.test(
    s,
  ) || /^[\p{Lu}][\p{L}\p{M}'’.\-]*[\p{Lu}]$/u.test(s);
export const whitespace = (s: string) =>
  s.normalize("NFC").replace(/\s+/gu, " ").trim();
export function schoolYear(date: string, month: number, day: number) {
  const y = Number(date.slice(0, 4));
  const start =
    date.slice(5) >=
    `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      ? y
      : y - 1;
  return `${start}-${start + 1}`;
}
export function validateRollover(month: number, day: number) {
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(2001, month, 0)).getUTCDate()
  )
    throw Error("Choose a valid annual month and day (not 29 February).");
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function revisionOrder(
  a: Revision,
  b: Revision,
): "newer" | "older" | "unknown" {
  const seq = Math.sign(a.sequence - b.sequence);
  const mod =
    a.modified && b.modified
      ? Math.sign(a.modified.localeCompare(b.modified))
      : 0;
  if (seq && mod && seq !== mod) return "unknown";
  if (seq > 0 || mod > 0) return "newer";
  if (seq < 0 || mod < 0) return "older";
  return "unknown";
}
