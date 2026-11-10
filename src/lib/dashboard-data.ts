import pLimit from "p-limit";
import type { ContentTypeTemplateProps, EnvironmentTemplateProps } from "contentful-management";
import { getConfig } from "./config";
import { classifyEntities, deepEqual, describeType, type Change, type Classification } from "./classify";
import { getTemplate, getVersions } from "./template";
import { getSpaceName, listTargets } from "./installations";
import { validateTargetCached } from "./rollout";

export type TargetStatus = "up-to-date" | "behind" | "held" | "conflict" | "installing" | "failed";

export interface VersionRow {
  version: number;
  versionName: string;
  versionDescription?: string;
  at: string;
  classification: Classification | "initial";
  changes: Change[];
}

export interface TargetRow {
  spaceId: string;
  spaceName: string;
  environmentId: string;
  installedVersion: number;
  status: TargetStatus;
  note?: string;
  findings?: Array<{ message: string; details: Record<string, unknown> }>;
}

export type FieldState = "unchanged" | "added" | "removed" | "modified";

export interface FieldChip {
  id: string;
  name: string;
  type: string;
  state: FieldState;
}

export interface DiffContentType {
  id: string;
  name: string;
  isNew: boolean;
  isRemoved: boolean;
  before: FieldChip[];
  after: FieldChip[];
}

export interface Diff {
  /** null when there is no earlier version to compare with (initial version) */
  fromVersion: number | null;
  toVersion: number;
  contentTypes: DiffContentType[];
}

export interface DashboardData {
  templateIds: string[];
  template: {
    id: string;
    name: string;
    description?: string;
    latestVersion: number;
    latestVersionName: string;
    latestAt: string;
    forTemplatedSpaces?: boolean;
  };
  mode: string;
  sourceLabel: string;
  versions: VersionRow[];
  diff: Diff;
  targets: TargetRow[];
  fetchedAt: string;
}

const versionTime = (v: EnvironmentTemplateProps) => v.sys.createdAt;

export function buildVersionRows(versionsNewestFirst: EnvironmentTemplateProps[]): VersionRow[] {
  return versionsNewestFirst.map((v, i) => {
    const prev = versionsNewestFirst[i + 1];
    const result = prev ? classifyEntities(prev.entities, v.entities) : undefined;
    return {
      version: Number(v.sys.version),
      versionName: v.versionName,
      versionDescription: v.versionDescription,
      at: versionTime(v),
      classification: result ? result.classification : "initial",
      changes: result?.changes ?? [],
    };
  });
}

/**
 * Before/after field lists for the content types touched by the newest version
 * (or every content type, for the initial version).
 */
export function buildDiff(
  newest: EnvironmentTemplateProps,
  previous: EnvironmentTemplateProps | undefined,
  changes: Change[],
): Diff {
  const newCts = new Map(newest.entities.contentTypeTemplates.map((c) => [c.id, c]));
  const oldCts = new Map((previous?.entities.contentTypeTemplates ?? []).map((c) => [c.id, c]));
  const touched = new Set(changes.map((c) => c.contentTypeId));
  const ids = previous
    ? [...new Set([...newCts.keys(), ...oldCts.keys()])].filter((id) => touched.has(id))
    : [...newCts.keys()];

  const contentTypes = ids.map((id): DiffContentType => {
    const before = oldCts.get(id);
    const after = newCts.get(id);
    const beforeMap = new Map((before?.fields ?? []).map((f) => [f.id, f]));
    const afterMap = new Map((after?.fields ?? []).map((f) => [f.id, f]));
    const chip = (f: ContentTypeTemplateProps["fields"][number], state: FieldState): FieldChip => ({
      id: f.id,
      name: f.name,
      type: describeType(f),
      state,
    });
    return {
      id,
      name: (after ?? before)!.name,
      isNew: !before && !!previous,
      isRemoved: !after,
      before: (before?.fields ?? []).map((f) => {
        const other = afterMap.get(f.id);
        return chip(f, !other ? "removed" : deepEqual(f, other) ? "unchanged" : "modified");
      }),
      after: (after?.fields ?? []).map((f) => {
        const other = beforeMap.get(f.id);
        return chip(f, !other ? (previous ? "added" : "unchanged") : deepEqual(f, other) ? "unchanged" : "modified");
      }),
    };
  });

  return {
    fromVersion: previous ? Number(previous.sys.version) : null,
    toVersion: Number(newest.sys.version),
    contentTypes,
  };
}

export async function getDashboardData(requestedTemplateId?: string): Promise<DashboardData> {
  const cfg = getConfig();
  const templateId = cfg.TEMPLATE_IDS.includes(requestedTemplateId ?? "")
    ? (requestedTemplateId as string)
    : cfg.TEMPLATE_IDS[0];

  const [template, versions, targets] = await Promise.all([
    getTemplate(templateId),
    getVersions(templateId, 20),
    listTargets(templateId),
  ]);
  const latestVersion = Number(template.sys.version);
  const versionRows = buildVersionRows(versions);

  const limit = pLimit(3);
  const rows = await Promise.all(
    targets.map((t) =>
      limit(async (): Promise<TargetRow> => {
        const spaceName = await getSpaceName(t.spaceId);
        const base = { spaceId: t.spaceId, spaceName, environmentId: t.environmentId, installedVersion: t.installedVersion };

        if (["created", "inProgress", "inRetry"].includes(t.installationStatus)) {
          return { ...base, status: "installing", note: `Installing v${t.installedVersion}…` };
        }
        if (t.installationStatus === "failed") {
          return { ...base, status: "failed", note: "Last installation failed" };
        }
        if (t.installedVersion >= latestVersion) return { ...base, status: "up-to-date" };

        // Behind. Is a breaking change waiting between what is installed and latest?
        const pendingBreaking = versionRows.some(
          (v) => v.version > t.installedVersion && v.classification === "breaking",
        );
        if (cfg.AUTO_INSTALL_MODE === "manual" || (cfg.AUTO_INSTALL_MODE === "additive-only" && pendingBreaking)) {
          return {
            ...base,
            status: "held",
            note: pendingBreaking ? "Breaking change held for review" : "Manual rollout mode",
          };
        }
        try {
          const v = await validateTargetCached(templateId, t, latestVersion);
          if (!v.clean) {
            return { ...base, status: "conflict", findings: v.findings, note: v.findings.map((f) => f.message).join(", ") };
          }
        } catch {
          /* validation unavailable — show as behind */
        }
        return { ...base, status: "behind" };
      }),
    ),
  );

  return {
    templateIds: cfg.TEMPLATE_IDS,
    template: {
      id: templateId,
      name: template.name,
      description: template.description,
      latestVersion,
      latestVersionName: template.versionName,
      latestAt: versionTime(template),
      forTemplatedSpaces: template.forTemplatedSpaces,
    },
    mode: cfg.AUTO_INSTALL_MODE,
    sourceLabel: `${cfg.SOURCE_SPACE_ID} / ${cfg.SOURCE_ENVIRONMENT_ID}`,
    versions: versionRows,
    diff: buildDiff(versions[0], versions[1], versionRows[0]?.changes ?? []),
    targets: rows,
    fetchedAt: new Date().toISOString(),
  };
}
