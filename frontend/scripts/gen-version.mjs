// Генерирует src/version.ts: версия из package.json + id сборки + дата.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
let sha = process.env.APP_BUILD_SHA || "";
if (!sha) {
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    sha = "nogit";
  }
}
const date = new Date().toISOString().slice(0, 10);
const out =
  "// Автогенерируется scripts/gen-version.mjs (prebuild/predev). Не редактировать.\n" +
  `export const APP_VERSION = ${JSON.stringify(pkg.version)};\n` +
  `export const APP_BUILD = ${JSON.stringify(sha)};\n` +
  `export const APP_BUILD_DATE = ${JSON.stringify(date)};\n`;
writeFileSync(new URL("../src/version.ts", import.meta.url), out);
console.log("version.ts:", pkg.version, sha, date);
