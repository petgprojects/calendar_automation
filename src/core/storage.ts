import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { RecordEntry, State, hash } from "./model";
export const META = ".calendar-import";
export const exists = async (p: string) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
export async function syncDirectory(dir: string) {
  try {
    const handle = await fs.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* Windows may not support directory fsync. */
  }
}
export async function atomicWrite(file: string, data: Buffer | string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temp, file);
    try {
      const dir = await fs.open(path.dirname(file), "r");
      await dir.sync();
      await dir.close();
    } catch {
      /* Directory fsync is unavailable on some Windows filesystems. */
    }
  } finally {
    await handle?.close();
    await fs.rm(temp, { force: true });
  }
}
export async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code === "ENOENT" &&
      fallback !== undefined
    )
      return fallback;
    throw Error(
      `Cannot read ${path.basename(file)}. Restore its backup or ask for help; state was not reset.`,
    );
  }
}
export async function assertRegular(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error(
      "Symbolic links and nonregular files are not safe import targets.",
    );
}
export async function assertUnlocked(file: string) {
  const name = path.basename(file),
    dir = path.dirname(file);
  for (const lock of [`~$${name}`, `~$${name.slice(2)}`, `.~lock.${name}#`])
    if (await exists(path.join(dir, lock)))
      throw Error(
        "This document is open or has a Word/LibreOffice lock. Close it in Word/LibreOffice, then update again.",
      );
}
export type Transaction = {
  id: string;
  batch: string;
  file: string;
  beforeHash: string;
  afterHash: string;
  backup: string;
  before: Record<string, RecordEntry | null>;
  after: Record<string, RecordEntry | null>;
  undo?: boolean;
};
export class Store {
  readonly dir: string;
  state: State = { version: 1, sourceId: randomUUID(), records: {} };
  constructor(readonly root: string) {
    this.dir = path.join(root, META);
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = path.join(this.dir, "writer.lock");
    let handle;
    try {
      handle = await fs.open(lock, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const info = await readJson<{ pid: number; host: string }>(lock);
      if (info.host !== hostname())
        throw Error(
          "Another computer owns the notes-folder lock. Use one computer for this folder.",
        );
      let alive = true;
      try {
        process.kill(info.pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw Error("Another update is already running for this folder.");
      await fs.unlink(lock);
      handle = await fs.open(lock, "wx", 0o600);
    }
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, host: hostname() }),
      );
      await handle.sync();
      this.state = await readJson<State>(path.join(this.dir, "state.json"), {
        version: 1,
        sourceId: randomUUID(),
        records: {},
      });
      if (
        this.state.version !== 1 ||
        !this.state.records ||
        !this.state.sourceId
      )
        throw Error("Unsupported import-state format.");
      if (!(await exists(path.join(this.dir, "state.json")))) await this.save();
      await this.recover();
      return await fn();
    } finally {
      await handle.close();
      await fs.rm(lock, { force: true });
    }
  }
  async save() {
    await atomicWrite(
      path.join(this.dir, "state.json"),
      JSON.stringify(this.state, null, 2),
    );
  }
  private patch(records: Record<string, RecordEntry | null>) {
    for (const [key, value] of Object.entries(records)) {
      if (value) this.state.records[key] = value;
      else delete this.state.records[key];
    }
  }
  async recover() {
    const pending = path.join(this.dir, "pending.json");
    if (!(await exists(pending))) return;
    const tx = await readJson<Transaction>(pending);
    const file = await this.target(tx.file);
    const current = hash(await fs.readFile(file));
    if (current === tx.afterHash) {
      this.patch(tx.after);
      await this.save();
      await this.archive(tx);
    } else if (current !== tx.beforeHash)
      throw Error(
        "An interrupted update and a later Word edit need recovery. Originals and backups are preserved in .calendar-import. Ask for help before importing this folder again.",
      );
    await fs.rm(pending, { force: true });
  }
  async target(relative: string) {
    const target = path.resolve(this.root, relative);
    if (!target.startsWith(path.resolve(this.root) + path.sep))
      throw Error("Unsafe document path in state.");
    const real = await fs.realpath(target);
    if (real !== target)
      throw Error("A linked document path is not supported.");
    await assertRegular(target);
    return target;
  }
  private async archive(tx: Transaction) {
    const dir = path.join(this.dir, "transactions");
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, `${tx.id}.json`), JSON.stringify(tx));
  }
  async commit(
    relative: string,
    before: Buffer,
    after: Buffer,
    patch: Record<string, RecordEntry | null>,
    batch: string,
    failpoint?: string,
    undo = false,
  ) {
    const file = await this.target(relative);
    await assertUnlocked(file);
    if (hash(await fs.readFile(file)) !== hash(before))
      throw Error(
        "The document changed during import. Close Word and update again.",
      );
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const backup = path.join("backups", `${id}.docx`);
    await fs.mkdir(path.join(this.dir, "backups"), { recursive: true });
    await atomicWrite(path.join(this.dir, backup), before);
    const old: Record<string, RecordEntry | null> = {};
    for (const key of Object.keys(patch))
      old[key] = this.state.records[key] ?? null;
    const tx: Transaction = {
      id,
      batch,
      file: relative,
      beforeHash: hash(before),
      afterHash: hash(after),
      backup,
      before: old,
      after: patch,
      undo,
    };
    const temp = `${file}.calendar-${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(after);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await atomicWrite(
        path.join(this.dir, "pending.json"),
        JSON.stringify(tx),
      );
      if (failpoint === "before-replace") throw Error("SIMULATED_CRASH");
      await assertUnlocked(file);
      if (hash(await fs.readFile(file)) !== tx.beforeHash)
        throw Error(
          "The document changed just before replacement. Nothing was overwritten.",
        );
      await fs.rename(temp, file);
      await syncDirectory(path.dirname(file));
      if (failpoint === "after-replace") throw Error("SIMULATED_CRASH");
      this.patch(patch);
      await this.save();
      await this.archive(tx);
      await fs.rm(path.join(this.dir, "pending.json"), { force: true });
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async undoLast(): Promise<string[]> {
    return this.locked(async () => {
      const dir = path.join(this.dir, "transactions");
      if (!(await exists(dir)))
        return ["No previous document update to recover."];
      const txs = await Promise.all(
        (await fs.readdir(dir))
          .filter((n) => n.endsWith(".json"))
          .sort()
          .map((n) => readJson<Transaction>(path.join(dir, n))),
      );
      const undone = new Set(
        await readJson<string[]>(path.join(this.dir, "undone.json"), []),
      );
      const last = txs.filter((t) => !t.undo && !undone.has(t.batch)).at(-1);
      if (!last) return ["No unrecovered update remains."];
      const messages: string[] = [];
      for (const tx of txs
        .filter((t) => t.batch === last.batch && !t.undo)
        .reverse()) {
        const file = await this.target(tx.file);
        const current = await fs.readFile(file),
          backup = await fs.readFile(path.join(this.dir, tx.backup));
        if (hash(backup) !== tx.beforeHash)
          throw Error("A recovery backup failed its integrity check.");
        if (hash(current) !== tx.afterHash) {
          const copy = path.join(
            this.dir,
            "backups",
            `recovered-${tx.id}-${path.basename(file)}`,
          );
          await atomicWrite(copy, backup);
          messages.push(`Later edits preserved. Recovery copy: ${copy}`);
        } else {
          await this.commit(
            tx.file,
            current,
            backup,
            tx.before,
            randomUUID(),
            undefined,
            true,
          );
          messages.push(`Recovered: ${tx.file}`);
        }
      }
      undone.add(last.batch);
      await atomicWrite(
        path.join(this.dir, "undone.json"),
        JSON.stringify([...undone]),
      );
      return messages;
    });
  }
}
export type Candidate = { person: string; year: string; file: string };
export async function indexDocuments(root: string): Promise<Candidate[]> {
  const found: Candidate[] = [];
  let count = 0;
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (++count > 20000)
        throw Error(
          "The notes folder contains too many files. Choose a smaller folder.",
        );
      if (
        e.isSymbolicLink() ||
        e.name.startsWith(".") ||
        e.name.startsWith("~$") ||
        /^(backups?|recovered)$/i.test(e.name)
      )
        continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.isFile()) {
        const m =
          /^(.+?)(?:\s*[-–]\s*|\s+)(?:student|teacher)\s+progress\s+note\s+(\d{4})\s*-\s*(\d{4})\.docx$/i.exec(
            e.name,
          );
        if (m && Number(m[3]) === Number(m[2]) + 1)
          found.push({
            person: m[1].trim(),
            year: `${m[2]}-${m[3]}`,
            file: path.relative(root, file),
          });
      }
    }
  };
  await walk(root);
  return found;
}
