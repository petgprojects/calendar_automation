import { contextBridge, ipcRenderer } from "electron";
const call = async (channel: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld("calendarNotes", {
  settings: () => call("settings"),
  choose: (kind: "ics" | "folder") => call("choose", kind),
  configure: (value: unknown) => call("configure", value),
  update: (choices: unknown[] = []) => call("update", choices),
  recover: () => call("recover"),
  showFolder: () => call("show-folder"),
  onProgress: (callback: (message: string) => void) => {
    ipcRenderer.on("progress", (_event, message: string) => callback(message));
  },
});
