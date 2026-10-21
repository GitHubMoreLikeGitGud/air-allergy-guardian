import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HouseholdSchema, emptyHousehold, type Household } from "./types.js";

// One JSON file holds the whole household. Reads fall back to the seed file, then to an empty household.
export class HouseholdStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly seedPath: string | null = null
  ) {}

  async load(): Promise<Household> {
    const own = await readJson(this.filePath);
    if (own !== undefined) return HouseholdSchema.parse(own);
    if (this.seedPath) {
      const seed = await readJson(this.seedPath);
      if (seed !== undefined) return HouseholdSchema.parse(seed);
    }
    return emptyHousehold();
  }

  async save(household: Household): Promise<void> {
    HouseholdSchema.parse(household);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(household, null, 2) + "\n", "utf8");
    await rename(tmp, this.filePath);
  }

  update(mutate: (household: Household) => Household): Promise<Household> {
    const run = this.queue.then(async () => {
      const next = mutate(await this.load());
      await this.save(next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
