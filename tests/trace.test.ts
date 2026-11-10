import { describe, expect, it } from "vitest";
import { api, clip, step, traceLogLines, withTrace } from "@/lib/trace";

describe("trace recorder", () => {
  it("is a no-op outside a trace (the wrapped call still runs)", async () => {
    step({ kind: "decision", title: "ignored" });
    await expect(api({ title: "t", method: "GET", url: "/x" }, async () => 42)).resolves.toBe(42);
  });

  it("records api calls, decisions and a summary in order", async () => {
    const { result, trace } = await withTrace("dry-run", async () => {
      const a = await api({ title: "Read", method: "GET", url: "/a", summarize: (r: { v: number }) => ({ version: r.v }) }, async () => ({ v: 3 }));
      step({ kind: "decision", title: "Decide", result: "additive", notes: ["x"] });
      await api({ title: "Write", method: "PUT", url: "/b", write: true, request: { body: 1 }, okStatus: 201 }, async () => ({}));
      return a.v;
    });
    expect(result).toBe(3);
    expect(trace.steps.map((s) => [s.n, s.kind, s.title])).toEqual([
      [1, "api", "Read"],
      [2, "decision", "Decide"],
      [3, "api", "Write"],
    ]);
    expect(trace.steps[0]).toMatchObject({ method: "GET", url: "/a", status: 200, response: { version: 3 } });
    expect(trace.steps[2]).toMatchObject({ write: true, status: 201, request: { body: 1 } });
    expect(trace.summary).toMatchObject({ calls: 2, writes: 1 });
    expect(trace.mode).toBe("dry-run");
  });

  it("records a failed call with its error, rethrows, and keeps the trace", async () => {
    const { result, trace } = await withTrace("live", async () => {
      await api({ title: "Boom", method: "GET", url: "/z" }, async () => {
        throw Object.assign(new Error("nope"), { status: 404 });
      });
    });
    expect(result).toBeUndefined();
    expect(trace.error).toContain("nope");
    expect(trace.steps[0]).toMatchObject({ kind: "api", status: 404, error: "nope" });
    expect(trace.summary.writes).toBe(0); // a failed write is not counted
  });

  it("follows concurrent work started inside the trace", async () => {
    const { trace } = await withTrace("live", async () => {
      await Promise.all([1, 2, 3].map((i) => api({ title: `c${i}`, method: "GET", url: `/${i}` }, async () => i)));
    });
    expect(trace.steps).toHaveLength(3);
  });

  it("keeps separate traces separate", async () => {
    const [a, b] = await Promise.all([
      withTrace("live", () => api({ title: "A", method: "GET", url: "/a" }, async () => 1)),
      withTrace("live", () => api({ title: "B", method: "GET", url: "/b" }, async () => 2)),
    ]);
    expect(a.trace.steps.map((s) => s.title)).toEqual(["A"]);
    expect(b.trace.steps.map((s) => s.title)).toEqual(["B"]);
  });

  it("truncates oversized payloads but keeps small ones intact", () => {
    expect(clip({ a: 1 })).toEqual({ a: 1 });
    const big = clip({ blob: "x".repeat(10_000) }) as Record<string, unknown>;
    expect(big["…truncated"]).toMatch(/chars/);
    expect(JSON.stringify(big).length).toBeLessThan(5_000);
  });

  it("never records anything it was not given (no auth header leaks into steps)", async () => {
    const { trace } = await withTrace("live", () =>
      api({ title: "t", method: "GET", url: "/x", request: { headers: { "X-Contentful-Version": 2 } } }, async () => ({})),
    );
    expect(JSON.stringify(trace)).not.toMatch(/authorization|bearer/i);
  });

  it("produces compact log lines for webhook runs", async () => {
    const { trace } = await withTrace("live", async () => {
      await api({ title: "t", method: "PUT", url: "/p", write: true }, async () => ({}));
      step({ kind: "decision", title: "Rollout policy", result: "held" });
    });
    expect(traceLogLines(trace)).toEqual(["1. PUT /p → 200 (" + trace.steps[0].ms + "ms) [write]", "2. Rollout policy → held"]);
  });
});
