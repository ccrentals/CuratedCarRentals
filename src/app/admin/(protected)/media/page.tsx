import { CarFront, ClipboardCheck, FileImage, Images, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { AdminMediaRemoveButton } from "@/components/admin/AdminMediaRemoveButton";
import { buttonStyles } from "@/components/ui/Button";
import { isAdminRole } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import {
  ADMIN_MEDIA_SOURCES,
  filterAdminMediaItems,
  loadAdminMediaItems,
  type AdminMediaItem,
  type AdminMediaSource,
} from "@/lib/uploads/adminMedia";

const PAGE_SIZE = 24;

const INSPECTION_CATEGORY_OPTIONS = [
  ["EXTERIOR", "Exterior"],
  ["INTERIOR", "Interior"],
  ["ODOMETER", "Odometer"],
  ["FUEL_GAUGE", "Fuel gauge"],
  ["DAMAGE", "Damage"],
  ["OTHER", "Other"],
] as const;

const INSPECTION_TYPE_OPTIONS = [
  ["PICKUP", "Pickup"],
  ["RETURN", "Return"],
] as const;

const VEHICLE_GALLERY_OPTIONS = [
  ["PRIMARY", "Primary"],
  ["GALLERY", "Gallery"],
] as const;

const SOURCE_CONFIG: Record<
  AdminMediaSource,
  {
    label: string;
    description: string;
    categoryLabel: string;
    subtypeLabel: string;
    icon: typeof Images;
  }
> = {
  inspections: {
    label: "Vehicle Inspections",
    description: "Pickup and return inspection evidence grouped by inspection category.",
    categoryLabel: "Image category",
    subtypeLabel: "Inspection type",
    icon: ClipboardCheck,
  },
  vehicles: {
    label: "Vehicles",
    description: "Primary and gallery images currently assigned to active vehicle records.",
    categoryLabel: "Gallery role",
    subtypeLabel: "Vehicle status",
    icon: CarFront,
  },
  "vehicle-files": {
    label: "Vehicle Files",
    description: "Image files uploaded through vehicle files, checklists, and maintenance records.",
    categoryLabel: "Folder",
    subtypeLabel: "Document type",
    icon: FileImage,
  },
};

function firstParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function normalizeSource(value: string): AdminMediaSource {
  return ADMIN_MEDIA_SOURCES.includes(value as AdminMediaSource)
    ? (value as AdminMediaSource)
    : "inspections";
}

function parsePage(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function tabHref(source: AdminMediaSource) {
  return `/admin/media?source=${encodeURIComponent(source)}`;
}

function pageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  if (page <= 1) next.delete("page");
  else next.set("page", String(page));
  return `/admin/media?${next.toString()}`;
}

function optionValues(
  items: AdminMediaItem[],
  key: "category" | "subtype",
  labelKey: "categoryLabel" | "subtypeLabel",
) {
  const options = new Map<string, string>();
  for (const item of items) {
    if (!options.has(item[key])) options.set(item[key], item[labelKey]);
  }
  return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]));
}

function sourceCategoryOptions(source: AdminMediaSource, items: AdminMediaItem[]) {
  if (source === "inspections") return [...INSPECTION_CATEGORY_OPTIONS];
  if (source === "vehicles") return [...VEHICLE_GALLERY_OPTIONS];
  return optionValues(items, "category", "categoryLabel");
}

function sourceSubtypeOptions(source: AdminMediaSource, items: AdminMediaItem[]) {
  if (source === "inspections") return [...INSPECTION_TYPE_OPTIONS];
  return optionValues(items, "subtype", "subtypeLabel");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-JM", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Jamaica",
  }).format(date);
}

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  if (!isAdminRole(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Media Library</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const rawParams = await searchParams;
  const source = normalizeSource(firstParam(rawParams.source));
  const query = firstParam(rawParams.q).trim();
  const vehicleId = firstParam(rawParams.vehicleId);
  const category = firstParam(rawParams.category);
  const subtype = firstParam(rawParams.subtype);
  const dateFrom = firstParam(rawParams.dateFrom);
  const dateTo = firstParam(rawParams.dateTo);
  const sort = firstParam(rawParams.sort) === "oldest" ? "oldest" : "newest";
  const requestedPage = parsePage(firstParam(rawParams.page));

  const loadResults = await Promise.allSettled(
    ADMIN_MEDIA_SOURCES.map(async (entry) => ({
      source: entry,
      items: await loadAdminMediaItems(entry),
    })),
  );
  const itemsBySource = new Map<AdminMediaSource, AdminMediaItem[]>();
  const errorsBySource = new Map<AdminMediaSource, string>();
  loadResults.forEach((result, index) => {
    const sourceKey = ADMIN_MEDIA_SOURCES[index];
    if (result.status === "fulfilled") {
      itemsBySource.set(sourceKey, result.value.items);
    } else {
      itemsBySource.set(sourceKey, []);
      errorsBySource.set(sourceKey, "Unable to load this media area.");
    }
  });

  const sourceItems = itemsBySource.get(source) ?? [];
  const filteredItems = filterAdminMediaItems(sourceItems, {
    query,
    vehicleId,
    category,
    subtype,
    dateFrom,
    dateTo,
    sort,
  });
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const visibleItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const from = filteredItems.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, filteredItems.length);
  const config = SOURCE_CONFIG[source];
  const vehicles = [...new Map(sourceItems.map((item) => [item.vehicleId, item])).values()].sort(
    (left, right) => left.vehicleLabel.localeCompare(right.vehicleLabel),
  );
  const categories = sourceCategoryOptions(source, sourceItems);
  const subtypes = sourceSubtypeOptions(source, sourceItems);
  const hasFilters = Boolean(query || vehicleId || category || subtype || dateFrom || dateTo || sort === "oldest");

  const currentParams = new URLSearchParams();
  currentParams.set("source", source);
  if (query) currentParams.set("q", query);
  if (vehicleId) currentParams.set("vehicleId", vehicleId);
  if (category) currentParams.set("category", category);
  if (subtype) currentParams.set("subtype", subtype);
  if (dateFrom) currentParams.set("dateFrom", dateFrom);
  if (dateTo) currentParams.set("dateTo", dateTo);
  if (sort === "oldest") currentParams.set("sort", sort);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">Admin</p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold text-[var(--ccr-text)]">
            <Images className="h-7 w-7 text-[var(--ccr-accent)]" aria-hidden="true" />
            Media Library
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ccr-muted)]">
            Review images uploaded through vehicle inspections, vehicle galleries, and vehicle files.
            Existing upload, locking, and storage rules remain unchanged.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-right">
          <p className="text-xs uppercase text-[var(--ccr-muted)]">Total images</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">
            {[...itemsBySource.values()].reduce((sum, items) => sum + items.length, 0)}
          </p>
        </div>
      </header>

      <nav
        aria-label="Media areas"
        className="mt-8 grid gap-2 border-b border-[var(--ccr-border)] pb-3 sm:grid-cols-3"
      >
        {ADMIN_MEDIA_SOURCES.map((entry) => {
          const entryConfig = SOURCE_CONFIG[entry];
          const Icon = entryConfig.icon;
          const active = entry === source;
          return (
            <Link
              key={entry}
              href={tabHref(entry)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors ${
                active
                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{entryConfig.label}</span>
              </span>
              <span className="rounded-full border border-[var(--ccr-border)] px-2 py-0.5 text-xs">
                {itemsBySource.get(entry)?.length ?? 0}
              </span>
            </Link>
          );
        })}
      </nav>

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[var(--ccr-text)]">{config.label}</h2>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">{config.description}</p>
          </div>
          <p className="text-sm text-[var(--ccr-muted)]">
            Showing {from}-{to} of {filteredItems.length}
          </p>
        </div>

        <form
          method="get"
          className="mt-5 grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <input type="hidden" name="source" value={source} />
          <label className="xl:col-span-2">
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">Search</span>
            <span className="relative mt-1 block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ccr-muted)]"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Filename, booking, vehicle, category, uploader"
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] py-2 pl-10 pr-3 text-sm text-[var(--ccr-text)]"
              />
            </span>
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">Vehicle</span>
            <select
              name="vehicleId"
              defaultValue={vehicleId}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All vehicles</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                  {vehicle.vehicleLabel}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">
              {config.categoryLabel}
            </span>
            <select
              name="category"
              defaultValue={category}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All options</option>
              {categories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">
              {config.subtypeLabel}
            </span>
            <select
              name="subtype"
              defaultValue={subtype}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All options</option>
              {subtypes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">From</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={dateFrom}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">To</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={dateTo}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label>
            <span className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">Sort</span>
            <select
              name="sort"
              defaultValue={sort}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2 xl:col-span-4">
            <button
              type="submit"
              className={buttonStyles({ variant: "primary", size: "sm", className: "gap-2" })}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Apply filters
            </button>
            {hasFilters ? (
              <Link href={tabHref(source)} className={buttonStyles({ variant: "outline", size: "sm" })}>
                Clear filters
              </Link>
            ) : null}
          </div>
        </form>

        {errorsBySource.has(source) ? (
          <div
            className="mt-5 rounded-xl border border-[var(--ccr-danger)] bg-[var(--ccr-surface)] p-4 text-sm text-[var(--ccr-danger)]"
            role="alert"
          >
            {errorsBySource.get(source)}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-[var(--ccr-border)] px-6 py-16 text-center">
            <Images className="mx-auto h-8 w-8 text-[var(--ccr-muted)]" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-[var(--ccr-text)]">
              {hasFilters ? "No images match these filters" : "No images uploaded in this area"}
            </h3>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {hasFilters
                ? "Clear or adjust the filters to broaden the results."
                : "Images will appear here after they are uploaded through the existing workflow."}
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => (
              <article
                key={`${item.source}:${item.id}`}
                className="min-w-0 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
              >
                <a
                  href={item.openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-[var(--ccr-bg)]"
                  aria-label={`Open ${item.fileName}`}
                >
                  {/* Existing secure routes and Uploadcare delivery URLs are intentionally preserved. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- sources include authenticated image proxies */}
                  <img
                    src={item.previewUrl}
                    alt=""
                    loading="lazy"
                    className="h-44 w-full object-cover"
                  />
                </a>
                <div className="space-y-3 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-[var(--ccr-accent)]">
                        {item.categoryLabel}
                      </p>
                      <h3 className="mt-1 truncate text-sm font-semibold text-[var(--ccr-text)]" title={item.fileName}>
                        {item.fileName}
                      </h3>
                    </div>
                    {item.isPrimary ? (
                      <span className="shrink-0 rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--ccr-muted)]">
                        Primary
                      </span>
                    ) : null}
                  </div>

                  <dl className="grid gap-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--ccr-muted)]">Vehicle</dt>
                      <dd className="truncate text-right font-medium text-[var(--ccr-text)]">
                        {item.vehicleLabel}
                      </dd>
                    </div>
                    {item.bookingPublicId ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--ccr-muted)]">Booking</dt>
                        <dd className="font-medium text-[var(--ccr-text)]">{item.bookingPublicId}</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--ccr-muted)]">{config.subtypeLabel}</dt>
                      <dd className="text-right font-medium text-[var(--ccr-text)]">{item.subtypeLabel}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--ccr-muted)]">
                        {source === "vehicles" ? "Updated" : "Uploaded"}
                      </dt>
                      <dd className="text-right font-medium text-[var(--ccr-text)]">{formatDate(item.createdAt)}</dd>
                    </div>
                    {item.uploadedBy ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--ccr-muted)]">By</dt>
                        <dd className="truncate text-right font-medium text-[var(--ccr-text)]">
                          {item.uploadedBy}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="flex flex-wrap gap-2 border-t border-[var(--ccr-border)] pt-3">
                    <a
                      href={item.openUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      Open
                    </a>
                    <Link
                      href={item.manageUrl}
                      className={buttonStyles({ variant: "outline", size: "xs" })}
                    >
                      Manage source
                    </Link>
                    {item.canRemove && item.removeUrl && item.removePayload ? (
                      <AdminMediaRemoveButton
                        removeUrl={item.removeUrl}
                        removePayload={item.removePayload}
                        label={item.fileName}
                      />
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            aria-label="Media pagination"
            className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ccr-border)] pt-4"
          >
            <Link
              href={pageHref(currentParams, page - 1)}
              aria-disabled={page <= 1}
              className={buttonStyles({
                variant: "secondary",
                size: "sm",
                className: page <= 1 ? "pointer-events-none opacity-50" : "",
              })}
            >
              Previous
            </Link>
            <span className="text-sm text-[var(--ccr-muted)]">
              Page {page} of {totalPages}
            </span>
            <Link
              href={pageHref(currentParams, page + 1)}
              aria-disabled={page >= totalPages}
              className={buttonStyles({
                variant: "secondary",
                size: "sm",
                className: page >= totalPages ? "pointer-events-none opacity-50" : "",
              })}
            >
              Next
            </Link>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
