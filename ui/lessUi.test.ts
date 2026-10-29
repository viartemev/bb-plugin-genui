import { describe, expect, it } from "vitest";
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";
import { insertLessUiRequest, LESS_UI_REQUEST } from "./lessUi";

function context(options: { role?: "user" | "assistant"; composer?: unknown } = {}): PluginMessageActionContext {
  return {
    threadId: "thr_1",
    message: { id: "m1", threadId: "thr_1", role: options.role ?? "assistant", text: "…", sourceSeqEnd: 1, experimental_messageSeq: 1 },
    composer: options.composer === undefined ? ({ insert: () => {} } as never) : (options.composer as never),
    openPanel: () => false,
  } as unknown as PluginMessageActionContext;
}

describe("less UI request", () => {
  it("puts the request at the end of the composer", () => {
    const calls: unknown[] = [];
    const composer = { insert: (...args: unknown[]) => calls.push(args) };
    insertLessUiRequest(context({ composer }));
    expect(calls).toEqual([[LESS_UI_REQUEST, { at: "end", block: true }]]);
  });

  // Only a reply can hold too much UI, and a timeline without a composer has
  // nowhere to put the request.
  it("do nothing on a user message or without a composer", () => {
    const calls: unknown[] = [];
    insertLessUiRequest(context({ role: "user", composer: { insert: (...args: unknown[]) => calls.push(args) } }));
    expect(calls).toEqual([]);
    expect(() => insertLessUiRequest(context({ composer: null }))).not.toThrow();
  });

  it("ask for prose and a reason to show a block", () => {
    expect(LESS_UI_REQUEST).toContain("prose");
    expect(LESS_UI_REQUEST).toContain("only when");
  });
});
