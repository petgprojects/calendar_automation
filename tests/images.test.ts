import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { samplePng } from "./image-fixture";
import { parseCalendar } from "../src/core/calendar";
import { runImport } from "../src/core/importer";
import { workspace, mandy, event, escapeIcs, readDoc } from "./helpers";
const through = "2026-09-19";
export const imageCalendar = (seq = 0, cid = false) =>
  event("Mandy Turner :- image text", {
    seq,
    extra: `X-ALT-DESC;FMTTYPE=text/html:${escapeIcs(`<p>Mandy Turner :- Before <em>an image</em>.</p><p><img src="${cid ? "cid:picture" : `data:image/png;base64,${samplePng().toString("base64")}`}"/></p><p>After the image.</p>`)}\r\n${cid ? `ATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=image/png;X-CID=picture:${samplePng().toString("base64")}\r\n` : ""}`,
  });
test("synthetic embedded data and CID images preserve order, media, aspect ratio and italic runs", async (t) => {
  for (const cid of [false, true]) {
    const w = await workspace();
    t.after(w.cleanup);
    await w.write(imageCalendar(0, cid));
    const parsed = parseCalendar(
      await fs.readFile(w.settings.icsPath, "utf8"),
      through,
    );
    assert.equal(parsed.issues.length, 0);
    assert.equal(parsed.notes[0].blocks[1][0].image!.width, 320);
    const before = await JSZip.loadAsync(
      await fs.readFile(path.join(w.folder, mandy)),
    );
    const result = await runImport(w.settings, { through });
    assert.equal(result.added, 1);
    assert.equal(result.issues.length, 0);
    const after = await JSZip.loadAsync(
      await fs.readFile(path.join(w.folder, mandy)),
    );
    for (const p of Object.keys(before.files).filter(
      (p) =>
        p.startsWith("word/header") ||
        p.startsWith("word/footer") ||
        p.startsWith("word/media/"),
    )) {
      if (!before.files[p].dir)
        assert.deepEqual(
          await after.file(p)!.async("nodebuffer"),
          await before.file(p)!.async("nodebuffer"),
        );
    }
    const xml = await after.file("word/document.xml")!.async("string");
    assert.match(xml, /<w:i\/>/);
    assert.match(xml, /cx="3048000" cy="1333500"/);
    assert.ok(xml.indexOf("Before ") < xml.indexOf("<w:drawing"));
    assert.ok(xml.indexOf("<w:drawing") < xml.indexOf("After the image."));
    assert.equal((await runImport(w.settings, { through })).unchanged, 1);
    await w.write(
      event("Mandy Turner :- A poorer text-only export.", { seq: 1 }),
    );
    assert.equal(
      (await runImport(w.settings, { through })).issues[0].kind,
      "image",
    );
    assert.ok((await readDoc(w.folder)).rows()[1].images);
  }
});
