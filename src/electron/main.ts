import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runImport, recoverLastUpdate } from "../core/importer";
import { atomicWrite, readJson } from "../core/storage";
import { Choice, Settings, validateRollover } from "../core/model";

if (process.env.CALENDAR_NOTES_USER_DATA)
  app.setPath("userData", path.resolve(process.env.CALENDAR_NOTES_USER_DATA));
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let window: BrowserWindow;
let busy = false;
let settings: Settings = {
  icsPath: "",
  folder: "",
  month: 9,
  day: 1,
  timezone: "source",
  confirmed: false,
};
const page = pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const save = () =>
  atomicWrite(settingsPath(), JSON.stringify(settings, null, 2));
async function exclusive<T>(fn: () => Promise<T>) {
  if (busy) throw Error("An update is already in progress.");
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame?.url !== page) throw Error("Untrusted window.");
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
async function create() {
  window = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 640,
    minHeight: 600,
    title: "Calendar Notes — offline",
    backgroundColor: "#f4f6fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.on("close", (e) => {
    if (busy) {
      e.preventDefault();
      dialog.showMessageBox(window, {
        type: "info",
        message:
          "Please wait for the update to finish before closing Calendar Notes.",
      });
    }
  });
  await window.loadURL(page);
}
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
if (single)
  app.whenReady().then(async () => {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    let settingsError = "";
    try {
      settings = await readJson(settingsPath(), settings);
    } catch (e) {
      settingsError = (e as Error).message;
    }
    // Local file loading only. No authentication, telemetry, publishing, remote images or updates.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          !details.url.startsWith("file:") &&
          !details.url.startsWith("devtools:"),
      }),
    );
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    handle("settings", () => ({ settings, error: settingsError }));
    handle("choose", async (kind: string) =>
      exclusive(async () => {
        if (kind !== "ics" && kind !== "folder") throw Error("Invalid picker.");
        const result = await dialog.showOpenDialog(
          window,
          kind === "ics"
            ? {
                title: "Choose an exported calendar file",
                properties: ["openFile"],
                filters: [{ name: "Exported calendar", extensions: ["ics"] }],
              }
            : {
                title: "Choose the existing notes folder",
                properties: ["openDirectory"],
              },
        );
        if (!result.canceled) {
          if (kind === "ics") settings.icsPath = result.filePaths[0];
          else settings.folder = result.filePaths[0];
          await save();
        }
        return settings;
      }),
    );
    handle("configure", async (value: unknown) =>
      exclusive(async () => {
        const v = value as Partial<Settings>;
        validateRollover(Number(v.month), Number(v.day));
        const timezone = String(v.timezone ?? "source");
        if (timezone !== "source")
          new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        settings = {
          ...settings,
          month: Number(v.month),
          day: Number(v.day),
          timezone,
          confirmed: true,
        };
        await save();
        return settings;
      }),
    );
    handle("update", async (choices: Choice[] = []) =>
      exclusive(async () => {
        if (
          !Array.isArray(choices) ||
          choices.length > 500 ||
          choices.some(
            (c) =>
              !["keep", "use", "separate"].includes(c.action) ||
              typeof c.id !== "string" ||
              typeof c.token !== "string",
          )
        )
          throw Error("Invalid review decision.");
        const report = await runImport(settings, {
          choices,
          onProgress: (message) => window.webContents.send("progress", message),
        });
        settings.lastRun = report.at;
        await save();
        return report;
      }),
    );
    handle("recover", () =>
      exclusive(async () => {
        if (!settings.folder) throw Error("Choose the notes folder first.");
        const answer = await dialog.showMessageBox(window, {
          type: "question",
          buttons: ["Cancel", "Recover last update"],
          defaultId: 0,
          cancelId: 0,
          message: "Recover documents from before the last update?",
          detail:
            "If a document has later edits, those edits are kept and a separate recovery copy is saved. Linked import state is restored with unchanged documents.",
        });
        return answer.response === 1
          ? recoverLastUpdate(settings.folder)
          : ["Recovery cancelled."];
      }),
    );
    handle("show-folder", async () => {
      if (!settings.folder) return;
      const error = await shell.openPath(settings.folder);
      if (error) throw Error(error);
    });
    await create();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void create();
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
