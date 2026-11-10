import type {
  ContentTypeProps,
  ContentTypeTemplateProps,
  EditorInterfaceProps,
  EditorInterfaceTemplateProps,
  EnvironmentTemplateProps,
} from "contentful-management";
import pLimit from "p-limit";
import { getConfig } from "./config";
import { cma, describeError, errorStatus, log, withBackoff } from "./cma";
import { classifyEntities, deepEqual, describeType, summarize, type ClassifyResult } from "./classify";
import { api, step } from "./trace";

/* ---------- trace summaries (what we show for responses) ---------- */

export function summarizeTemplate(t: EnvironmentTemplateProps) {
  return {
    sys: { version: t.sys.version },
    name: t.name,
    versionName: t.versionName,
    entities: {
      contentTypeTemplates: t.entities.contentTypeTemplates.map((c) => ({
        id: c.id,
        basedOn: c.basedOn ? `${c.basedOn.space.sys.id}/${c.basedOn.environment.sys.id}/${c.basedOn.contentType.sys.id}` : undefined,
        fields: c.fields.map((f) => `${f.id}: ${describeType(f)}`),
      })),
      editorInterfaceTemplates: `${t.entities.editorInterfaceTemplates.length} editor interface(s)`,
    },
  };
}

const sourceCtView = (c: ContentTypeProps) => ({
  sys: { id: c.sys.id, version: c.sys.version },
  name: c.name,
  description: c.description,
  displayField: c.displayField,
  fields: c.fields,
});

const withoutSys = <T extends { sys?: unknown }>(o: T) => {
  const { sys: _s, ...rest } = o;
  void _s;
  return rest;
};

/* ---------- reads ---------- */

export async function getTemplate(templateId: string): Promise<EnvironmentTemplateProps> {
  const { CONTENTFUL_ORG_ID } = getConfig();
  return api(
    {
      title: "Read the current template (latest version)",
      method: "GET",
      url: `/organizations/${CONTENTFUL_ORG_ID}/environment_templates/${templateId}`,
      summarize: summarizeTemplate,
    },
    () =>
      withBackoff(() =>
        cma().environmentTemplate.get({ organizationId: CONTENTFUL_ORG_ID, environmentTemplateId: templateId }),
      ),
  );
}

/** A single template version including its entities. */
export async function getTemplateVersion(templateId: string, version: number): Promise<EnvironmentTemplateProps> {
  const { CONTENTFUL_ORG_ID } = getConfig();
  return api(
    {
      title: `Read template version ${version}`,
      method: "GET",
      url: `/organizations/${CONTENTFUL_ORG_ID}/environment_templates/${templateId}?version=${version}`,
      summarize: summarizeTemplate,
    },
    () =>
      withBackoff(() =>
        cma().environmentTemplate.get({ organizationId: CONTENTFUL_ORG_ID, environmentTemplateId: templateId, version }),
      ),
  );
}

/** Published versions never change, so their full bodies are cached for the life of the process. */
const versionCache = new Map<string, EnvironmentTemplateProps>();

/**
 * Version history, newest first, with entities.
 * NOTE: the list endpoint returns metadata only (no `entities`), so each version is fetched
 * individually (3 at a time) and cached.
 */
export async function getVersions(templateId: string, limit = 20): Promise<EnvironmentTemplateProps[]> {
  const { CONTENTFUL_ORG_ID } = getConfig();
  const res = await api(
    {
      title: "List template versions (metadata only)",
      method: "GET",
      url: `/organizations/${CONTENTFUL_ORG_ID}/environment_templates/${templateId}/versions?limit=${limit}`,
      summarize: (r) => r.items.map((v) => ({ version: v.sys.version, versionName: v.versionName, createdAt: v.sys.createdAt })),
    },
    () =>
      withBackoff(() =>
        cma().environmentTemplate.versions({
          organizationId: CONTENTFUL_ORG_ID,
          environmentTemplateId: templateId,
          query: { limit },
        }),
      ),
  );
  const pending = pLimit(3);
  const full = await Promise.all(
    res.items.map((item) =>
      pending(async () => {
        const n = Number(item.sys.version);
        const key = `${templateId}/${n}`;
        const hit = versionCache.get(key);
        if (hit) return hit;
        const v = item.entities ? item : await getTemplateVersion(templateId, n);
        versionCache.set(key, v);
        return v;
      }),
    ),
  );
  return full.sort((a, b) => Number(b.sys.version) - Number(a.sys.version));
}

export async function getSourceContentType(contentTypeId: string): Promise<ContentTypeProps> {
  const { SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();
  return api(
    {
      title: `Read source content type “${contentTypeId}”`,
      method: "GET",
      url: `/spaces/${SOURCE_SPACE_ID}/environments/${SOURCE_ENVIRONMENT_ID}/content_types/${contentTypeId}`,
      summarize: sourceCtView,
    },
    () =>
      withBackoff(() =>
        cma().contentType.get({
          spaceId: SOURCE_SPACE_ID,
          environmentId: SOURCE_ENVIRONMENT_ID,
          contentTypeId,
        }),
      ),
  );
}

export async function getSourceEditorInterface(contentTypeId: string): Promise<EditorInterfaceProps> {
  const { SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();
  return api(
    {
      title: `Read source editor interface for “${contentTypeId}”`,
      method: "GET",
      url: `/spaces/${SOURCE_SPACE_ID}/environments/${SOURCE_ENVIRONMENT_ID}/content_types/${contentTypeId}/editor_interface`,
      summarize: (e) => withoutSys(e),
    },
    () =>
      withBackoff(() =>
        cma().editorInterface.get({
          spaceId: SOURCE_SPACE_ID,
          environmentId: SOURCE_ENVIRONMENT_ID,
          contentTypeId,
        }),
      ),
  );
}

/* ---------- mapping source -> template shape ---------- */

/**
 * Finds the template content type that mirrors a source content type: first by its
 * `basedOn` link back to the source, then by identical ID.
 */
export function findTemplateContentType(
  template: Pick<EnvironmentTemplateProps, "entities">,
  sourceContentTypeId: string,
): ContentTypeTemplateProps | undefined {
  const { SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();
  const cts = template.entities.contentTypeTemplates;
  return (
    cts.find(
      (c) =>
        c.basedOn?.contentType.sys.id === sourceContentTypeId &&
        c.basedOn.space.sys.id === SOURCE_SPACE_ID &&
        c.basedOn.environment.sys.id === SOURCE_ENVIRONMENT_ID,
    ) ?? cts.find((c) => c.id === sourceContentTypeId)
  );
}

export function toContentTypeTemplate(
  source: ContentTypeProps,
  existing: ContentTypeTemplateProps,
): ContentTypeTemplateProps {
  const { sys: _sys, ...body } = source;
  void _sys;
  const { SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();
  return {
    ...body,
    id: existing.id,
    basedOn: existing.basedOn ?? {
      space: { sys: { type: "Link", linkType: "Space", id: SOURCE_SPACE_ID } },
      environment: { sys: { type: "Link", linkType: "Environment", id: SOURCE_ENVIRONMENT_ID } },
      contentType: { sys: { type: "Link", linkType: "ContentType", id: source.sys.id } },
    },
    ...(existing.hints ? { hints: existing.hints } : {}),
  };
}

export function toEditorInterfaceTemplate(
  source: EditorInterfaceProps,
  templateContentTypeId: string,
): EditorInterfaceTemplateProps {
  const { sys: _sys, ...body } = source;
  void _sys;
  return {
    ...body,
    contentTypeTemplate: { sys: { type: "Link", linkType: "ContentTypeTemplate", id: templateContentTypeId } },
  };
}

/** Comparison views: ignore bookkeeping (basedOn/hints) that is not part of the model itself. */
const ctView = (c: ContentTypeTemplateProps) => ({
  name: c.name,
  description: c.description,
  displayField: c.displayField,
  fields: c.fields,
});
const eiView = (e: EditorInterfaceTemplateProps) => {
  const { contentTypeTemplate: _l, ...rest } = e;
  void _l;
  return rest;
};

/* ---------- sync ---------- */

export interface SyncOptions {
  /** Source content type IDs to sync. Omit to sync every content type the template mirrors. */
  contentTypeIds?: string[];
  dryRun?: boolean;
}

export interface SyncResult {
  templateId: string;
  status: "updated" | "unchanged" | "skipped" | "dry-run";
  reason?: string;
  fromVersion?: number;
  toVersion?: number;
  classification?: ClassifyResult;
  syncedContentTypes: string[];
}

function buildNextBody(
  template: EnvironmentTemplateProps,
  replacements: Array<{ ct: ContentTypeTemplateProps; ei?: EditorInterfaceTemplateProps }>,
): EnvironmentTemplateProps["entities"] {
  const cts = template.entities.contentTypeTemplates.map(
    (c) => replacements.find((r) => r.ct.id === c.id)?.ct ?? c,
  );
  const eis = [...template.entities.editorInterfaceTemplates];
  for (const { ct, ei } of replacements) {
    if (!ei) continue;
    const idx = eis.findIndex((e) => e.contentTypeTemplate.sys.id === ct.id);
    if (idx >= 0) eis[idx] = ei;
    else eis.push(ei);
  }
  return { contentTypeTemplates: cts, editorInterfaceTemplates: eis };
}

export async function syncTemplate(templateId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const { CONTENTFUL_ORG_ID, SOURCE_SPACE_ID, SOURCE_ENVIRONMENT_ID } = getConfig();

  // On a 409 we re-fetch and retry the whole computation once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const template = await getTemplate(templateId);
    const fromVersion = Number(template.sys.version);

    const wanted =
      opts.contentTypeIds ??
      template.entities.contentTypeTemplates
        .map((c) => c.basedOn?.contentType.sys.id ?? c.id)
        .filter((id, i, all) => all.indexOf(id) === i);

    const replacements: Array<{ ct: ContentTypeTemplateProps; ei?: EditorInterfaceTemplateProps }> = [];
    const synced: string[] = [];

    for (const sourceId of wanted) {
      const existing = findTemplateContentType(template, sourceId);
      if (!existing) {
        log("sync.skip.not-in-template", { templateId, contentTypeId: sourceId });
        step({
          kind: "decision",
          title: `Is “${sourceId}” part of the template?`,
          result: "skipped",
          notes: [`No template content type is based on ${SOURCE_SPACE_ID}/${SOURCE_ENVIRONMENT_ID}/${sourceId}, so there is nothing to sync.`],
        });
        continue;
      }
      let source: ContentTypeProps;
      let sourceEi: EditorInterfaceProps | undefined;
      try {
        source = await getSourceContentType(sourceId);
      } catch (err) {
        if (errorStatus(err) === 404) {
          log("sync.skip.source-missing", { templateId, contentTypeId: sourceId });
          continue;
        }
        throw err;
      }
      try {
        sourceEi = await getSourceEditorInterface(sourceId);
      } catch (err) {
        if (errorStatus(err) !== 404) throw err;
      }
      const ct = toContentTypeTemplate(source, existing);
      const ei = sourceEi ? toEditorInterfaceTemplate(sourceEi, existing.id) : undefined;

      step({
        kind: "map",
        title: `Map content type “${source.name}” → template content type`,
        from: sourceCtView(source),
        to: ct,
        notes: [
          "`sys` dropped — space/environment/version/user metadata is not part of a template",
          `\`id\` kept from the existing template content type ("${existing.id}")`,
          `\`basedOn\` link kept → ${SOURCE_SPACE_ID}/${SOURCE_ENVIRONMENT_ID}/${source.sys.id}`,
          `${source.fields.length} field definition(s) copied 1:1`,
        ],
      });
      if (ei && sourceEi) {
        step({
          kind: "map",
          title: `Map editor interface for “${source.name}” → template editor interface`,
          from: withoutSys(sourceEi),
          to: ei,
          notes: [
            "`sys` dropped",
            `\`contentTypeTemplate\` link added → "${existing.id}"`,
            `${sourceEi.controls?.length ?? 0} field control(s) copied 1:1`,
          ],
        });
      }

      const existingEi = template.entities.editorInterfaceTemplates.find(
        (e) => e.contentTypeTemplate.sys.id === existing.id,
      );
      const same =
        deepEqual(ctView(existing), ctView(ct)) &&
        (!ei || (existingEi !== undefined && deepEqual(eiView(existingEi), eiView(ei))));

      const local = classifyEntities(
        { contentTypeTemplates: [existing], editorInterfaceTemplates: existingEi ? [existingEi] : [] },
        { contentTypeTemplates: [ct], editorInterfaceTemplates: ei ? [ei] : [] },
      );
      step({
        kind: "decision",
        title: `Compare “${source.name}” with the current template`,
        result: same ? "identical" : "changed",
        notes: same
          ? ["Template already matches the source model — nothing to write (the sync is idempotent)"]
          : local.changes.length
            ? local.changes.map((c) => `${c.kind === "breaking" ? "▲" : "＋"} ${c.detail}`)
            : ["Definitions differ"],
      });
      if (same) continue; // idempotent: already matches the source

      replacements.push({ ct, ei });
      synced.push(sourceId);
    }

    if (replacements.length === 0) {
      return {
        templateId,
        status: wanted.some((id) => findTemplateContentType(template, id)) ? "unchanged" : "skipped",
        reason: "Template already matches the source (or the content type is not part of the template)",
        fromVersion,
        syncedContentTypes: [],
      };
    }

    const entities = buildNextBody(template, replacements);
    const classification = classifyEntities(template.entities, entities);
    step({
      kind: "decision",
      title: "Classify the change",
      result: classification.classification,
      notes: classification.changes.map((c) => `${c.kind === "breaking" ? "▲ breaking" : "＋ additive"} — ${c.detail}`),
    });

    if (opts.dryRun) {
      step({
        kind: "decision",
        title: "Dry run — stopping before the write",
        result: "no write",
        notes: [`A live run would now create template version ${fromVersion + 1}.`],
      });
      return {
        templateId,
        status: "dry-run",
        fromVersion,
        classification,
        syncedContentTypes: synced,
        reason: summarize(classification),
      };
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const next: EnvironmentTemplateProps = {
      ...template,
      entities,
      versionName: `Auto-sync ${now} UTC`,
      versionDescription: `[${classification.classification}] ${summarize(classification)}`.slice(0, 500),
    };

    try {
      const updated = await api(
        {
          title: "Create a new template version",
          method: "PUT",
          write: true,
          url: `/organizations/${CONTENTFUL_ORG_ID}/environment_templates/${templateId}`,
          request: {
            headers: { "X-Contentful-Version": fromVersion },
            body: {
              versionName: next.versionName,
              versionDescription: next.versionDescription,
              "entities (changed parts only — the full body is sent)": {
                contentTypeTemplates: replacements.map((r) => r.ct),
                editorInterfaceTemplates: replacements.flatMap((r) => (r.ei ? [r.ei] : [])),
              },
            },
          },
          summarize: (u) => ({ sys: { version: u.sys.version }, versionName: u.versionName, versionDescription: u.versionDescription }),
        },
        () =>
          withBackoff(() =>
            cma().environmentTemplate.update(
              { organizationId: CONTENTFUL_ORG_ID, environmentTemplateId: templateId },
              next,
              { "X-Contentful-Version": fromVersion },
            ),
          ),
      );
      const toVersion = Number(updated.sys.version);
      log("sync.updated", { templateId, fromVersion, toVersion, classification: classification.classification, synced });
      return { templateId, status: "updated", fromVersion, toVersion, classification, syncedContentTypes: synced };
    } catch (err) {
      if (errorStatus(err) === 409 && attempt === 0) {
        log("sync.conflict-retry", { templateId });
        step({
          kind: "decision",
          title: "Version conflict (409) — re-reading and retrying once",
          result: "retry",
          notes: ["Someone else changed the template between our read and write; X-Contentful-Version locked the write."],
        });
        continue;
      }
      throw new Error(`Template update failed: ${describeError(err)}`);
    }
  }
  throw new Error("unreachable");
}
