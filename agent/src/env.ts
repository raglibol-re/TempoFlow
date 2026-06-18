/** Loads the repo-root .env before any module that reads env. Import FIRST. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
