import { fileURLToPath } from "node:url";
import { createContext } from "./context.js";
import { startHttpServer } from "./http.js";
import { PROTOCOL_VERSION, SERVER_INFO } from "./server.js";

export const DEFAULT_DATA_FILE = fileURLToPath(new URL("../data/household.json", import.meta.url));
export const DEFAULT_SEED_FILE = fileURLToPath(new URL("../data/household.example.json", import.meta.url));

const host = process.env["AAG_HOST"] ?? "127.0.0.1";
const port = Number(process.env["AAG_PORT"] ?? 3333);
const dataFile = process.env["AAG_DATA_FILE"] ?? DEFAULT_DATA_FILE;

const ctx = createContext({ dataFile, seedFile: DEFAULT_SEED_FILE });
const running = await startHttpServer(ctx, { host, port });
console.log(`${SERVER_INFO.name} ${SERVER_INFO.version} (MCP ${PROTOCOL_VERSION}) listening at ${running.url}`);
console.log(`household file: ${dataFile}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}
