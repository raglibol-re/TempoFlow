/**
 * Loads the repo-root .env into process.env BEFORE any module that reads env
 * (config.ts, @flow/shared) is evaluated. Import this FIRST in entrypoints.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
