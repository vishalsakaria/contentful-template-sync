import { log, describeError } from "./cma";
import { syncTemplate, type SyncOptions, type SyncResult } from "./template";
import { rolloutAll, type RolloutSummary } from "./rollout";
import { getConfig } from "./config";
import { listTargets } from "./installations";
import { step, withTrace } from "./trace";
import type { Trace } from "./trace-types";

export interface RunResult {
  sync: SyncResult;
  rollout?: RolloutSummary;
}

/**
 * Sync a template with the source model, then roll the resulting version out
 * according to AUTO_INSTALL_MODE. Idempotent: if nothing changed, nothing happens.
 */
export async function runSync(templateId: string, opts: SyncOptions = {}): Promise<RunResult> {
  const sync = await syncTemplate(templateId, opts);
  if (sync.status !== "updated" || !sync.toVersion || !sync.classification) {
    return { sync };
  }
  const rollout = await rolloutAll(templateId, sync.toVersion, sync.classification.classification);
  return { sync, rollout };
}

/** Run for every configured template, never throwing (used by webhook and "Run sync now"). */
export async function runSyncSafely(templateIds: string[], opts: SyncOptions = {}): Promise<Array<RunResult | { error: string; templateId: string }>> {
  const out: Array<RunResult | { error: string; templateId: string }> = [];
  for (const templateId of templateIds) {
    try {
      out.push(await runSync(templateId, opts));
    } catch (err) {
      const error = describeError(err);
      log("sync.error", { templateId, error });
      out.push({ templateId, error });
    }
  }
  return out;
}

/**
 * Read-only walk through the whole pipeline: it makes the same reads a sync would, shows the
 * mapping and decisions, and says what it WOULD write — but never creates a version or installs.
 */
export async function traceDryRun(templateIds: string[]): Promise<{ trace: Trace; results: SyncResult[] }> {
  const cfg = getConfig();
  const { result, trace } = await withTrace("dry-run", async () => {
    const results: SyncResult[] = [];
    for (const id of templateIds) {
      const sync = await syncTemplate(id, { dryRun: true });
      results.push(sync);
      const targets = await listTargets(id);

      if (sync.status === "dry-run" && sync.classification && sync.fromVersion !== undefined) {
        const next = sync.fromVersion + 1;
        const hold =
          cfg.AUTO_INSTALL_MODE === "manual" ||
          (cfg.AUTO_INSTALL_MODE === "additive-only" && sync.classification.classification === "breaking");
        step({
          kind: "decision",
          title: "Plan the rollout (nothing is installed in a dry run)",
          result: hold ? "would hold" : "would install",
          notes: hold
            ? [`AUTO_INSTALL_MODE = ${cfg.AUTO_INSTALL_MODE}; change is ${sync.classification.classification} → v${next} would be created but held`]
            : targets.map((t) => `Would validate, then install v${next} into ${t.spaceId}/${t.environmentId} (currently v${t.installedVersion})`),
        });
      } else {
        step({
          kind: "decision",
          title: "Plan the rollout",
          result: "nothing to do",
          notes: [
            "No new template version is needed, so there is nothing to install.",
            ...targets.map((t) => `${t.spaceId}/${t.environmentId} is on v${t.installedVersion} (${t.installationStatus})`),
          ],
        });
      }
    }
    return results;
  });
  return { trace, results: result ?? [] };
}
