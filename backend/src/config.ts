import "dotenv/config";
import path from "node:path";
import process from "node:process";

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

const storageRoot = process.env.FILE_STORAGE_ROOT ?? "./storage";

export const config = {
  port: num("PORT", 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  sql: {
    server: process.env.SQL_SERVER ?? "localhost",
    port: num("SQL_PORT", 1433),
    database: process.env.SQL_DATABASE ?? "LimsReview",
    user: process.env.SQL_USER ?? "sa",
    password: process.env.SQL_PASSWORD ?? "",
    options: {
      encrypt: bool("SQL_ENCRYPT", false),
      trustServerCertificate: bool("SQL_TRUST_SERVER_CERTIFICATE", true),
      enableArithAbort: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  },
  storageRoot: path.isAbsolute(storageRoot)
    ? storageRoot
    : path.resolve(process.cwd(), storageRoot),
  maxFileSizeBytes: num("MAX_FILE_SIZE_MB", 32) * 1024 * 1024,
  maxFilesPerReview: num("MAX_FILES_PER_REVIEW", 10),
} as const;
