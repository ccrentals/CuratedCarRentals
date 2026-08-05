import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { ADMIN_MEDIA_SOURCES, filterAdminMediaItems, loadAdminMediaItems, type AdminMediaItem, type AdminMediaSource } from "@/lib/uploads/adminMedia";

const PAGE_SIZE = 24;

type Deps = {
  requireAdmin: typeof requireAdminRole;
  load: typeof loadAdminMediaItems;
};

const DEFAULT_DEPS: Deps = { requireAdmin: requireAdminRole, load: loadAdminMediaItems };

function normalizeSource(value: string | null): AdminMediaSource {
  return ADMIN_MEDIA_SOURCES.includes(value as AdminMediaSource) ? value as AdminMediaSource : "inspections";
}

function normalizePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function uniqueOptions(items: AdminMediaItem[], value: (item: AdminMediaItem) => string, label: (item: AdminMediaItem) => string) {
  const options = new Map<string, string>();
  for (const item of items) {
    const key = value(item);
    if (key && !options.has(key)) options.set(key, label(item));
  }
  return [...options.entries()].map(([key, optionLabel]) => ({ value: key, label: optionLabel })).sort((left, right) => left.label.localeCompare(right.label));
}

function toSafeItem(item: AdminMediaItem) {
  return {
    id: item.id,
    source: item.source,
    sourceLabel: item.sourceLabel,
    title: item.title,
    fileName: item.fileName,
    previewUrl: item.previewUrl,
    vehicleId: item.vehicleId,
    vehiclePublicId: item.vehiclePublicId,
    vehicleLabel: item.vehicleLabel,
    bookingId: item.bookingId,
    bookingPublicId: item.bookingPublicId,
    category: item.category,
    categoryLabel: item.categoryLabel,
    subtype: item.subtype,
    subtypeLabel: item.subtypeLabel,
    uploadedBy: item.uploadedBy,
    createdAt: item.createdAt,
    isPrimary: item.isPrimary,
    canRemoveAtSource: item.canRemove,
  };
}

export async function handleAdminMediaGet(request: Request, deps: Deps = DEFAULT_DEPS) {
  const auth = await deps.requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const source = normalizeSource(searchParams.get("source"));
  const requestedPage = normalizePage(searchParams.get("page"));
  const settled = await Promise.allSettled(ADMIN_MEDIA_SOURCES.map((entry) => deps.load(entry)));
  const itemsBySource = new Map<AdminMediaSource, AdminMediaItem[]>();
  const warnings: string[] = [];

  settled.forEach((result, index) => {
    const key = ADMIN_MEDIA_SOURCES[index];
    if (result.status === "fulfilled") itemsBySource.set(key, result.value);
    else {
      itemsBySource.set(key, []);
      warnings.push(`${key} could not be loaded.`);
    }
  });

  const sourceItems = itemsBySource.get(source) ?? [];
  const filtered = filterAdminMediaItems(sourceItems, {
    query: searchParams.get("q") ?? "",
    vehicleId: searchParams.get("vehicleId") ?? "",
    category: searchParams.get("category") ?? "",
    subtype: searchParams.get("subtype") ?? "",
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    sort: searchParams.get("sort") === "oldest" ? "oldest" : "newest",
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  const items = filtered.slice(offset, offset + PAGE_SIZE);

  return NextResponse.json({
    ok: true,
    source,
    items: items.map(toSafeItem),
    counts: Object.fromEntries(ADMIN_MEDIA_SOURCES.map((entry) => [entry, itemsBySource.get(entry)?.length ?? 0])),
    totalCount: filtered.length,
    page,
    totalPages,
    from: filtered.length ? offset + 1 : 0,
    to: filtered.length ? offset + items.length : 0,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    options: {
      vehicles: uniqueOptions(sourceItems, (item) => item.vehicleId, (item) => item.vehicleLabel),
      categories: uniqueOptions(sourceItems, (item) => item.category, (item) => item.categoryLabel),
      subtypes: uniqueOptions(sourceItems, (item) => item.subtype, (item) => item.subtypeLabel),
    },
    warnings,
  });
}

export async function GET(request: Request) {
  return handleAdminMediaGet(request);
}
