"use client";

import type { ReactNode } from "react";
import type { DashboardData, TargetRow, TargetStatus } from "@/lib/dashboard-data";

type StageState = "idle" | "active" | "done" | "held" | "warn";
type LinkState = "idle" | "flowing" | "blocked" | "done";

/* ---------- icons ---------- */

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const ICONS = {
  source: I(
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>,
  ),
  webhook: I(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />),
  template: I(
    <>
      <rect x="4" y="3" width="13" height="15" rx="2" />
      <path d="M8 21h11a2 2 0 0 0 2-2V8" />
      <path d="M8 8h5M8 12h5" />
    </>,
  ),
  install: I(
    <>
      <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z" />
      <path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" />
    </>,
  ),
  check: <path d="m5 12 5 5 9-10" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

/* ---------- connector ---------- */

function Connector({ state }: { state: LinkState }) {
  const base: Record<LinkState, string> = {
    idle: "bg-line",
    flowing: "bg-brand/25",
    blocked: "bg-hold/40",
    done: "bg-ok/40",
  };
  return (
    <div className="relative mx-auto h-9 w-0.5 shrink-0 md:mx-0 md:h-0.5 md:w-14 md:self-center">
      <div className={`absolute inset-0 rounded-full ${base[state]} overflow-hidden`}>
        {state === "done" && <div className="sheen absolute inset-0" />}
      </div>
      {state === "flowing" && (
        <>
          <span className="flow-dot" style={{ animationDelay: "0s" }} />
          <span className="flow-dot" style={{ animationDelay: "0.55s" }} />
          <span className="flow-dot" style={{ animationDelay: "1.1s" }} />
        </>
      )}
      {state === "blocked" && (
        <span className="absolute left-1/2 top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-hold/40 bg-hold-bg text-hold">
          <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">
            {I(ICONS.lock)}
          </span>
        </span>
      )}
    </div>
  );
}

/* ---------- stage card ---------- */

const STAGE_STYLE: Record<StageState, { card: string; icon: string }> = {
  idle: { card: "border-line", icon: "bg-background text-muted" },
  active: { card: "border-brand pulse-ring", icon: "bg-brand text-white" },
  done: { card: "border-ok/40", icon: "bg-ok-bg text-ok" },
  held: { card: "border-hold/50", icon: "bg-hold-bg text-hold" },
  warn: { card: "border-warn/50", icon: "bg-warn-bg text-warn" },
};

function Stage({
  step,
  title,
  icon,
  state,
  ping,
  grow,
  children,
}: {
  step: number;
  title: string;
  icon: ReactNode;
  state: StageState;
  /** delay (s) for the "new version landed" ripple, or undefined for none */
  ping?: number;
  grow?: boolean;
  children: ReactNode;
}) {
  const s = STAGE_STYLE[state];
  return (
    <div
      className={`relative rounded-xl border bg-white p-4 transition-colors duration-500 ${s.card} ${
        ping !== undefined ? "stage-ping" : ""
      } ${grow ? "md:flex-[1.7]" : "md:flex-1"} md:min-w-0`}
      style={ping !== undefined ? { animationDelay: `${ping}s` } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors duration-500 ${s.icon}`}>
          {icon}
          {state === "done" && (
            <span className="tick-pop absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-ok text-white ring-2 ring-white">
              <span className="[&_svg]:h-2.5 [&_svg]:w-2.5 [&_svg]:stroke-[3]">{I(ICONS.check)}</span>
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Step {step}</div>
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
        </div>
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </div>
  );
}

/* ---------- target mini-chips ---------- */

const TARGET_DOT: Record<TargetStatus, string> = {
  "up-to-date": "bg-ok",
  behind: "bg-warn",
  held: "bg-hold",
  conflict: "bg-bad",
  installing: "bg-brand animate-pulse",
  failed: "bg-bad",
};

function TargetChip({ t }: { t: TargetRow }) {
  const installing = t.status === "installing";
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-500 ${
        installing ? "border-brand/40 bg-info-bg" : t.status === "up-to-date" ? "border-ok/30 bg-ok-bg/50" : "border-line bg-background"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${TARGET_DOT[t.status]}`} />
      <span className="truncate font-medium text-ink">{t.spaceName}</span>
      <span className="font-mono text-muted">{t.environmentId}</span>
      <span className="ml-auto font-mono text-ink/70">v{t.installedVersion}</span>
      {t.status === "up-to-date" && (
        <span key={t.installedVersion} className="tick-pop text-ok [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:stroke-[3]">
          {I(ICONS.check)}
        </span>
      )}
      {installing && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      )}
    </div>
  );
}

/* ---------- the pipeline ---------- */

export function Pipeline({
  data,
  now,
  replayKey,
  onReplay,
}: {
  data: DashboardData;
  now: number;
  /** increments whenever a new version lands (or the user presses Replay) */
  replayKey: number;
  onReplay: () => void;
}) {
  const latest = data.versions[0];
  const targets = data.targets;
  const ageSec = (now - new Date(data.template.latestAt).getTime()) / 1000;
  const fresh = ageSec < 20;

  const installing = targets.some((t) => t.status === "installing");
  const held = targets.some((t) => t.status === "held");
  const attention = targets.some((t) => ["conflict", "failed"].includes(t.status));
  const waiting = targets.some((t) => t.status === "behind");
  const allDone = targets.length > 0 && targets.every((t) => t.status === "up-to-date");
  const upToDate = targets.filter((t) => t.status === "up-to-date").length;

  const stage3: StageState = fresh ? "active" : "done";
  const link34: LinkState = installing ? "flowing" : held ? "blocked" : allDone ? "done" : waiting ? "flowing" : "idle";
  const stage4: StageState = installing ? "active" : held ? "held" : attention ? "warn" : allDone ? "done" : "idle";

  const changedTypes = data.diff.contentTypes.map((c) => c.name);
  const sourceSummary =
    latest?.classification === "initial"
      ? "Initial model captured"
      : changedTypes.length
        ? `${changedTypes.join(", ")} changed`
        : "Model updated";

  // replay ping: stages light up one after another
  const ping = (i: number) => (replayKey > 0 ? i * 0.9 : undefined);

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">How a change flows</h2>
          <p className="text-xs text-muted">Source model → template → every installed environment</p>
        </div>
        <button
          onClick={onReplay}
          className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          Replay
        </button>
      </header>

      <div key={replayKey} className="flex flex-col md:flex-row md:items-stretch">
        <Stage step={1} title="Source model" icon={ICONS.source} state="done" ping={ping(0)}>
          <p className="font-medium text-ink">{sourceSummary}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{data.sourceLabel}</p>
        </Stage>

        <Connector state={fresh ? "flowing" : "done"} />

        <Stage step={2} title="Webhook" icon={ICONS.webhook} state="done" ping={ping(1)}>
          <p className="font-medium text-ink">ContentType.publish</p>
          <p className="mt-0.5 text-xs text-muted">Verified · answered 200 instantly</p>
        </Stage>

        <Connector state={fresh ? "flowing" : "done"} />

        <Stage step={3} title="Template" icon={ICONS.template} state={stage3} ping={ping(2)}>
          <div className="flex flex-wrap items-center gap-2">
            <span key={data.template.latestVersion} className="tick-pop rounded bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">
              v{data.template.latestVersion}
            </span>
            {latest && <ClassPill value={latest.classification} />}
          </div>
          <p className="mt-1 truncate text-xs text-muted">{data.template.name}</p>
        </Stage>

        <Connector state={link34} />

        <Stage step={4} title="Installs" icon={ICONS.install} state={stage4} ping={ping(3)} grow>
          {targets.length === 0 ? (
            <p className="text-xs text-muted">Not installed in any environment yet.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                {installing
                  ? "Installing the new version…"
                  : held
                    ? "Breaking change held — waiting for approval"
                    : attention
                      ? "Needs attention"
                      : waiting
                        ? "Waiting to install…"
                        : `${upToDate} of ${targets.length} up to date`}
              </p>
              <div className="space-y-1.5">
                {targets.map((t) => (
                  <TargetChip key={`${t.spaceId}/${t.environmentId}`} t={t} />
                ))}
              </div>
            </>
          )}
        </Stage>
      </div>
    </section>
  );
}

function ClassPill({ value }: { value: "initial" | "none" | "additive" | "breaking" }) {
  const map = {
    initial: ["Initial", "bg-info-bg text-info"],
    none: ["No change", "bg-line/50 text-muted"],
    additive: ["Additive", "bg-ok-bg text-ok"],
    breaking: ["Breaking", "bg-bad-bg text-bad"],
  } as const;
  const [label, cls] = map[value];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}
