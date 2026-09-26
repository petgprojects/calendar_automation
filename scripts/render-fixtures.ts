import fs from "node:fs/promises";
import path from "node:path";
import {
  workspace,
  files,
  mandy,
  brenda,
  event,
  escapeIcs,
} from "../tests/helpers";
import { runImport } from "../src/core/importer";
// Developer-only synthetic image. Supplied ICS fixtures contain no real images.
import { samplePng } from "../tests/image-fixture";
const png = samplePng().toString("base64");
const w = await workspace(true);
const out = path.resolve("artifacts/render-input");
await fs.mkdir(out, { recursive: true });
try {
  const report = await runImport(w.settings, { through: "2026-09-19" });
  if (report.added !== 8) throw Error(JSON.stringify(report));
  for (const file of files)
    await fs.copyFile(path.join(w.folder, file), path.join(out, file));
  const long = Array.from(
    { length: 45 },
    (_, i) =>
      `Paragraph ${i + 1}. This is a deliberately long preservation and pagination test. The user’s wording stays intact, including punctuation and Unicode: café, naïve, —. `,
  ).join("\n\n");
  await w.write(
    event(`Mandy Turner :- ${long}`, { date: "2026-08-19", uid: "long" }),
  );
  await runImport(w.settings, { through: "2026-09-19" });
  await w.write(
    event("Mandy Turner :- repeated", {
      date: "2026-07-01",
      uid: "growth",
      extra: "RRULE:FREQ=DAILY;COUNT=20\r\n",
    }),
  );
  await runImport(w.settings, { through: "2026-09-19" });
  await fs.copyFile(
    path.join(w.folder, mandy),
    path.join(out, "Long-and-grown-student.docx"),
  );
  const html = `<p>Brenda Jones :- Image preservation test with <em>italic wording</em>.</p><p><img src="data:image/png;base64,${png}"/></p><p>Text after embedded image.</p>`;
  await w.write(
    event("Brenda Jones :- image", {
      date: "2026-08-19",
      uid: "image",
      extra: `X-ALT-DESC;FMTTYPE=text/html:${escapeIcs(html)}\r\n`,
    }),
  );
  const r = await runImport(w.settings, { through: "2026-09-19" });
  if (r.added !== 1) throw Error(JSON.stringify(r));
  await fs.copyFile(
    path.join(w.folder, brenda),
    path.join(out, "Image-teacher.docx"),
  );
  console.log(
    JSON.stringify({
      out,
      sample: report.added,
      files: (await fs.readdir(out)).length,
    }),
  );
} finally {
  await w.cleanup();
}
