import { describe, expect, it } from "vitest";
import { signRequest } from "@contentful/node-apps-toolkit";
import { decideWebhook, isWebhookAuthorized, verifyWebhookSignature } from "@/lib/webhook";

const SECRET = "x".repeat(64);
const path = "/api/contentful/webhook";
const body = JSON.stringify({ sys: { id: "blogPost" } });

function signed(overrides: { secret?: string; body?: string; timestamp?: number } = {}) {
  const headers = { "content-type": "application/json", "x-contentful-topic": "ContentManagement.ContentType.publish" };
  const sig = signRequest(
    overrides.secret ?? SECRET,
    { method: "POST", path, headers, body: overrides.body ?? body },
    overrides.timestamp ?? Date.now(),
  );
  return { ...headers, ...sig } as Record<string, string>;
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyWebhookSignature({ secret: SECRET, method: "POST", path, headers: signed(), body })).toBe(true);
  });

  it("rejects a request signed with a different secret", () => {
    const headers = signed({ secret: "y".repeat(64) });
    expect(verifyWebhookSignature({ secret: SECRET, method: "POST", path, headers, body })).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, method: "POST", path, headers: signed(), body: body.replace("blogPost", "other") }),
    ).toBe(false);
  });

  it("rejects a different path", () => {
    expect(verifyWebhookSignature({ secret: SECRET, method: "POST", path: "/other", headers: signed(), body })).toBe(false);
  });

  it("rejects an unsigned request without throwing", () => {
    expect(verifyWebhookSignature({ secret: SECRET, method: "POST", path, headers: {}, body })).toBe(false);
  });

  it("rejects an expired signature", () => {
    const headers = signed({ timestamp: Date.now() - 10 * 60_000 });
    expect(verifyWebhookSignature({ secret: SECRET, method: "POST", path, headers, body, ttlSeconds: 60 })).toBe(false);
  });
});

describe("decideWebhook", () => {
  const source = { spaceId: "SRC", environmentId: "master" };
  const sys = (extra: object = {}) => ({
    sys: {
      id: "blogPost",
      space: { sys: { id: "SRC" } },
      environment: { sys: { id: "master" } },
      ...extra,
    },
  });

  it("syncs on ContentType.publish from the source", () => {
    expect(decideWebhook("ContentManagement.ContentType.publish", sys(), source)).toMatchObject({
      action: "sync",
      contentTypeId: "blogPost",
    });
  });

  it("syncs on EditorInterface.save using the parent content type id", () => {
    const body = sys({ id: "editor-interface-id", contentType: { sys: { id: "article" } } });
    expect(decideWebhook("ContentManagement.EditorInterface.save", body, source)).toMatchObject({
      action: "sync",
      contentTypeId: "article",
    });
  });

  it("logs but does not propagate ContentType.delete", () => {
    expect(decideWebhook("ContentManagement.ContentType.delete", sys(), source).action).toBe("log-delete");
  });

  it("ignores events from another space or environment (loop guard)", () => {
    const otherSpace = { sys: { id: "x", space: { sys: { id: "OTHER" } }, environment: { sys: { id: "master" } } } };
    const otherEnv = { sys: { id: "x", space: { sys: { id: "SRC" } }, environment: { sys: { id: "staging" } } } };
    expect(decideWebhook("ContentManagement.ContentType.publish", otherSpace, source).action).toBe("ignore");
    expect(decideWebhook("ContentManagement.ContentType.publish", otherEnv, source).action).toBe("ignore");
  });

  it("ignores topics it does not handle", () => {
    expect(decideWebhook("ContentManagement.Entry.publish", sys(), source).action).toBe("ignore");
  });
});

describe("isWebhookAuthorized", () => {
  const base = { method: "POST", path, body };
  const basic = (user: string, pw: string) => "Basic " + btoa(`${user}:${pw}`);

  it("allows everything when no secret is configured", () => {
    expect(isWebhookAuthorized({ ...base, secret: undefined, headers: {} })).toBe(true);
  });

  it("accepts the x-webhook-secret header", () => {
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { "x-webhook-secret": "s3cret" } })).toBe(true);
  });

  it("accepts Basic Auth with the secret as the password, any username", () => {
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { authorization: basic("contentful", "s3cret") } })).toBe(true);
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { authorization: basic("", "s3cret") } })).toBe(true);
  });

  it("rejects a wrong header, wrong Basic password, malformed Basic and no credentials", () => {
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { "x-webhook-secret": "nope" } })).toBe(false);
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { authorization: basic("u", "nope") } })).toBe(false);
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: { authorization: "Basic !!!" } })).toBe(false);
    expect(isWebhookAuthorized({ ...base, secret: "s3cret", headers: {} })).toBe(false);
  });

  it("still accepts a valid Contentful signature made with the same secret", () => {
    expect(isWebhookAuthorized({ ...base, secret: SECRET, headers: signed() })).toBe(true);
  });
});
