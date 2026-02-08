import Link from "next/link";

import { getHealthSnapshot } from "@/lib/health";

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok ? "bg-emerald-200 text-emerald-950" : "bg-amber-200 text-amber-950"
      }`}
    >
      {label}
    </span>
  );
}

function formatLatency(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value} ms`;
}

function formatStatus(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return String(value);
}

function checkLabel(key: keyof Awaited<ReturnType<typeof getHealthSnapshot>>["checks"]) {
  switch (key) {
    case "db":
      return "Neon (DB)";
    case "wipay":
      return "WiPay";
    case "resend":
      return "Resend";
    case "pdfmonkey":
      return "PDFMonkey";
    case "uploadcare":
      return "Uploadcare";
    case "netlify":
      return "Netlify";
    default:
      return String(key);
  }
}

export default async function AdminHealthPage() {
  const snapshot = await getHealthSnapshot();
  const env = snapshot.env;

  const sections = [
    { title: "Core", data: env.core },
    { title: "Payments", data: env.payments },
    { title: "Email", data: env.email },
    { title: "Invoices", data: env.invoices },
    { title: "Uploads", data: env.uploads },
    { title: "Cron", data: env.cron },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Health</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Readiness snapshot for database, providers, and required environment variables.
          </p>
          <p className="mt-2 text-xs text-[var(--ccr-muted)]">
            Updated: <span className="font-semibold text-[var(--ccr-text)]">{snapshot.timestamp}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge ok={snapshot.ok} label={snapshot.ok ? "Runtime OK" : "Runtime Issues"} />
          <Badge
            ok={snapshot.goLiveReady}
            label={snapshot.goLiveReady ? "Go-live Ready" : "Not Go-live Ready"}
          />
          <a
            href="/api/health/ready"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            View JSON
          </a>
        </div>
      </div>

      {env.notes.length ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Notes</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {env.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Checks</p>
          <dl className="mt-4 space-y-3 text-sm">
            {(
              Object.keys(snapshot.checks) as Array<
                keyof Awaited<ReturnType<typeof getHealthSnapshot>>["checks"]
              >
            ).map((key) => {
              const check = snapshot.checks[key];
              const extra =
                key === "netlify"
                  ? (() => {
                      const netlify = snapshot.checks.netlify;
                      return [netlify.configured ? "netlify" : "local", netlify.context, netlify.deployUrl]
                        .filter(Boolean)
                        .join(" · ");
                    })()
                  : [
                      check.configured === false ? "not configured" : check.configured ? "configured" : null,
                      formatStatus(check.status),
                      formatLatency(check.latencyMs),
                    ]
                      .filter((value) => value && value !== "—")
                      .join(" · ");

              return (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--ccr-muted)]">{checkLabel(key)}</dt>
                  <dd className="flex items-center gap-2 font-semibold text-[var(--ccr-text)]">
                    {check.ok ? "OK" : "FAIL"}{" "}
                    {extra ? <span className="text-xs text-[var(--ccr-muted)]">{extra}</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>

          {Object.values(snapshot.checks).some((check) => Boolean(check.error)) ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-muted)]">
              <p className="font-semibold text-[var(--ccr-text)]">Errors</p>
              <ul className="mt-2 space-y-1">
                {(
                  Object.keys(snapshot.checks) as Array<
                    keyof Awaited<ReturnType<typeof getHealthSnapshot>>["checks"]
                  >
                ).map((key) => {
                  const check = snapshot.checks[key];
                  if (!check.error) return null;
                  return <li key={key}>{checkLabel(key)}: {check.error}</li>;
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Environment</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {sections.map((section) => {
              const missing = section.data.missing;
              const invalid = section.data.invalid;
              const ok = missing.length === 0 && invalid.length === 0;
              return (
                <div
                  key={section.title}
                  className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--ccr-text)]">{section.title}</p>
                    <Badge ok={ok} label={ok ? "OK" : "Needs attention"} />
                  </div>
                  {ok ? (
                    <p className="mt-2 text-xs text-[var(--ccr-muted)]">All required values are present.</p>
                  ) : (
                    <div className="mt-3 space-y-2 text-xs text-[var(--ccr-muted)]">
                      {missing.length ? (
                        <div>
                          <p className="font-semibold text-[var(--ccr-text)]">Missing</p>
                          <ul className="mt-1 list-disc pl-5">
                            {missing.map((key) => (
                              <li key={key}>{key}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {invalid.length ? (
                        <div>
                          <p className="font-semibold text-[var(--ccr-text)]">Invalid</p>
                          <ul className="mt-1 list-disc pl-5">
                            {invalid.map((msg) => (
                              <li key={msg}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--ccr-muted)]">
              Tip: use <span className="font-semibold text-[var(--ccr-text)]">.env.example</span> as the reference list.
            </p>
            <Link
              href="/admin/documentation"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              View documentation
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
