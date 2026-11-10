import pLimit from "p-limit";
import type { ValidationFinding } from "contentful-management";
import { getConfig } from "./config";
import { cma, describeError, log, withBackoff } from "./cma";
import { api, step } from "./trace";
import { listTargets, type Target } from "./installations";
import type { Classification } from "./classify";

export type Outcome =
  | "installed"
  | "up-to-date"
  | "held"
  | "conflict"
  | "failed";

export interface TargetResult {
  spaceId: string;
  environmentId: string;
  outcome: Outcome;
  fromVersion: number;
  toVersion: number;
  findings?: ValidationFinding[];
  error?: string;
}

/* ---------- validation (shared with the dashboard) ---------- */

export interface Validation {
  clean: boolean;
  findings: ValidationFinding[];
}

export async function validateTarget(
  templateId: string,
  t: { spaceId: string; environmentId: string },
  version: number,
): Promise<Validation> {
  const res = await api(
    {
      title: `Validate v${version} against ${t.spaceId}/${t.environmentId}`,
      method: "PUT",
      write: false, // a PUT, but it only checks — nothing is installed
      url: `/spaces/${t.spaceId}/environments/${t.environmentId}/template_installations/${templateId}/versions/${version}/validated`,
      request: { body: {} },
      summarize: (r) => ({ conflicts: r.items, clean: r.items.length === 0 }),
    },
    () =>
      withBackoff(() =>
        cma().environmentTemplate.validate(
          { spaceId: t.spaceId, environmentId: t.environmentId, environmentTemplateId: templateId, version },
          {},
        ),
      ),
  );
  return { clean: res.items.length === 0, findings: res.items };
}

/** Short-lived cache so the 5-second dashboard refresh does not re-validate every time. */
const validationCache = new Map<string, { at: number; value: Validation }>();
const VALIDATION_TTL_MS = 30_000;

export async function validateTargetCached(
  templateId: string,
  t: { spaceId: string; environmentId: string },
  version: number,
): Promise<Validation> {
  const key = `${templateId}/${t.spaceId}/${t.environmentId}/${version}`;
  const hit = validationCache.get(key);
  if (hit && Date.now() - hit.at < VALIDATION_TTL_MS) return hit.value;
  const value = await validateTarget(templateId, t, version);
  validationCache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateValidation(templateId: string, t: { spaceId: string; environmentId: string }) {
  for (const k of validationCache.keys()) {
    if (k.startsWith(`${templateId}/${t.spaceId}/${t.environmentId}/`)) validationCache.delete(k);
  }
}

/* ---------- install ---------- */

/** Validate, then install if clean. */
export async function rolloutToTarget(
  templateId: string,
  target: Pick<Target, "spaceId" | "environmentId" | "installedVersion">,
  version: number,
): Promise<TargetResult> {
  const base = {
    spaceId: target.spaceId,
    environmentId: target.environmentId,
    fromVersion: target.installedVersion,
    toVersion: version,
  };
  if (target.installedVersion >= version) return { ...base, outcome: "up-to-date" };

  try {
    const v = await validateTarget(templateId, target, version);
    if (!v.clean) {
      log("rollout.conflict", { templateId, ...base, findings: v.findings });
      return { ...base, outcome: "conflict", findings: v.findings };
    }
    await api(
      {
        title: `Install v${version} into ${target.spaceId}/${target.environmentId}`,
        method: "POST",
        write: true,
        okStatus: 201,
        url: `/spaces/${target.spaceId}/environments/${target.environmentId}/template_installations/${templateId}/versions`,
        request: { body: { version } },
        summarize: (i) => ({ sys: { id: i.sys.id, type: i.sys.type, status: i.sys.status, template: i.sys.template } }),
      },
      () =>
        withBackoff(() =>
          cma().environmentTemplate.install(
            { spaceId: target.spaceId, environmentId: target.environmentId, environmentTemplateId: templateId },
            { version },
          ),
        ),
    );
    invalidateValidation(templateId, target);
    log("rollout.installed", { templateId, ...base });
    return { ...base, outcome: "installed" };
  } catch (err) {
    const error = describeError(err);
    log("rollout.failed", { templateId, ...base, error });
    return { ...base, outcome: "failed", error };
  }
}

export interface RolloutSummary {
  templateId: string;
  version: number;
  mode: string;
  held: boolean;
  results: TargetResult[];
}

/**
 * Roll the given template version out to every installed environment (3 at a time).
 * Pass `force` to ignore the auto-install mode (used by manual "install all").
 */
export async function rolloutAll(
  templateId: string,
  version: number,
  classification: Classification,
  opts: { force?: boolean } = {},
): Promise<RolloutSummary> {
  const { AUTO_INSTALL_MODE } = getConfig();
  const targets = await listTargets(templateId);

  const hold =
    !opts.force &&
    (AUTO_INSTALL_MODE === "manual" || (AUTO_INSTALL_MODE === "additive-only" && classification === "breaking"));

  step({
    kind: "decision",
    title: "Rollout policy",
    result: hold ? "held" : targets.length === 0 ? "nothing to do" : "auto-install",
    notes: [
      `AUTO_INSTALL_MODE = ${AUTO_INSTALL_MODE}${opts.force ? " (overridden: manual install)" : ""}`,
      `Change is ${classification}`,
      hold
        ? "Rollout held — the new version exists in the template but nothing is installed until someone approves it"
        : `Validate, then install v${version} into ${targets.length} environment(s), 3 at a time`,
    ],
  });

  if (hold) {
    log("rollout.held", { templateId, version, mode: AUTO_INSTALL_MODE, classification, targets: targets.length });
    return {
      templateId,
      version,
      mode: AUTO_INSTALL_MODE,
      held: true,
      results: targets.map((t) => ({
        spaceId: t.spaceId,
        environmentId: t.environmentId,
        outcome: t.installedVersion >= version ? "up-to-date" : "held",
        fromVersion: t.installedVersion,
        toVersion: version,
      })),
    };
  }

  const limit = pLimit(3);
  const results = await Promise.all(targets.map((t) => limit(() => rolloutToTarget(templateId, t, version))));
  return { templateId, version, mode: AUTO_INSTALL_MODE, held: false, results };
}
