"use client";

import { Fragment, type ReactNode } from "react";
import type { Trace, TraceStep } from "@/lib/trace-types";

/* ---------- tiny JSON highlighter (no dependency) ---------- */

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1] && m[2]) {
      out.push(<span key={i++} className="text-brand">{m[1]}</span>);
      out.push(m[2]);
    } else if (m[1]) out.push(<span key={i++} className="text-ok">{m[1]}</span>);
    else if (m[3]) out.push(<span key={i++} className="text-hold">{m[3]}</span>);
    else out.push(<span key={i++} className="text-warn">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  out.push(json.slice(last));
  return out;
}

function Json({ value, empty }: { value: unknown; empty?: string }) {
  if (value === undefined) {
    return <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">{empty ?? "—"}</p>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-line bg-background p-3 font-mono text-[11px] leading-relaxed text-ink/80">
      {highlight(JSON.stringify(value, null, 2))}
    </pre>
  );
}

function Label({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "brand" | "ok" }) {
  const cls = tone === "brand" ? "text-brand" : tone === "ok" ? "text-ok" : "text-muted";
  return <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{children}</div>;
}

/* ---------- icons / badges ---------- */

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-info-bg text-info",
  PUT: "bg-warn-bg text-warn",
  POST: "bg-hold-bg text-hold",
};

function Arrow({ dir }: { dir: "right" | "left" }) {
  return (
    <svg viewBox="0 0 24 24" className="inline h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {dir === "right" ? <path d="M5 12h14m-6-6 6 6-6 6" /> : <path d="M19 12H5m6-6-6 6 6 6" />}
    </svg>
  );
}

function StatusPill({ s }: { s: TraceStep }) {
  const bad = s.status === "error" || (typeof s.status === "number" && s.status >= 400);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${bad ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok"}`}>
      {s.status}
      {s.ms !== undefined && <span className="opacity-70">· {s.ms}ms</span>}
    </span>
  );
}

const RAIL: Record<TraceStep["kind"], string> = {
  api: "bg-brand text-white",
  map: "bg-hold text-white",
  decision: "bg-ink text-white",
};

/* ---------- step cards ---------- */

function ApiCard({ s }: { s: TraceStep }) {
  const check = s.method === "PUT" && !s.write;
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{s.title}</span>
          {s.write && <span className="rounded bg-bad-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-bad">Writes</span>}
          {check && <span className="rounded bg-line/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Check only</span>}
        </div>
        <StatusPill s={s} />
      </div>
      <div className="mt-2 flex items-start gap-2">
        <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${METHOD_STYLE[s.method ?? "GET"]}`}>{s.method}</span>
        <code className="break-all font-mono text-xs text-ink/80">
          <span className="text-muted">api.contentful.com</span>
          {s.url}
        </code>
      </div>
      {s.error && <p className="mt-2 rounded-md bg-bad-bg px-3 py-2 text-xs text-bad">{s.error}</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <Label tone="brand">
            <Arrow dir="right" /> Sent
          </Label>
          <Json value={s.request} empty="No body (Authorization header not shown)" />
        </div>
        <div>
          <Label tone="ok">
            <Arrow dir="left" /> Received
          </Label>
          <Json value={s.response} empty={s.error ? "No response body" : "—"} />
        </div>
      </div>
    </div>
  );
}

function MapCard({ s }: { s: TraceStep }) {
  return (
    <div className="rounded-lg border border-hold/30 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-hold-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hold">Mapping</span>
        <span className="text-sm font-semibold text-ink">{s.title}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div>
          <Label>From · Contentful content type</Label>
          <Json value={s.from} />
        </div>
        <div className="flex items-center justify-center text-hold md:pt-6">
          <div className="flex rotate-90 md:rotate-0">
            {[0, 1, 2].map((i) => (
              <svg key={i} viewBox="0 0 24 24" className="chevron -mx-1 h-6 w-6" style={{ animationDelay: `${i * 0.18}s` }} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 6 6 6-6 6" />
              </svg>
            ))}
          </div>
        </div>
        <div>
          <Label>To · template shape</Label>
          <Json value={s.to} />
        </div>
      </div>
      {s.notes && (
        <ul className="mt-3 space-y-1 rounded-md bg-hold-bg/50 px-3 py-2 text-xs text-ink/80">
          {s.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-hold">→</span>
              <span>{renderTicks(n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RESULT_STYLE = (r: string) =>
  /breaking|error|held|hold/.test(r)
    ? "bg-bad-bg text-bad"
    : /additive|changed|install|retry/.test(r)
      ? "bg-ok-bg text-ok"
      : "bg-line/50 text-muted";

function DecisionCard({ s }: { s: TraceStep }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Decision</span>
          <span className="text-sm font-semibold text-ink">{s.title}</span>
        </div>
        {s.result && (
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${RESULT_STYLE(s.result)}`}>{s.result}</span>
        )}
      </div>
      {s.notes && (
        <ul className="mt-2 space-y-1 text-xs text-ink/80">
          {s.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted">•</span>
              <span>{renderTicks(n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render `code` spans written with backticks inside notes. */
function renderTicks(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className="rounded bg-background px-1 font-mono text-[11px] text-ink">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/* ---------- the tab ---------- */

const SEQUENCE = [
  ["GET", "Read the template", "the current version and its content types"],
  ["GET", "Read the source content type + editor interface", "from the source space"],
  ["•", "Map → compare → classify", "source model becomes template shape; additive or breaking?"],
  ["PUT", "Create a new template version", "only if something changed (X-Contentful-Version guards it)"],
  ["GET", "List installations", "which spaces/environments have the template"],
  ["PUT", "Validate the version per environment", "conflicts are reported, not forced"],
  ["POST", "Install the version", "into each clean environment, 3 at a time"],
] as const;

export function TraceView({
  trace,
  tracing,
  onRun,
}: {
  trace: Trace | null;
  tracing: boolean;
  onRun: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink">API trace</h2>
            <p className="mt-1 text-sm text-muted">
              Every call the sync makes to Contentful — what was sent, what came back, and how the data was mapped from the source
              model into the template. <b className="font-medium text-ink">Run sync now</b> and <b className="font-medium text-ink">Install latest</b>{" "}
              record their calls here too. Webhook-triggered runs are logged in Vercel instead (the dashboard keeps no history).
            </p>
          </div>
          <button
            onClick={onRun}
            disabled={tracing}
            className="inline-flex items-center gap-2 rounded border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-info-bg disabled:opacity-60"
          >
            {tracing && <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {tracing ? "Tracing…" : "Trace a dry run (read-only)"}
          </button>
        </div>

        {trace && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-2 py-1 font-semibold uppercase tracking-wide ${trace.mode === "dry-run" ? "bg-info-bg text-info" : "bg-warn-bg text-warn"}`}>
              {trace.mode === "dry-run" ? "Dry run · nothing written" : "Live run"}
            </span>
            <Chip>{trace.summary.calls} API calls</Chip>
            <Chip tone={trace.summary.writes > 0 ? "bad" : undefined}>
              {trace.summary.writes} write{trace.summary.writes === 1 ? "" : "s"}
            </Chip>
            <Chip>{(trace.summary.ms / 1000).toFixed(1)}s in Contentful</Chip>
            <Chip>{new Date(trace.startedAt).toLocaleTimeString()}</Chip>
          </div>
        )}
      </section>

      {!trace && !tracing && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-ink">The sequence at a glance</h3>
          <ol className="space-y-2">
            {SEQUENCE.map(([m, t, d], i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className={`w-12 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-bold ${METHOD_STYLE[m] ?? "bg-hold-bg text-hold"}`}>{m}</span>
                <span className="font-medium text-ink">{t}</span>
                <span className="text-muted">— {d}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tracing && !trace && (
        <div className="grid place-items-center py-16 text-muted">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      )}

      {trace && (
        <ol key={trace.id} className="relative space-y-4">
          {trace.steps.map((s, i) => (
            <li key={s.n} className="trace-in relative pl-11" style={{ animationDelay: `${Math.min(i, 16) * 70}ms` }}>
              {i < trace.steps.length - 1 && <span className="absolute bottom-[-1rem] left-[15px] top-8 w-px bg-line" />}
              <span className={`absolute left-0 top-3 grid h-8 w-8 place-items-center rounded-full text-xs font-bold ring-4 ring-background ${RAIL[s.kind]}`}>
                {s.n}
              </span>
              {s.kind === "api" ? <ApiCard s={s} /> : s.kind === "map" ? <MapCard s={s} /> : <DecisionCard s={s} />}
            </li>
          ))}
        </ol>
      )}

      {trace?.error && <p className="rounded-md border border-bad/30 bg-bad-bg px-4 py-3 text-sm text-bad">Run error: {trace.error}</p>}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "bad" }) {
  return (
    <span className={`rounded border px-2 py-1 font-medium ${tone === "bad" ? "border-bad/30 bg-bad-bg text-bad" : "border-line bg-background text-muted"}`}>
      {children}
    </span>
  );
}
