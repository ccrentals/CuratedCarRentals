#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";

type ReferenceLine = {
  raw: string;
  filePath: string;
};

const ALLOWED_PREFIXES = ["docs/", "migrations/"] as const;
const ALLOWED_EXACT = new Set(["db/schema.sql", "scripts/check-no-vehicle-finance-refs.ts"]);

function parseReferenceLines(rawOutput: string) {
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map<ReferenceLine>((line) => {
      const [filePath] = line.split(":", 1);
      return { raw: line, filePath };
    });
}

function isAllowedPath(filePath: string) {
  if (ALLOWED_EXACT.has(filePath)) return true;
  return ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function main() {
  let output = "";
  try {
    output = execFileSync("rg", ["vehicle_finance", "-n"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const maybe = error as { status?: number; stdout?: string };
    if (maybe.status === 1) {
      console.log("No vehicle_finance references found.");
      return;
    }

    const stderr = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run ripgrep for vehicle_finance references: ${stderr}`);
  }

  const references = parseReferenceLines(output);
  const disallowed = references.filter((line) => !isAllowedPath(line.filePath));

  if (disallowed.length > 0) {
    console.error("Disallowed vehicle_finance references found:");
    for (const line of disallowed) {
      console.error(`- ${line.raw}`);
    }
    process.exit(1);
  }

  console.log(
    `vehicle_finance references are restricted to allowed paths (${references.length} match(es)).`,
  );
}

main();
