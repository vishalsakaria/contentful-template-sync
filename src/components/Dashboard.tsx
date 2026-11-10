"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardData, TargetRow, TargetStatus, VersionRow } from "@/lib/dashboard-data";
import { applyPreview, parsePreview } from "@/lib/preview";
import { ChangeDiff } from "./ChangeDiff";
import { Pipeline } from "./Pipeline";
import { TraceView } from "./TraceView";
import type { Trace } from "@/lib/trace-types";

const POLL_MS = 5000;

/* ---------- small helpers ---------- */

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLE: Record<TargetStatus, { label: string; cls: string; dot: string }> = {
  "up-to-date": { label: "Up to date", cls: "bg-ok-bg text-ok", dot: "bg-ok" },
  behind: { label: "Behind", cls: "bg-warn-bg text-warn", dot: "bg-warn" },
  held: { label: "Held", cls: "bg-hold-bg text-hold", dot: "bg-hold" },
  conflict: { label: "Conflict", cls: "bg-bad-bg text-bad", dot: "bg-bad" },
  installing: { label: "Installing", cls: "bg-info-bg text-info", dot: "bg-info animate-pulse" },
  failed: { label: "Failed", cls: "bg-bad-bg text-bad", dot: "bg-bad" },
};

function StatusBadge({ status }: { status: TargetStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function ClassBadge({ value }: { value: VersionRow["classification"] }) {
  const map = {
    initial: ["Initial", "bg-info-bg text-info"],
    none: ["No change", "bg-line/50 text-muted"],
    additive: ["Additive", "bg-ok-bg text-ok"],
    breaking: ["Breaking", "bg-bad-bg text-bad"],
  } as const;
  const [label, cls] = map[value];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

/* ---------- main component ---------- */

export function Dashboard({
  initial,
  initialError,
  templateParam,
  previewParam,
}: {
  initial: DashboardData | null;
  initialError: string | null;
  templateParam?: string;
  previewParam?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const router = useRouter();
  const templateId = templateParam ?? initial?.template.id;
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<{ kind: "ok" | "info" | "bad"; text: string; withTrace?: boolean } | null>(null);
  const [tab, setTab] = useState<"overview" | "trace">("overview");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [tracing, setTracing] = useState(false);
  const inFlight = useRef(false);
  const lastVersion = useRef<number | null>(initial?.template.latestVersion ?? null);
  const [replayKey, setReplayKey] = useState(0);
  const preview = parsePreview(previewParam);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/status${templateId ? `?t=${encodeURIComponent(templateId)}` : ""}`, { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      // a newer template version just landed -> replay the flow animation
      if (lastVersion.current !== null && json.template.latestVersion > lastVersion.current) {
        setReplayKey((k) => k + 1);
      }
      lastVersion.current = json.template.latestVersion;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      inFlight.current = false;
    }
  }, [templateId, router]);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function runSync() {
    setSyncing(true);
    setBanner(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const json = await res.json();
      const first = json.results?.[0];
      if (!res.ok || !first) throw new Error(json.error ?? "Sync failed");
      if (json.trace) setTrace(json.trace);
      if ("error" in first) setBanner({ kind: "bad", text: `Sync failed: ${first.error}` });
      else if (first.sync.status === "updated") {
        const r = first.rollout;
        const tail = r ? (r.held ? " Rollout held for review." : ` Rolled out to ${r.results.length} environment(s).`) : "";
        setBanner({
          kind: "ok",
          withTrace: true,
          text: `Template updated to v${first.sync.toVersion} (${first.sync.classification?.classification}).${tail}`,
        });
      } else setBanner({ kind: "info", withTrace: true, text: "Template already matches the source model — nothing to do." });
      await refresh();
    } catch (e) {
      setBanner({ kind: "bad", text: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  async function runTrace() {
    setTracing(true);
    try {
      const res = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const json = await res.json();
      if (!res.ok || !json.trace) throw new Error(json.error ?? "Trace failed");
      setTrace(json.trace);
    } catch (e) {
      setBanner({ kind: "bad", text: e instanceof Error ? e.message : "Trace failed" });
    } finally {
      setTracing(false);
    }
  }

  function openTab(next: "overview" | "trace") {
    setTab(next);
    if (next === "trace" && !trace && !tracing) void runTrace();
  }

  async function install(t: TargetRow) {
    const key = `${t.spaceId}/${t.environmentId}`;
    setInstalling((s) => new Set(s).add(key));
    setBanner(null);
    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, spaceId: t.spaceId, environmentId: t.environmentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Install failed");
      if (json.trace) setTrace(json.trace);
      const r = json.result;
      if (r.outcome === "installed") setBanner({ kind: "ok", text: `Installing v${r.toVersion} into ${t.spaceName} / ${t.environmentId}…` });
      else if (r.outcome === "conflict")
        setBanner({ kind: "bad", text: `Conflict in ${t.spaceName}: ${r.findings?.map((f: { message: string }) => f.message).join(", ")}` });
      else if (r.outcome === "failed") setBanner({ kind: "bad", text: `Install failed: ${r.error}` });
      await refresh();
    } catch (e) {
      setBanner({ kind: "bad", text: e instanceof Error ? e.message : "Install failed" });
    } finally {
      setInstalling((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  }

  const shown = data ? applyPreview(data, preview) : null;
  const behind = shown?.targets.filter((t) => t.status !== "up-to-date").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* top bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
              <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
              <path d="M21 3v5h-5M3 21v-5h5" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-ink">Template Sync</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          Live · refreshing every {POLL_MS / 1000}s
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-bad/30 bg-bad-bg px-4 py-3 text-sm text-bad">
          Couldn’t load from Contentful: {error}
        </div>
      )}

      {!data && !error && (
        <div className="grid place-items-center py-24 text-muted">
          <Spinner />
        </div>
      )}

      {data && (
        <>
          {data.templateIds.length > 1 && (
            <div className="mb-4 flex gap-1 border-b border-line">
              {data.templateIds.map((id) => (
                <Link
                  key={id}
                  href={`/?t=${encodeURIComponent(id)}`}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    id === data.template.id ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {id}
                </Link>
              ))}
            </div>
          )}

          {/* header card */}
          <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Content model template</p>
                <h1 className="mt-0.5 text-2xl font-semibold text-ink">{data.template.name}</h1>
                {data.template.description && <p className="mt-1 max-w-xl text-sm text-muted">{data.template.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span>
                    <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">v{data.template.latestVersion}</span>{" "}
                    <span className="text-ink">{data.template.latestVersionName}</span>
                  </span>
                  <span>Created {ago(data.template.latestAt, now)}</span>
                  <span>
                    Source <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{data.sourceLabel}</code>
                  </span>
                  <span>
                    Mode <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{data.mode}</code>
                  </span>
                </div>
              </div>
              <button
                onClick={runSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-60"
              >
                {syncing && <Spinner />}
                {syncing ? "Syncing…" : "Run sync now"}
              </button>
            </div>
            {banner && (
              <div
                className={`mt-4 rounded-md px-3 py-2 text-sm ${
                  banner.kind === "ok" ? "bg-ok-bg text-ok" : banner.kind === "bad" ? "bg-bad-bg text-bad" : "bg-info-bg text-info"
                }`}
              >
                {banner.text}
                {banner.withTrace && trace && (
                  <button onClick={() => openTab("trace")} className="ml-2 font-medium underline">
                    View API trace →
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
            {(
              [
                ["overview", "Overview"],
                ["trace", "API trace"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => openTab(id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                  tab === id ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {label}
                {id === "trace" && trace && <span className="ml-1.5 rounded-full bg-line/60 px-1.5 py-px text-[10px] text-muted">{trace.summary.calls}</span>}
              </button>
            ))}
          </div>

          {tab === "trace" && (
            <div className="mt-6">
              <TraceView trace={trace} tracing={tracing} onRun={runTrace} />
            </div>
          )}

          {tab === "overview" && (
            <>
          {preview && (
            <div className="mt-4 rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn">
              Preview mode — the flow below shows <b>simulated</b> “{preview}” state. Nothing is being written.{" "}
              <Link href="/" className="underline">
                Exit preview
              </Link>
            </div>
          )}

          <div className="mt-6 space-y-6">
            <Pipeline data={shown!} now={now} replayKey={replayKey} onReplay={() => setReplayKey((k) => k + 1)} />
            <ChangeDiff diff={shown!.diff} replayKey={replayKey} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            {/* targets */}
            <section className="rounded-lg border border-line bg-white shadow-sm lg:col-span-3">
              <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="text-sm font-semibold text-ink">Target environments</h2>
                <span className="text-xs text-muted">
                  {shown!.targets.length === 0 ? "None installed" : behind === 0 ? "All up to date" : `${behind} need attention`}
                </span>
              </header>
              {shown!.targets.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted">This template isn’t installed in any environment yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr className="border-b border-line">
                        <th className="px-5 py-2 font-medium">Space</th>
                        <th className="px-3 py-2 font-medium">Env</th>
                        <th className="px-3 py-2 font-medium">Installed</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {shown!.targets.map((t) => {
                        const key = `${t.spaceId}/${t.environmentId}`;
                        const canInstall = ["behind", "held", "failed"].includes(t.status);
                        const busy = installing.has(key);
                        return (
                          <tr key={key} className="border-b border-line/60 last:border-0 align-top">
                            <td className="px-5 py-3">
                              <div className="font-medium text-ink">{t.spaceName}</div>
                              <div className="font-mono text-xs text-muted">{t.spaceId}</div>
                            </td>
                            <td className="px-3 py-3 font-mono text-xs">{t.environmentId}</td>
                            <td className="px-3 py-3 font-mono text-xs">v{t.installedVersion}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={t.status} />
                              {t.note && <div className="mt-1 max-w-[16rem] text-xs text-muted">{t.note}</div>}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {canInstall && (
                                <button
                                  onClick={() => install(t)}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:border-brand hover:text-brand disabled:opacity-60"
                                >
                                  {busy && <Spinner />}
                                  Install latest
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* versions */}
            <section className="rounded-lg border border-line bg-white shadow-sm lg:col-span-2">
              <header className="border-b border-line px-5 py-3.5">
                <h2 className="text-sm font-semibold text-ink">Version history</h2>
              </header>
              <ol className="max-h-[32rem] divide-y divide-line/60 overflow-y-auto">
                {shown!.versions.map((v) => (
                  <li key={v.version} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-ink">v{v.version}</span>
                        <ClassBadge value={v.classification} />
                      </div>
                      <span className="text-xs text-muted">{ago(v.at, now)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{v.versionName}</div>
                    {v.changes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {v.changes.slice(0, 4).map((c, i) => (
                          <li key={i} className={c.kind === "breaking" ? "text-bad" : "text-ink/80"}>
                            {c.kind === "breaking" ? "▲" : "＋"} {c.contentTypeId}: {c.detail}
                          </li>
                        ))}
                        {v.changes.length > 4 && <li className="text-muted">…and {v.changes.length - 4} more</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
