import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERBOSITY,
  isVerbosity,
  MAX_VERBOSITY_OVERRIDES,
  NO_OVERRIDES,
  parseOverrides,
  quieter,
  resolveVerbosity,
  VERBOSITY_LEVELS,
  withOverride,
} from "./verbosity";

describe("verbosity levels", () => {
  it("recognize only the four levels", () => {
    for (const level of VERBOSITY_LEVELS) expect(isVerbosity(level)).toBe(true);
    for (const value of ["", "loud", "Normal", null, undefined, 3, true, {}]) expect(isVerbosity(value)).toBe(false);
  });

  // The setting exists to be turned down, so the ladder has to be walkable in
  // that direction and stop at "off".
  it("step down to off and stay there", () => {
    expect(quieter("eager")).toBe("normal");
    expect(quieter("normal")).toBe("sparing");
    expect(quieter("sparing")).toBe("off");
    expect(quieter("off")).toBe("off");
  });

  it("default to normal", () => {
    expect(DEFAULT_VERBOSITY).toBe("normal");
  });
});

describe("verbosity resolution", () => {
  const overrides = { projects: { proj_a: "sparing" as const }, threads: { thr_1: "off" as const } };

  it("prefer a thread override, then a project's, then the setting", () => {
    expect(resolveVerbosity("eager", overrides, { threadId: "thr_1", projectId: "proj_a" })).toBe("off");
    expect(resolveVerbosity("eager", overrides, { threadId: "thr_2", projectId: "proj_a" })).toBe("sparing");
    expect(resolveVerbosity("eager", overrides, { threadId: "thr_2", projectId: "proj_b" })).toBe("eager");
    expect(resolveVerbosity("eager", overrides, {})).toBe("eager");
  });

  // "off" is the quietest thing a user can say: a project override must not
  // turn UI back on in a thread that asked for none.
  it("keep a thread's off over a louder project", () => {
    expect(resolveVerbosity("eager", overrides, { threadId: "thr_1", projectId: "proj_a" })).toBe("off");
  });
});

describe("verbosity overrides", () => {
  it("set and clear one scope without touching the others", () => {
    const set = withOverride(NO_OVERRIDES, { thread: "thr_1" }, "off");
    expect(set.threads).toEqual({ thr_1: "off" });
    expect(NO_OVERRIDES.threads).toEqual({});

    const withProject = withOverride(set, { project: "proj_a" }, "sparing");
    expect(withProject).toEqual({ projects: { proj_a: "sparing" }, threads: { thr_1: "off" } });

    expect(withOverride(withProject, { thread: "thr_1" }, null)).toEqual({ projects: { proj_a: "sparing" }, threads: {} });
    expect(withOverride(withProject, { project: "proj_a" }, null)).toEqual({ projects: {}, threads: { thr_1: "off" } });
  });

  it("refuse a scope that is neither a project nor a thread", () => {
    expect(() => withOverride(NO_OVERRIDES, {}, "off")).toThrow();
  });

  // A thread id per muted thread would grow without bound on a long-running
  // host; the store keeps the most recently written ones.
  it("keep the store bounded, dropping the oldest thread overrides", () => {
    let current = NO_OVERRIDES;
    const count = MAX_VERBOSITY_OVERRIDES + 5;
    for (let index = 0; index < count; index += 1) current = withOverride(current, { thread: `thr_${index}` }, "off");
    const ids = Object.keys(current.threads);
    expect(ids.length).toBe(MAX_VERBOSITY_OVERRIDES);
    expect(ids).not.toContain("thr_0");
    expect(ids).toContain(`thr_${count - 1}`);
  });
});

describe("reading stored overrides", () => {
  it("accept nothing at all as no overrides", () => {
    for (const value of [undefined, null, 3, "off", [], true]) expect(parseOverrides(value)).toEqual(NO_OVERRIDES);
  });

  // The row is read on every boot: a stale or hand-edited value must not
  // fail the plugin, only lose the entries it cannot use.
  it("drop entries that are not levels", () => {
    expect(
      parseOverrides({
        projects: { proj_a: "sparing", proj_b: "loud", proj_c: 7 },
        threads: { thr_1: "off" },
        extra: { thr_2: "eager" },
      }),
    ).toEqual({ projects: { proj_a: "sparing" }, threads: { thr_1: "off" } });
  });
});
