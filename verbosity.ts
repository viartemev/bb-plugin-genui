// How much inline UI an agent is asked to write. One host setting
// (`verbosity`), plus optional overrides for a project and for a thread, kept
// in bb's kv store because plugin settings are host-wide only.
//
// The presets themselves are in instructions.ts: this module owns the level
// names, the descriptor the settings page and `bb plugin config` render, and
// the resolution order (thread, then project, then the setting). Everything
// here is pure and synchronous, because `bb.agents.configure` resolves on
// every turn and must not wait on storage.
export const VERBOSITY_LEVELS = ["off", "sparing", "normal", "eager"] as const;

/** Least to most UI. See VERBOSITY_SETTINGS for what each one asks for. */
export type Verbosity = (typeof VERBOSITY_LEVELS)[number];

/**
 * "normal" keeps the plugin's defaults: a block where one genuinely carries
 * the content, prose otherwise. "eager" is the text up to 0.3.1 that asked for a
 * block wherever part of a reply is better seen than read.
 */
export const DEFAULT_VERBOSITY: Verbosity = "normal";

export function isVerbosity(value: unknown): value is Verbosity {
  return typeof value === "string" && (VERBOSITY_LEVELS as readonly string[]).includes(value);
}

/** The next level quieter than this one, "off" staying "off". */
export function quieter(level: Verbosity): Verbosity {
  const index = VERBOSITY_LEVELS.indexOf(level);
  return VERBOSITY_LEVELS[Math.max(0, index - 1)]!;
}

export const VERBOSITY_SETTINGS = {
  verbosity: {
    type: "select" as const,
    label: "How much UI",
    description:
      "How much inline UI agents are asked to write in chat. off: nothing — agents answer in prose and the ui and app blocks are not offered. sparing: prose unless a block carries something prose cannot (a table of several rows, a real series, saved tool output, a choice or a form), at most one per reply. normal: a block wherever it genuinely replaces a table, a chart, a diagram, tool output, a plan or a question. eager: a block wherever part of a reply is better used than read — the plugin's text before this setting existed. A project can override this for its own threads, and one thread can override both; `bb genui verbosity` reads and sets all three.",
    options: [...VERBOSITY_LEVELS],
    experimental_optionLabels: {
      off: "Off (prose only)",
      sparing: "Sparing (only when it earns it)",
      normal: "Normal (a block wherever it replaces text)",
      eager: "Eager (a block wherever it could help)",
    },
    default: DEFAULT_VERBOSITY,
  },
};

/** Where per-project and per-thread overrides live; one small kv row. */
export const VERBOSITY_OVERRIDES_KEY = "verbosity:overrides";

/** Overrides are tiny, but they are written on demand: keep each scope's map bounded. */
export const MAX_VERBOSITY_OVERRIDES = 500;

export interface VerbosityOverrides {
  /** `proj_…` id to level. */
  readonly projects: Readonly<Record<string, Verbosity>>;
  /** `thr_…` id to level. */
  readonly threads: Readonly<Record<string, Verbosity>>;
}

export const NO_OVERRIDES: VerbosityOverrides = { projects: {}, threads: {} };

function levels(value: unknown): Record<string, Verbosity> {
  if (value === null || typeof value !== "object") return {};
  const kept: Record<string, Verbosity> = {};
  for (const [id, level] of Object.entries(value as Record<string, unknown>)) {
    if (id.length > 0 && id.length <= 64 && isVerbosity(level)) kept[id] = level;
  }
  return kept;
}

/** Reads the kv row back; anything unrecognized is dropped rather than failing a turn. */
export function parseOverrides(value: unknown): VerbosityOverrides {
  if (value === null || typeof value !== "object") return NO_OVERRIDES;
  const record = value as { projects?: unknown; threads?: unknown };
  return { projects: levels(record.projects), threads: levels(record.threads) };
}

/**
 * The level a session gets: its thread's override, else its project's, else
 * the host setting. A thread override of "off" survives a project override.
 */
export function resolveVerbosity(
  base: Verbosity,
  overrides: VerbosityOverrides,
  scope: { readonly threadId?: string | null; readonly projectId?: string | null },
): Verbosity {
  const thread = scope.threadId === null || scope.threadId === undefined ? undefined : overrides.threads[scope.threadId];
  if (thread !== undefined) return thread;
  const project =
    scope.projectId === null || scope.projectId === undefined ? undefined : overrides.projects[scope.projectId];
  return project ?? base;
}

/**
 * A copy of `overrides` with one scope set to `level`, or cleared when `level`
 * is null. Setting an id again makes it the newest, and the least recently
 * set ids fall out once a scope is full, so a long-running host that muted UI
 * in many threads cannot grow past the cap.
 */
export function withOverride(
  overrides: VerbosityOverrides,
  scope: { readonly project?: string; readonly thread?: string },
  level: Verbosity | null,
): VerbosityOverrides {
  if (scope.project !== undefined) {
    return { projects: assign(overrides.projects, scope.project, level), threads: { ...overrides.threads } };
  }
  if (scope.thread !== undefined) {
    return { projects: { ...overrides.projects }, threads: assign(overrides.threads, scope.thread, level) };
  }
  throw new Error("withOverride needs a project or a thread");
}

/** `current` with `id` moved to the end at `level` (or removed), trimmed to the cap from the oldest end. */
function assign(
  current: Readonly<Record<string, Verbosity>>,
  id: string,
  level: Verbosity | null,
): Record<string, Verbosity> {
  const next = { ...current };
  delete next[id];
  if (level !== null) next[id] = level;
  const ids = Object.keys(next);
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_VERBOSITY_OVERRIDES))) delete next[old];
  return next;
}
