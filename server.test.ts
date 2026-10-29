import type { PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { agentInstructions, CODE_WORK_INSTRUCTIONS } from "./instructions";
import plugin from "./server";

describe("the plugin's settings", () => {
  it("lists Animations, on by default, beside Web lookups", async () => {
    const host = createFakePluginHost({ pluginId: "genui" });
    await plugin(host.bb);
    expect(host.harness.registrations.settingsDescriptors).toMatchObject({
      animations: { type: "boolean", label: "Animations", default: true },
      webLookups: { type: "boolean", label: "Web lookups", default: true },
    });
  });
});

/** A thread a person reads: top-level, started by no plugin. */
function personContext(threadId: string, projectId = "proj_a"): PluginAgentConfigurationContext {
  return {
    pluginMetadata: {},
    thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: projectId, kind: "standard", name: "a", gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: null, branchName: null, workspaceProvisionType: null },
    host: { id: "host_1", name: "host" },
    provider: { id: "claude", model: "m", capabilities: { supportsNativeUserQuestion: false } },
    origin: { kind: null, pluginId: null },
  };
}

async function loaded(settings?: Record<string, string | boolean>) {
  const host = createFakePluginHost({ pluginId: "genui", settings });
  await plugin(host.bb);
  return host;
}

describe("the verbosity level a session gets", () => {
  it("defaults to normal, with both tools and the code-work section", async () => {
    const { harness } = await loaded();
    const resolved = await harness.resolveAgentConfiguration(personContext("thr_1"));
    expect(resolved.tools.map((tool) => tool.name).sort()).toEqual(["check_ui", "ui_examples"]);
    expect(resolved.instructions).toBe(agentInstructions("normal"));
    expect(harness.registrations.instructionProvider!({ threadId: "thr_1", projectId: "proj_a" })).toBe(CODE_WORK_INSTRUCTIONS);
  });

  // "off" withholds the rules, both tools and the code-work section.
  it("gives an off session nothing at all", async () => {
    const { harness } = await loaded({ verbosity: "off" });
    const resolved = await harness.resolveAgentConfiguration(personContext("thr_1"));
    expect(resolved.tools).toEqual([]);
    expect(resolved.instructions ?? "").toBe("");
    expect(harness.registrations.instructionProvider!({ threadId: "thr_1", projectId: "proj_a" })).toBeNull();
  });

  it("follows the host setting when it changes", async () => {
    const { harness } = await loaded();
    await harness.setSettings({ verbosity: "eager" });
    expect((await harness.resolveAgentConfiguration(personContext("thr_1"))).instructions).toBe(agentInstructions("eager"));
  });

  it("lets a project beat the setting and a thread beat its project", async () => {
    const { harness } = await loaded();
    expect((await harness.runCli(["verbosity", "sparing", "--project"], { threadId: "thr_1", projectId: "proj_a" })).exitCode).toBe(0);
    expect((await harness.runCli(["verbosity", "eager"], { threadId: "thr_1", projectId: "proj_a" })).exitCode).toBe(0);
    expect((await harness.resolveAgentConfiguration(personContext("thr_1"))).instructions).toBe(agentInstructions("eager"));
    expect((await harness.resolveAgentConfiguration(personContext("thr_2"))).instructions).toBe(agentInstructions("sparing"));
    expect((await harness.resolveAgentConfiguration(personContext("thr_3", "proj_b"))).instructions).toBe(agentInstructions("normal"));
    const shown = await harness.runCli(["verbosity"], { threadId: "thr_2", projectId: "proj_a" });
    expect(shown.stdout).toBe("sparing (project proj_a)\n");
  });

  it("keeps overrides across a reload and drops one on --clear", async () => {
    const host = await loaded();
    await host.harness.runCli(["verbosity", "off"], { threadId: "thr_1", projectId: "proj_a" });
    const reloaded = await host.harness.lifecycle.reload(plugin);
    expect((await reloaded.harness.runCli(["verbosity"], { threadId: "thr_1", projectId: "proj_a" })).stdout).toBe("off (thread thr_1)\n");
    await reloaded.harness.runCli(["verbosity", "--clear"], { threadId: "thr_1", projectId: "proj_a" });
    expect((await reloaded.harness.runCli(["verbosity"], { threadId: "thr_1", projectId: "proj_a" })).stdout).toBe("normal (the host setting)\n");
  });

  it("sets the host setting with --global", async () => {
    const { harness } = await loaded();
    expect((await harness.runCli(["verbosity", "sparing", "--global"], { threadId: "thr_1" })).stdout).toBe("sparing (host setting)\n");
    expect((await harness.resolveAgentConfiguration(personContext("thr_9", "proj_z"))).instructions).toBe(agentInstructions("sparing"));
  });

  it("refuses an unknown level and flags that contradict each other", async () => {
    const { harness } = await loaded();
    const ctx = { threadId: "thr_1", projectId: "proj_a" };
    for (const argv of [["verbosity", "loud"], ["verbosity", "off", "--clear"], ["verbosity", "off", "--project", "--global"]]) {
      expect((await harness.runCli(argv, ctx)).exitCode, argv.join(" ")).not.toBe(0);
    }
    expect((await harness.runCli(["verbosity"], ctx)).stdout).toBe("normal (the host setting)\n");
  });

  // check_ui reads the level live: notes at normal, none at eager.
  it("lets check_ui note a card around one sentence below eager only", async () => {
    const { harness } = await loaded();
    const spec = 'Card("Summary", [Text("All tests pass")])';
    const ctx = { threadId: "thr_1", projectId: "proj_a" };
    const normal = await harness.callAgentTool("check_ui", { spec }, ctx);
    expect(JSON.stringify(normal)).toContain("Reads better as prose");
    await harness.runCli(["verbosity", "eager"], ctx);
    const eager = await harness.callAgentTool("check_ui", { spec }, ctx);
    expect(JSON.stringify(eager)).not.toContain("Reads better as prose");
  });
});
