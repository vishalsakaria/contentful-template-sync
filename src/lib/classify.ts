import type { ContentTypeTemplateProps, EditorInterfaceTemplateProps } from "contentful-management";

/**
 * Pure change classifier. Compares two template "entities" bodies and says whether
 * the change is safe to roll out automatically (additive) or may destroy data /
 * break existing content (breaking).
 */

export type ChangeKind = "additive" | "breaking";

export type ChangeCode =
  | "content-type-added"
  | "content-type-removed"
  | "content-type-modified"
  | "field-added"
  | "field-removed"
  | "field-renamed"
  | "field-type-changed"
  | "field-modified"
  | "appearance-changed";

export interface Change {
  kind: ChangeKind;
  code: ChangeCode;
  contentTypeId: string;
  fieldId?: string;
  detail: string;
}

export type Classification = "none" | "additive" | "breaking";

export interface ClassifyResult {
  classification: Classification;
  changes: Change[];
}

export interface Entities {
  contentTypeTemplates: ContentTypeTemplateProps[];
  editorInterfaceTemplates: EditorInterfaceTemplateProps[];
}

type Field = ContentTypeTemplateProps["fields"][number];

/** Deterministic JSON (sorted keys) so structurally equal values compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** The part of a field that decides whether stored content stays valid. */
function typeSignature(f: Field): string {
  return stableStringify({
    type: f.type,
    linkType: f.linkType,
    itemsType: f.items?.type,
    itemsLinkType: f.items?.linkType,
  });
}

export function describeType(f: Field): string {
  const items = f.items ? `<${f.items.type}${f.items.linkType ? `:${f.items.linkType}` : ""}>` : "";
  return `${f.type}${f.linkType ? `:${f.linkType}` : ""}${items}`;
}

function changedKeys(a: Field, b: Field): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !deepEqual((a as never)[k], (b as never)[k])).sort();
}

function classifyContentType(
  before: ContentTypeTemplateProps,
  after: ContentTypeTemplateProps,
): Change[] {
  const changes: Change[] = [];
  const ctId = after.id;
  const beforeFields = new Map(before.fields.map((f) => [f.id, f]));
  const afterFields = new Map(after.fields.map((f) => [f.id, f]));

  const removed = [...beforeFields.values()].filter((f) => !afterFields.has(f.id));
  const added = [...afterFields.values()].filter((f) => !beforeFields.has(f.id));

  // Heuristic: one field disappeared and one appeared with the same name and type -> an ID rename.
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  for (const r of removed) {
    const match = added.find(
      (a) => !renamedTo.has(a.id) && a.name === r.name && typeSignature(a) === typeSignature(r),
    );
    if (match) {
      renamedFrom.add(r.id);
      renamedTo.add(match.id);
      changes.push({
        kind: "breaking",
        code: "field-renamed",
        contentTypeId: ctId,
        fieldId: r.id,
        detail: `Field ID "${r.id}" renamed to "${match.id}"`,
      });
    }
  }

  for (const r of removed) {
    if (renamedFrom.has(r.id)) continue;
    changes.push({
      kind: "breaking",
      code: "field-removed",
      contentTypeId: ctId,
      fieldId: r.id,
      detail: `Field "${r.id}" removed`,
    });
  }
  for (const a of added) {
    if (renamedTo.has(a.id)) continue;
    changes.push({
      kind: "additive",
      code: "field-added",
      contentTypeId: ctId,
      fieldId: a.id,
      detail: `Field "${a.id}" (${describeType(a)}) added`,
    });
  }

  for (const [id, prev] of beforeFields) {
    const next = afterFields.get(id);
    if (!next) continue;
    if (typeSignature(prev) !== typeSignature(next)) {
      changes.push({
        kind: "breaking",
        code: "field-type-changed",
        contentTypeId: ctId,
        fieldId: id,
        detail: `Field "${id}" type changed ${describeType(prev)} → ${describeType(next)}`,
      });
    } else if (!deepEqual(prev, next)) {
      changes.push({
        kind: "additive",
        code: "field-modified",
        contentTypeId: ctId,
        fieldId: id,
        detail: `Field "${id}" changed (${changedKeys(prev, next).join(", ")})`,
      });
    }
  }

  const metaBefore = { name: before.name, description: before.description, displayField: before.displayField };
  const metaAfter = { name: after.name, description: after.description, displayField: after.displayField };
  if (!deepEqual(metaBefore, metaAfter)) {
    changes.push({
      kind: "additive",
      code: "content-type-modified",
      contentTypeId: ctId,
      detail: `Content type settings changed (${changedKeys(metaBefore as never, metaAfter as never).join(", ")})`,
    });
  }

  return changes;
}

/** Strip the link that ties an editor interface to a content type before comparing layouts. */
function appearanceOf(ei: EditorInterfaceTemplateProps) {
  const { contentTypeTemplate: _link, ...rest } = ei;
  void _link;
  return rest;
}

export function classifyEntities(before: Entities | undefined, after: Entities): ClassifyResult {
  const changes: Change[] = [];

  if (!before) {
    return { classification: "additive", changes: [] };
  }

  const beforeCts = new Map(before.contentTypeTemplates.map((c) => [c.id, c]));
  const afterCts = new Map(after.contentTypeTemplates.map((c) => [c.id, c]));

  for (const [id, ct] of afterCts) {
    const prev = beforeCts.get(id);
    if (!prev) {
      changes.push({
        kind: "additive",
        code: "content-type-added",
        contentTypeId: id,
        detail: `Content type "${ct.name}" added`,
      });
    } else {
      changes.push(...classifyContentType(prev, ct));
    }
  }
  for (const [id, ct] of beforeCts) {
    if (!afterCts.has(id)) {
      changes.push({
        kind: "breaking",
        code: "content-type-removed",
        contentTypeId: id,
        detail: `Content type "${ct.name}" removed`,
      });
    }
  }

  const beforeEis = new Map(before.editorInterfaceTemplates.map((e) => [e.contentTypeTemplate.sys.id, e]));
  for (const ei of after.editorInterfaceTemplates) {
    const ctId = ei.contentTypeTemplate.sys.id;
    const prev = beforeEis.get(ctId);
    if (prev && !deepEqual(appearanceOf(prev), appearanceOf(ei))) {
      changes.push({
        kind: "additive",
        code: "appearance-changed",
        contentTypeId: ctId,
        detail: "Editor appearance changed",
      });
    }
  }

  const classification: Classification = changes.some((c) => c.kind === "breaking")
    ? "breaking"
    : changes.length > 0
      ? "additive"
      : "none";
  return { classification, changes };
}

export function summarize(result: ClassifyResult): string {
  if (result.changes.length === 0) return "No structural changes";
  return result.changes.map((c) => c.detail).join("; ");
}
