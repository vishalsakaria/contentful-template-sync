import type { DashboardData, DiffContentType, FieldChip, TargetStatus } from "./dashboard-data";

/**
 * Rehearsal aid: `/?preview=installing|held|behind` overlays SIMULATED state on the live data
 * (client-side only, nothing is written) so the animated states can be shown on demand.
 */
export const PREVIEW_MODES = ["installing", "held", "behind"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export function parsePreview(value: string | undefined): PreviewMode | undefined {
  return (PREVIEW_MODES as readonly string[]).includes(value ?? "") ? (value as PreviewMode) : undefined;
}

const f = (id: string, name: string, type: string, state: FieldChip["state"]): FieldChip => ({ id, name, type, state });

function fakeDiff(breaking: boolean): DiffContentType {
  return {
    id: "carousel",
    name: "Carousel",
    isNew: false,
    isRemoved: false,
    before: [
      f("title", "Title", "Symbol", "unchanged"),
      f("images", "Images", "Array<Link:Entry>", "unchanged"),
      f("speed", "Speed", "Integer", breaking ? "removed" : "modified"),
    ],
    after: [
      f("title", "Title", "Symbol", "unchanged"),
      f("images", "Images", "Array<Link:Entry>", "unchanged"),
      ...(breaking ? [] : [f("speed", "Speed (ms)", "Integer", "modified" as const)]),
      ...(breaking ? [] : [f("caption", "Caption", "Symbol", "added" as const)]),
    ],
  };
}

export function applyPreview(data: DashboardData, mode: PreviewMode | undefined): DashboardData {
  if (!mode) return data;
  const latest = data.template.latestVersion;
  const status: TargetStatus = mode === "installing" ? "installing" : mode === "held" ? "held" : "behind";
  const breaking = mode === "held";
  return {
    ...data,
    versions: data.versions.map((v, i) =>
      i === 0
        ? {
            ...v,
            classification: breaking ? "breaking" : "additive",
            changes: [
              breaking
                ? { kind: "breaking", code: "field-removed", contentTypeId: "carousel", fieldId: "speed", detail: 'Field "speed" removed' }
                : { kind: "additive", code: "field-added", contentTypeId: "carousel", fieldId: "caption", detail: 'Field "caption" (Symbol) added' },
            ]
          }
        : v,
    ),
    diff: { fromVersion: Math.max(1, latest - 1), toVersion: latest, contentTypes: [fakeDiff(breaking)] },
    targets: data.targets.map((t) => ({
      ...t,
      status,
      installedVersion: Math.max(1, latest - 1),
      note: breaking ? "Breaking change held for review" : status === "installing" ? `Installing v${latest}…` : undefined,
    })),
  };
}
