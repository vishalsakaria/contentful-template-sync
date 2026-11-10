import { describe, expect, it } from "vitest";
import type { EnvironmentTemplateInstallationProps } from "contentful-management";
import { dedupeInstallations } from "@/lib/installations";

const inst = (
  space: string,
  env: string,
  version: number,
  createdAt: string,
  status: string = "succeeded",
): EnvironmentTemplateInstallationProps =>
  ({
    sys: {
      type: "EnvironmentTemplateInstallation",
      space: { sys: { type: "Link", linkType: "Space", id: space } },
      environment: { sys: { type: "Link", linkType: "Environment", id: env } },
      template: { sys: { type: "Link", linkType: "Template", id: "tpl", version } },
      status,
      createdAt,
      updatedAt: createdAt,
      version,
    },
  }) as unknown as EnvironmentTemplateInstallationProps;

const source = { spaceId: "SRC", environmentId: "master" };

describe("dedupeInstallations", () => {
  it("keeps only the highest installed version per space/environment", () => {
    const out = dedupeInstallations(
      [
        inst("A", "master", 1, "2026-01-01T00:00:00Z"),
        inst("A", "master", 3, "2026-03-01T00:00:00Z"),
        inst("A", "master", 2, "2026-02-01T00:00:00Z"),
        inst("B", "master", 2, "2026-02-01T00:00:00Z"),
      ],
      source,
    );
    expect(out.map((t) => [t.spaceId, t.installedVersion])).toEqual([
      ["A", 3],
      ["B", 2],
    ]);
  });

  it("treats different environments of one space as separate targets", () => {
    const out = dedupeInstallations(
      [inst("A", "master", 2, "2026-02-01T00:00:00Z"), inst("A", "staging", 1, "2026-01-01T00:00:00Z")],
      source,
    );
    expect(out.map((t) => `${t.spaceId}/${t.environmentId}`)).toEqual(["A/master", "A/staging"]);
  });

  it("breaks version ties by the most recent installation", () => {
    const out = dedupeInstallations(
      [inst("A", "master", 2, "2026-02-01T00:00:00Z", "failed"), inst("A", "master", 2, "2026-02-05T00:00:00Z", "succeeded")],
      source,
    );
    expect(out).toHaveLength(1);
    expect(out[0].installationStatus).toBe("succeeded");
  });

  it("never returns the source environment", () => {
    const out = dedupeInstallations(
      [inst("SRC", "master", 3, "2026-03-01T00:00:00Z"), inst("SRC", "sandbox", 3, "2026-03-01T00:00:00Z")],
      source,
    );
    expect(out.map((t) => `${t.spaceId}/${t.environmentId}`)).toEqual(["SRC/sandbox"]);
  });

  it("returns an empty list when nothing is installed", () => {
    expect(dedupeInstallations([], source)).toEqual([]);
  });
});
