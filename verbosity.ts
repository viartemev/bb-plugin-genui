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
 * the content, prose otherwise. "eager" is the pre-0.4 text that asked for a
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

/** Overrides are tiny, but they are written on demand: keep the store bounded. */
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
 * is null. Oldest thread overrides fall out once the store is full, so a long
 * session that muted UI in many threads cannot grow past the cap.
 */
export function withOverride(
  overrides: VerbosityOverrides,
  scope: { readonly project?: string; readonly thread?: string },
  level: Verbosity | null,
): VerbosityOverrides {
  if (scope.thread === undefined && scope.project === undefined) {
    throw new Error("withOverride needs a project or a thread");
  }
  if (scope.project !== undefined) {
    return { projects: assign(overrides.projects, scope.project, level), threads: { ...overrides.threads } };
  }
  const threads = assign(overrides.threads, scope.thread!, level);
  const ids = Object.keys(threads);
  if (ids.length > MAX_VERBOSITY_OVERRIDES) {
    const kept = ids.slice(ids.length - MAX_VERBOSITY_OVERRIDES);
    const trimmed: Record<string, Verbosity> = {};
    for (const id of kept) trimmed[id] = threads[id]!;
    return { projects: { ...overrides.projects }, threads: trimmed };
  }
  return { projects: { ...overrides.projects }, threads };
}

function assign(
  current: Readonly<Record<string, Verbosity>>,
  id: string,
  level: Verbosity | null,
): Record<string, Verbosity> {
  const next = { ...current };
  if (level === null) delete next[id];
  else next[id] = level;
  return next;
}
