/** Shared (client + server) shapes for the API trace. No server-only imports here. */

export type StepKind = "api" | "map" | "decision";

export interface TraceStep {
  /** 1-based position in the run */
  n: number;
  kind: StepKind;
  title: string;

  /* api steps */
  method?: "GET" | "PUT" | "POST";
  url?: string;
  /** true when the call changes state in Contentful (creates a version, installs) */
  write?: boolean;
  /** HTTP-ish status, or "error" */
  status?: number | "error";
  ms?: number;
  /** what we sent (the Authorization header is never recorded) */
  request?: unknown;
  /** what came back (summarised and size-limited) */
  response?: unknown;

  /* map steps: data before and after the transformation */
  from?: unknown;
  to?: unknown;

  /* map + decision steps */
  notes?: string[];
  /** short outcome label for decision steps, e.g. "additive", "held" */
  result?: string;
  error?: string;
}

export interface Trace {
  id: string;
  mode: "dry-run" | "live";
  startedAt: string;
  steps: TraceStep[];
  summary: { calls: number; writes: number; ms: number };
  error?: string;
}
