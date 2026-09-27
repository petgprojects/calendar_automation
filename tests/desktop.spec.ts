import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, event, files, brenda, readDoc } from "./helpers";

test("broadcast settings migrate from an older profile, validate, persist and deliver from the UI", async () => {
  const w = await workspace(true);
  const userData = path.join(w.root, "app-data");
  await fs.mkdir(userData);
  // Older profiles have no broadcastTags property.
  await fs.writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify(w.settings),
  );
  await w.write(event("All learners :- Shared from the desktop"));
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      ...(process.env.CALENDAR_NOTES_APP
        ? { executablePath: process.env.CALENDAR_NOTES_APP, args: [] }
        : { args: ["."] }),
      env: { ...process.env, CALENDAR_NOTES_USER_DATA: userData },
    });
  try {
    app = await launch();
    const page = await app.firstWindow();
    const update = page.getByRole("button", {
      name: "Update now",
      exact: true,
    });
    await expect(update).toBeEnabled();
    await page.locator("#setup-title").click();
    const teacher = page.getByLabel("All teachers tag", { exact: true });
    const student = page.getByLabel("All students tag", { exact: true });
    await expect(teacher).toHaveValue("");
    await expect(student).toHaveValue("");
    await teacher.fill("All learners");
    await student.fill(" ALL   LEARNERS ");
    await expect(update).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Confirm date and save settings",
        exact: true,
      })
      .click();
    await expect(page.locator("#error")).toContainText("must be different");
    await expect(update).toBeDisabled();
    await teacher.fill("@staff");
    await student.fill("All learners");
    await page
      .getByRole("button", {
        name: "Confirm date and save settings",
        exact: true,
      })
      .click();
    await expect(update).toBeEnabled();
    const saved = JSON.parse(
      await fs.readFile(path.join(userData, "settings.json"), "utf8"),
    );
    expect(saved.broadcastTags).toEqual({
      teacher: "@staff",
      student: "All learners",
    });
    await update.click();
    await expect(page.locator("#status")).toContainText("4 added", {
      timeout: 30000,
    });
    await expect(page.locator("#status")).toContainText("0 review items");
    for (const file of files) {
      const rows = (await readDoc(w.folder, file))
        .rows()
        .filter((r) => !r.blank);
      expect(rows.map((r) => r.text)).toEqual(
        file === brenda ? [] : ["Shared from the desktop"],
      );
    }
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator("#teacher-tag")).toHaveValue("@staff");
    await expect(restored.locator("#student-tag")).toHaveValue("All learners");
    await restored
      .getByRole("button", { name: "Update now", exact: true })
      .click();
    await expect(restored.locator("#status")).toContainText("4 unchanged", {
      timeout: 30000,
    });
    await expect(restored.locator("#status")).toContainText("0 review items");
    await restored.locator("#setup-title").click();
    await restored.getByLabel("All students tag", { exact: true }).fill("");
    await restored
      .getByRole("button", {
        name: "Confirm date and save settings",
        exact: true,
      })
      .click();
    await expect(
      restored.getByRole("button", { name: "Update now", exact: true }),
    ).toBeEnabled();
    expect(
      JSON.parse(
        await fs.readFile(path.join(userData, "settings.json"), "utf8"),
      ),
    ).toHaveProperty("broadcastTags.student", "");
  } finally {
    await app?.close();
    await w.cleanup();
  }
});

test("real desktop setup, offline import, review choices, keyboard controls and remembered settings", async () => {
  const w = await workspace();
  const userData = path.join(w.root, "app-data");
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      ...(process.env.CALENDAR_NOTES_APP
        ? { executablePath: process.env.CALENDAR_NOTES_APP, args: [] }
        : { args: ["."] }),
      env: { ...process.env, CALENDAR_NOTES_USER_DATA: userData },
    });
  try {
    app = await launch();
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("heading", { name: "Calendar Notes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Update now", exact: true }),
    ).toBeDisabled();
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = (async (_window: unknown, options: any) => ({
          canceled: false,
          filePaths: [
            options.title.includes("calendar") ? paths.ics : paths.folder,
          ],
        })) as any;
      },
      { ics: w.settings.icsPath, folder: w.folder },
    );
    await page
      .getByRole("button", { name: "Choose calendar file…", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Choose notes folder…", exact: true })
      .click();
    await page.getByLabel("Month", { exact: true }).focus();
    await page.keyboard.press("s");
    await page.getByLabel("Month", { exact: true }).selectOption("9");
    await page
      .getByRole("button", {
        name: "Confirm date and save settings",
        exact: true,
      })
      .click();
    const update = page.getByRole("button", {
      name: "Update now",
      exact: true,
    });
    await expect(update).toBeEnabled();
    await expect(page.locator("#year-examples")).toContainText("2025-2026");
    await page.context().setOffline(true);
    await update.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#status")).toContainText("5 linked/kept", {
      timeout: 30000,
    });
    await expect(page.locator("#reviews article")).toHaveCount(3);
    await fs.mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: "artifacts/desktop-review.png",
      fullPage: true,
    });
    for (let count = 3; count > 0; count--) {
      await page
        .getByRole("button", { name: "Keep Word version", exact: true })
        .first()
        .click();
      await expect(page.locator("#reviews article")).toHaveCount(count - 1);
    }
    await expect(page.locator("#status")).toContainText("0 review items");
    await update.click();
    await expect(page.locator("#status")).toContainText("8 unchanged");
    const size = await update.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(52);
    expect(errors).toEqual([]);
    const network = await page.evaluate(async () => {
      try {
        await fetch("https://example.invalid");
        return "allowed";
      } catch {
        return "blocked";
      }
    });
    expect(network).toBe("blocked");
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator("#ics-path")).toHaveText(w.settings.icsPath);
    await expect(
      restored.getByRole("button", { name: "Update now", exact: true }),
    ).toBeEnabled();
    await restored
      .getByRole("button", { name: "Update now", exact: true })
      .click();
    await expect(restored.locator("#status")).toContainText("8 unchanged");
    await restored.screenshot({
      path: "artifacts/desktop-complete.png",
      fullPage: true,
    });
  } finally {
    await app?.close();
    await w.cleanup();
  }
});
