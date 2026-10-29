import { describe, expect, it } from "vitest";
import { ACTIONS, COMPONENTS } from "./core/catalog";
import { collectLoads, compile, dataKey, evaluate, formatDiagnostics, initialState, type LoadedData } from "./core";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_BY_VERBOSITY,
  AGENT_INSTRUCTIONS_WEB_OFF,
  agentInstructions,
  CODE_WORK_INSTRUCTIONS,
  UI_REFERENCE,
  UI_REFERENCE_MORE,
  WEB_LOOKUPS_OFF,
} from "./instructions";
import { DEFAULT_VERBOSITY, VERBOSITY_LEVELS, type Verbosity } from "./verbosity";

const SHOWN = VERBOSITY_LEVELS.filter((level): level is Exclude<Verbosity, "off"> => level !== "off");

describe("agent instructions", () => {
  // BB refuses a tool whose instructions pass 4096 characters (the plugin then
  // fails to load) and truncates the configure and contributed sections there.
  it("fit BB's 4096-character cap per section, at every verbosity level", () => {
    expect(AGENT_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    expect(AGENT_INSTRUCTIONS_WEB_OFF.length).toBeLessThanOrEqual(4096);
    expect(CODE_WORK_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    expect(UI_REFERENCE.length).toBeLessThanOrEqual(4096);
    expect(UI_REFERENCE_MORE.length).toBeLessThanOrEqual(4096);
    for (const level of SHOWN) {
      expect(AGENT_INSTRUCTIONS_BY_VERBOSITY[level].length, level).toBeLessThanOrEqual(4096);
      expect(agentInstructions(level, false).length, `${level} with lookups off`).toBeLessThanOrEqual(4096);
    }
  });

  // Each level has to be a different amount of asking, or the setting is a
  // relabelled switch: sparing < normal < eager, and "off" says nothing at all.
  it("get quieter from eager down to off", () => {
    expect(agentInstructions("off")).toBe("");
    expect(AGENT_INSTRUCTIONS_BY_VERBOSITY.sparing.length).toBeLessThan(AGENT_INSTRUCTIONS_BY_VERBOSITY.normal.length);
    expect(AGENT_INSTRUCTIONS_BY_VERBOSITY.normal.length).toBeLessThan(AGENT_INSTRUCTIONS_BY_VERBOSITY.eager.length);
  });

  // The default is the level most readers want; "eager" keeps the old text so
  // an upgrade does not silently change behaviour for anyone who picks it.
  it("default to the normal level and keep eager as the old prompt", () => {
    expect(AGENT_INSTRUCTIONS).toBe(AGENT_INSTRUCTIONS_BY_VERBOSITY[DEFAULT_VERBOSITY]);
    expect(AGENT_INSTRUCTIONS_BY_VERBOSITY.eager).toContain("In doubt, add the block.");
    expect(AGENT_INSTRUCTIONS_BY_VERBOSITY.normal).not.toContain("In doubt, add the block.");
    expect(AGENT_INSTRUCTIONS_BY_VERBOSITY.sparing).not.toContain("In doubt, add the block.");
  });

  // A replace that silently matches nothing would keep teaching Map while lookups are off.
  it("swap the Map example for the off note while web lookups are off", () => {
    expect(AGENT_INSTRUCTIONS_WEB_OFF).toContain(WEB_LOOKUPS_OFF);
    expect(AGENT_INSTRUCTIONS_WEB_OFF).not.toContain("Map(");
    for (const level of SHOWN) {
      expect(agentInstructions(level, false), level).not.toContain("Map(");
    }
  });

  // The Evidence group's signatures ride on the code-work section, which every session that gets the references also gets.
  it("list every component and action the parser accepts", () => {
    const reference = `${UI_REFERENCE}\n${UI_REFERENCE_MORE}\n${CODE_WORK_INSTRUCTIONS}`;
    for (const name of [...Object.keys(COMPONENTS), ...Object.keys(ACTIONS)]) {
      expect(reference, name).toContain(`${name}(`);
    }
  });

  it("carry examples that compile and render without errors, at every level", () => {
    for (const level of SHOWN) {
      const source = `${AGENT_INSTRUCTIONS_BY_VERBOSITY[level]}\n${CODE_WORK_INSTRUCTIONS}`;
      const examples = [...source.matchAll(/```ui\n([\s\S]*?)\n```/g)].map((match) => match[1]);
      expect(examples.length, level).toBeGreaterThan(0);
      for (const example of examples) {
        const compiled = compile(example);
        expect(formatDiagnostics(compiled.diagnostics), example).toBe("");
        const program = compiled.program!;
        // Example paths are illustrative: each Load reads as an empty report.
        const data = new Map<string, LoadedData>(collectLoads(program).map((request) => [dataKey(request), { ok: true, value: [] }]));
        const { diagnostics } = evaluate(program, initialState(program, data), data);
        expect(diagnostics, example).toEqual([]);
      }
    }
  });

  // The eager level is the text agents got before the setting; a rewrite of a
  // shared fragment must not quietly soften it.
  it("keep the five worked examples in the eager level", () => {
    const examples = [...AGENT_INSTRUCTIONS_BY_VERBOSITY.eager.matchAll(/```ui\n/g)].length;
    expect(examples).toBe(5);
  });
});
