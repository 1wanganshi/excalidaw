// Launch Electron with ELECTRON_RUN_AS_NODE unset, so the main process runs as Electron, not as Node.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, ["."], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

process.exit(result.status ?? 1);
