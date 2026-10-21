import { defineConfig } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = mkdtempSync(join(tmpdir(), "branchlight-browser-"));
process.on("exit", () => rmSync(dataDir, { recursive: true, force: true }));
export default defineConfig({
  testDir: "./ui/test",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      DEMO_MODE: "local",
      LOCAL_DATA_DIR: dataDir,
      PORT: "3001",
      HOST: "127.0.0.1",
    },
  },
});
