import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const SHARED_ADMIN_GUARD_PATTERN =
  /\b(requireStaffOrAdminRole|requireAdminRole|requireDeveloperRole|requireAdminApiSession)\b/;

const ADMIN_API_ROUTE_EXEMPTIONS: Record<string, RegExp> = {
  "src/app/api/admin/login/route.ts": /\bcreateSessionToken\b|\bbreak-glass\b/i,
  "src/app/api/admin/logout/route.ts": /\bclearSessionCookie\b/,
  "src/app/api/admin/maintenance/export/route.ts": /\bhandleAdminMaintenanceGet\b/,
  "src/app/api/admin/vehicles/[id]/documents/[docId]/file/route.ts":
    /\bhandleAdminVehicleDocumentDownload\b/,
};

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function walkRouteFiles(relativeDir: string): string[] {
  const absoluteRoot = path.join(process.cwd(), relativeDir);
  const entries = readdirSync(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(relative));
      continue;
    }

    if (entry.isFile() && entry.name === "route.ts") {
      files.push(toPosix(relative));
    }
  }

  return files.sort();
}

test("admin API routes: every route uses shared guard or explicit exemption", () => {
  const adminApiRoutes = walkRouteFiles("src/app/api/admin");
  const missingCoverage: string[] = [];

  for (const routePath of adminApiRoutes) {
    const source = readFileSync(path.join(process.cwd(), routePath), "utf8");
    if (SHARED_ADMIN_GUARD_PATTERN.test(source)) {
      continue;
    }

    const exemptionPattern = ADMIN_API_ROUTE_EXEMPTIONS[routePath];
    if (!exemptionPattern || !exemptionPattern.test(source)) {
      missingCoverage.push(routePath);
    }
  }

  assert.deepEqual(
    missingCoverage,
    [],
    `Admin API routes without shared guard coverage: ${missingCoverage.join(", ")}`,
  );
});

test("admin app route handlers: every route uses shared guard", () => {
  const adminRouteHandlers = walkRouteFiles("src/app/admin");
  const unguarded: string[] = [];

  for (const routePath of adminRouteHandlers) {
    const source = readFileSync(path.join(process.cwd(), routePath), "utf8");
    if (!SHARED_ADMIN_GUARD_PATTERN.test(source)) {
      unguarded.push(routePath);
    }
  }

  assert.deepEqual(unguarded, [], `Admin route handlers without shared guard: ${unguarded.join(", ")}`);
});
