import { describe, expect, it } from "vitest";
import type { ContentTypeTemplateProps, EditorInterfaceTemplateProps } from "contentful-management";
import { classifyEntities, type Entities } from "@/lib/classify";

type F = ContentTypeTemplateProps["fields"][number];

const field = (id: string, extra: Partial<F> = {}): F =>
  ({ id, name: id, type: "Symbol", required: false, localized: false, ...extra }) as F;

const ct = (fields: F[], extra: Partial<ContentTypeTemplateProps> = {}): ContentTypeTemplateProps =>
  ({ id: "blogPost", name: "Blog post", displayField: "title", fields, ...extra }) as ContentTypeTemplateProps;

const ei = (widgetId: string): EditorInterfaceTemplateProps =>
  ({
    contentTypeTemplate: { sys: { type: "Link", linkType: "ContentTypeTemplate", id: "blogPost" } },
    controls: [{ fieldId: "title", widgetId, widgetNamespace: "builtin" }],
  }) as EditorInterfaceTemplateProps;

const ent = (cts: ContentTypeTemplateProps[], eis: EditorInterfaceTemplateProps[] = []): Entities => ({
  contentTypeTemplates: cts,
  editorInterfaceTemplates: eis,
});

describe("classifyEntities", () => {
  const base = ent([ct([field("title"), field("body", { type: "Text" })])], [ei("singleLine")]);

  it("reports no change for identical models", () => {
    const r = classifyEntities(base, structuredClone(base));
    expect(r.classification).toBe("none");
    expect(r.changes).toEqual([]);
  });

  it("treats the very first version as additive with nothing to diff", () => {
    expect(classifyEntities(undefined, base).classification).toBe("additive");
  });

  it("treats an added field as additive", () => {
    const next = ent([ct([field("title"), field("body", { type: "Text" }), field("subtitle")])], [ei("singleLine")]);
    const r = classifyEntities(base, next);
    expect(r.classification).toBe("additive");
    expect(r.changes.map((c) => c.code)).toEqual(["field-added"]);
    expect(r.changes[0].fieldId).toBe("subtitle");
  });

  it("treats validation, name and required changes as additive", () => {
    const next = ent(
      [
        ct([
          field("title", { name: "Headline", validations: [{ size: { max: 80 } }] }),
          field("body", { type: "Text", required: true }),
        ]),
      ],
      [ei("singleLine")],
    );
    const r = classifyEntities(base, next);
    expect(r.classification).toBe("additive");
    expect(r.changes.every((c) => c.code === "field-modified")).toBe(true);
    expect(r.changes).toHaveLength(2);
  });

  it("treats appearance (editor interface) changes as additive", () => {
    const r = classifyEntities(base, ent(base.contentTypeTemplates, [ei("multipleLine")]));
    expect(r.classification).toBe("additive");
    expect(r.changes.map((c) => c.code)).toEqual(["appearance-changed"]);
  });

  it("treats a content type name change as additive", () => {
    const next = ent([ct(base.contentTypeTemplates[0].fields, { name: "Article" })], [ei("singleLine")]);
    const r = classifyEntities(base, next);
    expect(r.classification).toBe("additive");
    expect(r.changes.map((c) => c.code)).toEqual(["content-type-modified"]);
  });

  it("treats a removed field as breaking", () => {
    const r = classifyEntities(base, ent([ct([field("title")])], [ei("singleLine")]));
    expect(r.classification).toBe("breaking");
    expect(r.changes).toMatchObject([{ code: "field-removed", fieldId: "body", kind: "breaking" }]);
  });

  it("treats a field type change as breaking", () => {
    const next = ent([ct([field("title"), field("body", { type: "Integer" })])], [ei("singleLine")]);
    const r = classifyEntities(base, next);
    expect(r.classification).toBe("breaking");
    expect(r.changes[0].code).toBe("field-type-changed");
  });

  it("treats a changed link target or array item type as a type change", () => {
    const a = ent([ct([field("author", { type: "Link", linkType: "Entry" })])]);
    const b = ent([ct([field("author", { type: "Link", linkType: "Asset" })])]);
    expect(classifyEntities(a, b).classification).toBe("breaking");

    const c = ent([ct([field("tags", { type: "Array", items: { type: "Symbol" } })])]);
    const d = ent([ct([field("tags", { type: "Array", items: { type: "Integer" } })])]);
    expect(classifyEntities(c, d).classification).toBe("breaking");
  });

  it("treats a field ID rename (same name and type, new id) as breaking, not remove + add", () => {
    const next = ent([ct([field("title"), field("content", { type: "Text", name: "body" })])], [ei("singleLine")]);
    const prev = ent([ct([field("title"), field("body", { type: "Text", name: "body" })])], [ei("singleLine")]);
    const r = classifyEntities(prev, next);
    expect(r.classification).toBe("breaking");
    expect(r.changes.map((c) => c.code)).toEqual(["field-renamed"]);
  });

  it("is breaking if any change is breaking, even alongside additive ones", () => {
    const next = ent([ct([field("title"), field("extra")])], [ei("singleLine")]); // body removed, extra added
    const r = classifyEntities(base, next);
    expect(r.classification).toBe("breaking");
    expect(r.changes.map((c) => c.code).sort()).toEqual(["field-added", "field-removed"]);
  });

  it("treats a removed content type as breaking and an added one as additive", () => {
    const other = ct([field("name")], { id: "author", name: "Author" });
    expect(classifyEntities(ent([...base.contentTypeTemplates, other]), base).classification).toBe("breaking");
    expect(classifyEntities(base, ent([...base.contentTypeTemplates, other])).classification).toBe("additive");
  });

  it("ignores key order and undefined values", () => {
    const a = ent([ct([{ id: "title", name: "title", type: "Symbol", required: false } as F])]);
    const b = ent([ct([{ required: false, type: "Symbol", name: "title", id: "title", disabled: undefined } as F])]);
    expect(classifyEntities(a, b).classification).toBe("none");
  });
});
