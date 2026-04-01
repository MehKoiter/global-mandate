#!/usr/bin/env node
// =============================================================
// Global Mandate — Development Startup Script
// Usage: node scripts/dev.js
//
// 1. Ensures PostgreSQL and Redis Windows services are running
// 2. Starts backend (tsx watch) and frontend (vite) concurrently
// =============================================================

import { execSync, spawn } from "child_process";
import { concurrently }    from "concurrently";
import path                from "path";
import { fileURLToPath }   from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const CLIENT    = path.join(ROOT, "src", "client");

// ─── Windows service helpers ───────────────────────────────────

/**
 * Returns true if the named Windows service is currently running.
 * Uses `sc query` which works without elevation.
 */
function isServiceRunning(serviceName) {
  try {
    const out = execSync(`sc query "${serviceName}"`, { stdio: "pipe" }).toString();
    return out.includes("RUNNING");
  } catch {
    return false;
  }
}

/**
 * Attempts to start a Windows service via `net start`.
 * Skips silently if already running; logs a warning if it fails
 * (elevation may be required).
 */
function ensureService(serviceName, displayName) {
  if (isServiceRunning(serviceName)) {
    console.log(`  ✔ ${displayName} already running`);
    return;
  }
  console.log(`  ↑ Starting ${displayName}...`);
  try {
    execSync(`net start "${serviceName}"`, { stdio: "pipe" });
    console.log(`  ✔ ${displayName} started`);
  } catch {
    console.warn(
      `  ⚠ Could not start ${displayName} (service name: "${serviceName}").` +
      `\n    Try running this script as Administrator, or start it manually.`
    );
  }
}

// ─── Service names ─────────────────────────────────────────────
// These are the default service names for common Windows installs.
// Adjust if your installation uses different names.
//
//   PostgreSQL: installer typically registers as "postgresql-x64-<version>"
//               Check yours with: sc query type= all | findstr -i postgres
//   Redis:      Redis for Windows registers as "Redis"

const POSTGRES_SERVICE = process.env.POSTGRES_SERVICE ?? "postgresql-x64-17";
const REDIS_SERVICE    = process.env.REDIS_SERVICE    ?? "Redis";

// ─── Startup ───────────────────────────────────────────────────

console.log("\nGlobal Mandate — dev startup\n");
console.log("Checking services...");
ensureService(POSTGRES_SERVICE, "PostgreSQL");
ensureService(REDIS_SERVICE,    "Redis");
console.log("");

// ─── Concurrently ──────────────────────────────────────────────

const { result } = concurrently(
  [
    {
      command:    "npm run dev:server",
      name:       "backend",
      cwd:        ROOT,
      prefixColor: "blue",
    },
    {
      command:    "npm run dev:timer",
      name:       "timer",
      cwd:        ROOT,
      prefixColor: "yellow",
    },
    {
      command:    "npm run dev",
      name:       "frontend",
      cwd:        CLIENT,
      prefixColor: "green",
    },
  ],
  {
    prefix:            "name",
    killOthersOn:      ["failure", "success"],
    restartTries:      0,
    outputStream:      process.stdout,
  }
);

// Resolve/reject are both handled by concurrently's built-in shutdown.
// This catch prevents an unhandled-rejection warning on Ctrl+C.
result.catch(() => {});
