import type { EnvironmentTemplateInstallationProps } from "contentful-management";
import { getConfig } from "./config";
import { cma, withBackoff } from "./cma";
import { api, step } from "./trace";

export interface Target {
  spaceId: string;
  environmentId: string;
  installedVersion: number;
  /** Contentful's own installation status (created | inProgress | succeeded | failed | ...) */
  installationStatus: string;
  installedAt: string;
  errors?: unknown[];
}

/** Version of the template an installation points at. Tolerant of the exact link shape. */
function installedVersionOf(inst: EnvironmentTemplateInstallationProps): number {
  const tpl = inst.sys.template as unknown as { sys?: { version?: number | string }; version?: number | string };
  const v = tpl?.sys?.version ?? tpl?.version ?? inst.sys.version;
  return Number(v);
}

export function toTarget(inst: EnvironmentTemplateInstallationProps): Target {
  return {
    spaceId: inst.sys.space.sys.id,
    environmentId: inst.sys.environment.sys.id,
    installedVersion: installedVersionOf(inst),
    installationStatus: inst.sys.status,
    installedAt: inst.sys.completedAt ?? inst.sys.updatedAt ?? inst.sys.createdAt,
    errors: inst.sys.errors,
  };
}

/**
 * Collapse the installation history to one entry per space/environment (the one on the
 * highest template version, ties broken by recency) and drop the source environment.
 */
export function dedupeInstallations(
  installations: EnvironmentTemplateInstallationProps[],
  source: { spaceId: string; environmentId: string },
): Target[] {
  const latest = new Map<string, Target>();
  for (const inst of installations) {
    const t = toTarget(inst);
    if (t.spaceId === source.spaceId && t.environmentId === source.environmentId) continue;
    const key = `${t.spaceId}/${t.environmentId}`;
    const prev = latest.get(key);
    if (
      !prev ||
      t.installedVersion > prev.installedVersion ||
      (t.installedVersion === prev.installedVersion && t.installedAt > prev.installedAt)
    ) {
      latest.set(key, t);
    }
  }
  return [...latest.values()].sort((a, b) =>
    `${a.spaceId}/${a.environmentId}`.localeCompare(`${b.spaceId}/${b.environmentId}`),
  );
}

/** Reads every installation of the template across the organization (follows cursor pagination). */
export async function listInstallations(templateId: string): Promise<EnvironmentTemplateInstallationProps[]> {
  const { CONTENTFUL_ORG_ID } = getConfig();
  const all: EnvironmentTemplateInstallationProps[] = [];
  let pageNext: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await api(
      {
        title: "List every installation of the template (org-wide)",
        method: "GET",
        url: `/organizations/${CONTENTFUL_ORG_ID}/environment_templates/${templateId}/template_installations?limit=100${pageNext ? "&pageNext=…" : ""}`,
        summarize: (r) =>
          r.items.map((i) => ({
            space: i.sys.space.sys.id,
            environment: i.sys.environment.sys.id,
            installedVersion: toTarget(i).installedVersion,
            status: i.sys.status,
          })),
      },
      () =>
        withBackoff(() =>
          cma().environmentTemplateInstallation.getMany({
            organizationId: CONTENTFUL_ORG_ID,
            environmentTemplateId: templateId,
            limit: 100,
            ...(pageNext ? { pageNext } : {}),
          }),
        ),
    );
    all.push(...res.items);
    const next = res.pages?.next;
    if (!next) break;
    // `pages.next` is either a bare token or a query string like "?pageNext=abc"
    pageNext = next.includes("pageNext=") ? new URLSearchParams(next.replace(/^.*\?/, "")).get("pageNext") ?? undefined : next;
    if (!pageNext) break;
  }
  return all;
}

export async function listTargets(templateId: string): Promise<Target[]> {
  const { SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();
  const records = await listInstallations(templateId);
  const targets = dedupeInstallations(records, { spaceId: SOURCE_SPACE_ID, environmentId: SOURCE_ENVIRONMENT_ID });
  step({
    kind: "decision",
    title: "Reduce installation records to target environments",
    result: `${targets.length} target${targets.length === 1 ? "" : "s"}`,
    notes: [
      `${records.length} installation record(s) → ${targets.length} environment(s): the latest per space/environment`,
      `The source environment (${SOURCE_SPACE_ID}/${SOURCE_ENVIRONMENT_ID}) is never a target`,
    ],
  });
  return targets;
}

/* ---------- space names (cached; best effort) ---------- */

const spaceNames = new Map<string, { name: string; at: number }>();

export async function getSpaceName(spaceId: string): Promise<string> {
  const hit = spaceNames.get(spaceId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.name;
  try {
    const space = await api(
      { title: `Look up the name of space ${spaceId}`, method: "GET", url: `/spaces/${spaceId}`, summarize: (sp) => ({ sys: { id: sp.sys.id }, name: sp.name }) },
      () => withBackoff(() => cma().space.get({ spaceId })),
    );
    spaceNames.set(spaceId, { name: space.name, at: Date.now() });
    return space.name;
  } catch {
    return spaceId; // token may not see every space
  }
}
