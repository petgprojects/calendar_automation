import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  Blocks,
  Inline,
  RecipientRole,
  hash,
  namesMatch,
  normalizeName,
} from "./model";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const serializer = new XMLSerializer();
export const xml = (n: Node) => serializer.serializeToString(n);
export function parseXml(s: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(s))
    throw Error("DOCX XML entities are not supported.");
  const errors: string[] = [];
  const d = new DOMParser({
    errorHandler: {
      warning: (m) => errors.push(m),
      error: (m) => errors.push(m),
      fatalError: (m) => errors.push(m),
    },
  }).parseFromString(s, "application/xml");
  if (errors.length)
    throw Error(
      "The DOCX contains invalid XML. Open and save a repaired copy in Word.",
    );
  return d;
}
const elements = (n: Element | Document, local: string) =>
  Array.from(n.getElementsByTagNameNS(W, local));
const children = (n: Node, local: string) =>
  Array.from(n.childNodes).filter(
    (x) =>
      x.nodeType === 1 &&
      (x as Element).namespaceURI === W &&
      (x as Element).localName === local,
  ) as Element[];
export function cellText(cell: Element) {
  return elements(cell, "p")
    .map((p) => {
      let text = "";
      const walk = (n: Node) => {
        if (n.nodeType === 1) {
          const e = n as Element;
          if (e.namespaceURI === W && e.localName === "t") {
            text += e.textContent ?? "";
            return;
          }
          if (e.namespaceURI === W && ["br", "cr"].includes(e.localName)) {
            text += "\n";
            return;
          }
          if (e.namespaceURI === W && e.localName === "tab") {
            text += "\t";
            return;
          }
        }
        for (const c of Array.from(n.childNodes)) walk(c);
      };
      walk(p);
      return text;
    })
    .join("\n")
    .trim();
}
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function parseDate(s: string, yearContext = new Date().getFullYear()) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month =
    months.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) + 1;
  let year = Number(m[3]);
  if (m[3].length === 2) {
    year += Math.floor(yearContext / 100) * 100;
    if (year < yearContext - 50) year += 100;
    if (year > yearContext + 50) year -= 100;
  }
  const day = Number(m[2]);
  if (
    !month ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const displayDate = (date: string) =>
  `${months[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}/${Number(date.slice(0, 4)) >= 2000 && Number(date.slice(0, 4)) < 2100 ? date.slice(2, 4) : date.slice(0, 4)}`;
export type Row = {
  element: Element;
  date: string | null;
  text: string;
  markers: string[];
  fingerprint: string;
  blank: boolean;
  images: boolean;
};
export class WordDocument {
  private constructor(
    public zip: JSZip,
    public doc: Document,
    public table: Element,
    public original: Buffer,
    private yearContext?: number,
  ) {}
  static async load(
    buffer: Buffer,
    person?: string | string[],
    yearContext?: number,
    filenamePerson?: string,
    expectedRole?: RecipientRole,
  ) {
    if (buffer.length > 60 * 1024 * 1024)
      throw Error("This DOCX exceeds the 60 MB safety limit.");
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    let total = 0;
    for (const e of Object.values(zip.files)) {
      total += (e as any)._data?.uncompressedSize ?? 0;
    }
    if (total > 150 * 1024 * 1024)
      throw Error("Expanded DOCX exceeds the safety limit.");
    if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml"))
      throw Error("Not a supported Word DOCX package.");
    if (Object.keys(zip.files).some((n) => n.startsWith("_xmlsignatures/")))
      throw Error("Digitally signed Word documents require manual review.");
    const doc = parseXml(await zip.file("word/document.xml")!.async("string"));
    if (elements(doc, "documentProtection").length)
      throw Error("Protected document.");
    const settings = zip.file("word/settings.xml");
    if (
      settings &&
      /documentProtection[^>]*(?:enforcement="(?:1|true)")/.test(
        await settings.async("string"),
      )
    )
      throw Error("This document is protected. Unlock a copy in Word first.");
    const body = elements(doc, "body")[0];
    const tables = children(body, "tbl");
    if (tables.length !== 1)
      throw Error(
        "Expected one date/comments table in the document body. Ask for a supported two-column template.",
      );
    const table = tables[0];
    if (
      elements(table, "tbl").length ||
      [
        "gridSpan",
        "vMerge",
        "sdt",
        "ins",
        "del",
        "fldSimple",
        "fldChar",
        "altChunk",
      ].some((x) => elements(table, x).length)
    )
      throw Error(
        "The notes table contains merged cells, fields, tracked changes or content controls. Review it in Word.",
      );
    if (
      !children(table, "tr").length ||
      children(table, "tr").some((r) => children(r, "tc").length !== 2)
    )
      throw Error("Expected two cells per date/comments row.");
    if (person) {
      const labels: string[] = [];
      for (const name of Object.keys(zip.files).filter((n) =>
        /^word\/(?:header\d+|document)\.xml$/.test(n),
      )) {
        const part = parseXml(await zip.file(name)!.async("string"));
        for (const p of elements(part, "p")) {
          const text = elements(p, "t")
            .map((t) => t.textContent)
            .join("");
          const m = /(Student|Teacher)\s+Name\s*:\s*(.+)/i.exec(text);
          if (m) {
            if (expectedRole && m[1].toLowerCase() !== expectedRole)
              throw Error(
                "The internal Student/Teacher label does not match the filename's recipient group. Correct it before broadcasting.",
              );
            labels.push(normalizeName(m[2]));
          }
        }
      }
      if (
        !labels.length ||
        labels.some(
          (label) =>
            label !== labels[0] ||
            !(Array.isArray(person) ? person : [person]).every((name) =>
              namesMatch(label, name),
            ) ||
            (filenamePerson && !namesMatch(label, filenamePerson)),
        )
      )
        throw Error(
          "The internal Student/Teacher Name does not match the filename or calendar heading. Correct the label, filename or heading before importing.",
        );
    }
    const instance = new WordDocument(zip, doc, table, buffer, yearContext);
    instance.nextDrawingId =
      1 +
      Math.max(
        0,
        ...Array.from(
          doc.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
            "docPr",
          ),
        ).map((e) => Number(e.getAttribute("id")) || 0),
      );
    const rels = zip.file("word/_rels/document.xml.rels");
    if (rels) {
      const relDoc = parseXml(await rels.async("string"));
      for (const r of Array.from(relDoc.documentElement.childNodes).filter(
        (n) => n.nodeType === 1,
      ) as Element[]) {
        const id = r.getAttribute("Id")!,
          target = r.getAttribute("Target") ?? "";
        if (r.getAttribute("Type")?.endsWith("/image")) {
          const part = zip.file("word/" + target.replace(/^\.\//, ""));
          instance.imageHashes.set(
            id,
            part ? hash(await part.async("nodebuffer")) : "unresolved-image",
          );
        }
      }
    }
    let previous = "";
    for (const row of instance.rows()) {
      if (!row.blank && !row.date)
        throw Error(
          "A nonblank row has an unsupported date. Use dates such as Aug 17/26 in the date/comments table.",
        );
      if (row.date && row.date < previous)
        throw Error(
          "Existing dated rows are not chronological. Put them in date order in Word first.",
        );
      if (row.date) previous = row.date;
    }
    return instance;
  }
  rows(): Row[] {
    return children(this.table, "tr").map((element) => {
      const cells = children(element, "tc");
      const dateText = cellText(cells[0]),
        text = cellText(cells[1]);
      const markers = elements(element, "bookmarkStart")
        .map((b) => b.getAttribute("w:name") ?? "")
        .filter((n) => n.startsWith("ca_"));
      const images =
        elements(element, "drawing").length > 0 ||
        elements(element, "pict").length > 0 ||
        elements(element, "object").length > 0;
      // Conservative fingerprint includes formatting as well as text. A Word re-save can cause a safe extra review, never an unnoticed overwrite.
      const clone = element.cloneNode(true) as Element;
      for (const b of [
        ...elements(clone, "bookmarkStart"),
        ...elements(clone, "bookmarkEnd"),
      ])
        b.parentNode?.removeChild(b);
      return {
        element,
        date: parseDate(dateText, this.yearContext),
        text,
        markers,
        fingerprint: hash(
          xml(clone) +
            (images
              ? Array.from(clone.getElementsByTagName("*"))
                  .flatMap((e) =>
                    Array.from(e.attributes)
                      .filter((a) => a.namespaceURI === R)
                      .map((a) => this.imageHashes.get(a.value) ?? a.value),
                  )
                  .join("|")
              : ""),
        ),
        blank:
          !dateText &&
          !text &&
          !images &&
          !markers.length &&
          !elements(element, "bookmarkStart").length,
        images,
      };
    });
  }
  marker(name: string) {
    return this.rows().filter((r) => r.markers.includes(name));
  }
  mark(row: Row, name: string) {
    if (row.markers.includes(name)) return;
    const p = elements(children(row.element, "tc")[0], "p")[0];
    const ids = elements(this.doc, "bookmarkStart")
      .map((e) => Number(e.getAttribute("w:id")))
      .filter(Number.isFinite);
    const id = String(Math.max(0, ...ids) + 1);
    const start = this.el("bookmarkStart");
    start.setAttributeNS(W, "w:id", id);
    start.setAttributeNS(W, "w:name", name);
    const end = this.el("bookmarkEnd");
    end.setAttributeNS(W, "w:id", id);
    p.appendChild(start);
    p.appendChild(end);
  }
  private imageHashes = new Map<string, string>();
  private nextDrawingId = 1;
  private el(local: string) {
    return this.doc.createElementNS(W, `w:${local}`);
  }
  private replaceCell(cell: Element, blocks: Blocks) {
    const oldP = elements(cell, "p")[0];
    const pPr = oldP && children(oldP, "pPr")[0];
    const rPr = oldP && elements(oldP, "rPr")[0];
    for (const n of Array.from(cell.childNodes))
      if (n.nodeType !== 1 || (n as Element).localName !== "tcPr")
        cell.removeChild(n);
    for (const block of blocks) {
      const p = this.el("p");
      if (pPr) {
        const props = pPr.cloneNode(true) as Element;
        for (const tag of ["keepNext", "keepLines", "pageBreakBefore"])
          for (const e of elements(props, tag)) e.parentNode?.removeChild(e);
        p.appendChild(props);
      }
      for (const item of block) {
        const run = this.el("r");
        const props = rPr ? (rPr.cloneNode(true) as Element) : this.el("rPr");
        for (const [key, tag] of [
          ["bold", "b"],
          ["italic", "i"],
          ["underline", "u"],
        ] as const) {
          if (item[key]) {
            const e = this.el(tag);
            if (tag === "u") e.setAttributeNS(W, "w:val", "single");
            props.appendChild(e);
          }
        }
        run.appendChild(props);
        if (item.image) run.appendChild(this.drawing(item.image, cell));
        else {
          const t = this.el("t");
          t.setAttribute("xml:space", "preserve");
          t.appendChild(this.doc.createTextNode(item.text ?? ""));
          run.appendChild(t);
        }
        p.appendChild(run);
      }
      cell.appendChild(p);
    }
    if (!blocks.length) cell.appendChild(this.el("p"));
  }
  write(row: Row, date: string, blocks: Blocks, marker: string) {
    const cells = children(row.element, "tc");
    this.replaceCell(cells[0], [[{ text: displayDate(date) }]]);
    this.replaceCell(cells[1], blocks);
    for (const tag of ["trHeight", "cantSplit"])
      for (const e of elements(row.element, tag)) e.parentNode?.removeChild(e);
    this.mark({ ...row, markers: [] }, marker);
    return this.marker(marker)[0];
  }
  insert(date: string, blocks: Blocks, marker: string) {
    const rows = this.rows();
    let row = rows.find((r) => r.blank);
    if (!row) {
      const el = rows.at(-1)!.element.cloneNode(true) as Element;
      for (const tag of ["bookmarkStart", "bookmarkEnd"])
        for (const n of elements(el, tag)) n.parentNode?.removeChild(n);
      // Cloned rows must not reuse Word paragraph or drawing identities.
      const clean = (n: Element) => {
        for (const a of Array.from(n.attributes))
          if (/paraId|textId|rsid/.test(a.localName)) n.removeAttributeNode(a);
        for (const c of Array.from(n.childNodes))
          if (c.nodeType === 1) clean(c as Element);
      };
      clean(el);
      this.table.appendChild(el);
      row = {
        element: el,
        date: null,
        text: "",
        markers: [],
        fingerprint: "",
        blank: true,
        images: false,
      };
    }
    const before =
      this.rows().find(
        (r) => r.element !== row!.element && r.date && r.date > date,
      ) ?? this.rows().find((r) => r.element !== row!.element && r.blank);
    this.table.removeChild(row.element);
    if (before) this.table.insertBefore(row.element, before.element);
    else this.table.appendChild(row.element);
    return this.write(row, date, blocks, marker);
  }
  private drawing(image: NonNullable<Inline["image"]>, cell: Element) {
    const ext = image.mime === "image/png" ? "png" : "jpg";
    const bytes = Buffer.from(image.base64, "base64");
    const filename = `calendar-${hash(bytes).slice(0, 32)}.${ext}`;
    this.zip.file(`word/media/${filename}`, bytes);
    const relPath = "word/_rels/document.xml.rels";
    let relDoc = this.relations;
    if (!relDoc) throw Error("Image relationships were not initialized.");
    const rels = Array.from(relDoc.documentElement.childNodes).filter(
      (n) => n.nodeType === 1,
    ) as Element[];
    let rel = rels.find(
      (r) => r.getAttribute("Target") === `media/${filename}`,
    );
    let id = rel?.getAttribute("Id");
    if (!id) {
      id = `rIdCalendar${hash(bytes).slice(0, 24)}`;
      if (rels.some((r) => r.getAttribute("Id") === id))
        throw Error("Image relationship collision.");
      rel = relDoc.createElementNS(
        "http://schemas.openxmlformats.org/package/2006/relationships",
        "Relationship",
      );
      rel.setAttribute("Id", id);
      rel.setAttribute("Type", `${R}/image`);
      rel.setAttribute("Target", `media/${filename}`);
      relDoc.documentElement.appendChild(rel);
    }
    this.zip.file(relPath, xml(relDoc));
    this.imageHashes.set(id, hash(bytes));
    const ct = this.contentTypes!;
    if (
      !Array.from(ct.documentElement.childNodes).some(
        (n) =>
          n.nodeType === 1 && (n as Element).getAttribute("Extension") === ext,
      )
    ) {
      const e = ct.createElementNS(ct.documentElement.namespaceURI, "Default");
      e.setAttribute("Extension", ext);
      e.setAttribute("ContentType", image.mime);
      ct.documentElement.appendChild(e);
      this.zip.file("[Content_Types].xml", xml(ct));
    }
    const widthTwips =
      Number(elements(cell, "tcW")[0]?.getAttribute("w:w") ?? 7200) - 240;
    const maxWidth = Math.max(720, widthTwips) * 635;
    const scale = Math.min(
      1,
      maxWidth / (image.width * 9525),
      (7 * 914400) / (image.height * 9525),
    );
    const cx = Math.round(image.width * 9525 * scale),
      cy = Math.round(image.height * 9525 * scale);
    const ids = Array.from(
      this.doc.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        "docPr",
      ),
    ).map((e) => Number(e.getAttribute("id")));
    const drawingId = this.nextDrawingId++;
    const drawing = parseXml(
      `<w:drawing xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="${R}"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="Calendar image ${drawingId}" descr="Image included in calendar note"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${filename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`,
    );
    return this.doc.importNode(drawing.documentElement, true);
  }
  private relations?: Document;
  private contentTypes?: Document;
  async prepareImages() {
    this.relations = parseXml(
      (await this.zip.file("word/_rels/document.xml.rels")?.async("string")) ??
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    this.contentTypes = parseXml(
      await this.zip.file("[Content_Types].xml")!.async("string"),
    );
  }
  async save() {
    this.zip.file("word/document.xml", xml(this.doc));
    return this.zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  }
}
