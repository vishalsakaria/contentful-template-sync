import { describe, expect, it } from "vitest";
import type { ContentTypeTemplateProps, EnvironmentTemplateProps } from "contentful-management";
import { buildDiff } from "@/lib/dashboard-data";
import type { Change } from "@/lib/classify";

type F = ContentTypeTemplateProps["fields"][number];
const field = (id: string, extra: Partial<F> = {}): F => ({ id, name: id, type: "Symbol", ...extra }) as F;
const tpl = (version: number, cts: Record<string, F[]>): EnvironmentTemplateProps =>
  ({
    sys: { version },
    entities: {
      contentTypeTemplates: Object.entries(cts).map(([id, fields]) => ({ id, name: id.toUpperCase(), fields })),
      editorInterfaceTemplates: [],
    },
  }) as unknown as EnvironmentTemplateProps;
const change = (contentTypeId: string): Change => ({ kind: "additive", code: "field-added", contentTypeId, detail: "x" });

describe("buildDiff", () => {
  it("marks added, modified, removed and unchanged fields on each side", () => {
    const prev = tpl(1, { carousel: [field("title"), field("speed", { type: "Integer" }), field("old")] });
    const next = tpl(2, { carousel: [field("title"), field("speed", { type: "Integer", required: true }), field("caption")] });
    const d = buildDiff(next, prev, [change("carousel")]);

    expect(d).toMatchObject({ fromVersion: 1, toVersion: 2 });
    const ct = d.contentTypes[0];
    expect(Object.fromEntries(ct.before.map((f) => [f.id, f.state]))).toEqual({ title: "unchanged", speed: "modified", old: "removed" });
    expect(Object.fromEntries(ct.after.map((f) => [f.id, f.state]))).toEqual({ title: "unchanged", speed: "modified", caption: "added" });
  });

  it("only includes content types the version actually touched", () => {
    const prev = tpl(1, { carousel: [field("title")], image: [field("image")] });
    const next = tpl(2, { carousel: [field("title"), field("caption")], image: [field("image")] });
    expect(buildDiff(next, prev, [change("carousel")]).contentTypes.map((c) => c.id)).toEqual(["carousel"]);
  });

  it("shows every content type, unchanged, for the initial version", () => {
    const d = buildDiff(tpl(1, { carousel: [field("title")], image: [field("image")] }), undefined, []);
    expect(d.fromVersion).toBeNull();
    expect(d.contentTypes.map((c) => c.id)).toEqual(["carousel", "image"]);
    expect(d.contentTypes.flatMap((c) => c.after).every((f) => f.state === "unchanged")).toBe(true);
  });

  it("flags a content type that appears or disappears", () => {
    const prev = tpl(1, { carousel: [field("title")] });
    const next = tpl(2, { carousel: [field("title")], image: [field("image")] });
    const added = buildDiff(next, prev, [change("image")]).contentTypes[0];
    expect(added).toMatchObject({ id: "image", isNew: true });
    expect(added.after[0].state).toBe("added");

    const removed = buildDiff(prev, next, [change("image")]).contentTypes[0];
    expect(removed).toMatchObject({ id: "image", isRemoved: true });
    expect(removed.before[0].state).toBe("removed");
  });

  it("returns no content types when only appearance changed", () => {
    const v = tpl(1, { carousel: [field("title")] });
    expect(buildDiff(tpl(2, { carousel: [field("title")] }), v, []).contentTypes).toEqual([]);
  });
});
