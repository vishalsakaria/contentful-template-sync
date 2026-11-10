"use client";

import type { Diff, DiffContentType, FieldChip } from "@/lib/dashboard-data";

const CHIP: Record<FieldChip["state"], { cls: string; mark: string }> = {
  unchanged: { cls: "border-line bg-background text-ink/80", mark: "" },
  added: { cls: "chip-added border-ok/40 bg-ok-bg text-ok", mark: "+" },
  removed: { cls: "chip-removed border-bad/40 bg-bad-bg text-bad", mark: "−" },
  modified: { cls: "chip-modified border-warn/40 bg-warn-bg text-warn", mark: "~" },
};

function Chip({ f, index }: { f: FieldChip; index: number }) {
  const s = CHIP[f.state];
  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${s.cls}`}
      style={{ animationDelay: f.state === "unchanged" ? undefined : `${0.2 + index * 0.12}s` }}
    >
      <span className="w-3 text-center font-bold">{s.mark}</span>
      <span className="font-medium">{f.name}</span>
      <span className="font-mono opacity-70">{f.id}</span>
      <span className="ml-auto rounded bg-white/70 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide opacity-80">
        {f.type}
      </span>
    </li>
  );
}

function Column({ title, fields, empty }: { title: string; fields: FieldChip[]; empty: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {fields.map((f, i) => (
            <Chip key={`${f.id}-${f.state}`} f={f} index={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center py-1 md:py-0 md:pt-6">
      <div className="flex rotate-90 text-brand md:rotate-0">
        {[0, 1, 2].map((i) => (
          <svg key={i} viewBox="0 0 24 24" className="chevron -mx-1 h-6 w-6" style={{ animationDelay: `${i * 0.18}s` }} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        ))}
      </div>
    </div>
  );
}

function CtCard({ ct, initial }: { ct: DiffContentType; initial: boolean }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">{ct.name}</span>
        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-muted">{ct.id}</code>
        {ct.isNew && <span className="rounded bg-ok-bg px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ok">New</span>}
        {ct.isRemoved && <span className="rounded bg-bad-bg px-1.5 py-0.5 text-[11px] font-semibold uppercase text-bad">Removed</span>}
      </div>
      {initial ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {ct.after.map((f, i) => (
            <Chip key={f.id} f={f} index={i} />
          ))}
        </ul>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <Column title="Before" fields={ct.before} empty="Didn’t exist" />
          <Arrow />
          <Column title="After" fields={ct.after} empty="Removed" />
        </div>
      )}
    </div>
  );
}

export function ChangeDiff({ diff, replayKey }: { diff: Diff; replayKey: number }) {
  const initial = diff.fromVersion === null;
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">What changed in the model</h2>
          <p className="text-xs text-muted">
            {initial ? `Content types in v${diff.toVersion}` : `Template v${diff.fromVersion} → v${diff.toVersion}`}
          </p>
        </div>
        <div className="hidden items-center gap-3 text-[11px] text-muted sm:flex">
          <Legend cls="bg-ok" label="Added" />
          <Legend cls="bg-warn" label="Changed" />
          <Legend cls="bg-bad" label="Removed" />
        </div>
      </header>
      {diff.contentTypes.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
          Only appearance settings changed in this version — no fields were added, changed or removed.
        </p>
      ) : (
        // keyed so the entrance animations replay when a new version lands
        <div key={`${diff.toVersion}-${replayKey}`} className="space-y-3">
          {diff.contentTypes.map((ct) => (
            <CtCard key={ct.id} ct={ct} initial={initial} />
          ))}
        </div>
      )}
    </section>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${cls}`} />
      {label}
    </span>
  );
}
