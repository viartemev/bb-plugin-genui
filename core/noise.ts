// Notes on a block that compiles but carries less than a sentence would.
//
// The verbosity setting decides how much UI an agent is asked to write; these
// checks are what makes the quieter levels enforceable: `check_ui` reports them
// with the spec, before the reply goes out, so "a Card around one number is a
// paragraph in disguise" is a thing the agent is told at the moment it can
// still change its mind. They are notes, never errors — a block that draws
// correctly is still a block that draws correctly.
import type { CallExpr, Expr, Program } from "./ast";
import { DEFAULT_VERBOSITY, type Verbosity } from "../verbosity";

/** A block whose whole content is a sentence, a label or one figure. */
const PROSE_ONLY = new Set(["Text", "Callout", "Badge", "Icon", "Metric"]);

/** How many top-level blocks each level tolerates before saying so. */
const MAX_BLOCKS: Readonly<Record<Verbosity, number>> = { off: 0, sparing: 1, normal: 2, eager: Number.POSITIVE_INFINITY };

/** Mermaid node declarations: `A[...]`, `B(...)`, `C{...}`. */
const MERMAID_NODE = /\b[A-Za-z0-9_]+[[({]/g;
/** Edges and subgraph headers are not nodes, however they are written. */
const MERMAID_NOT_A_NODE = new Set(["subgraph", "end", "style", "classDef", "linkStyle", "click"]);

function call(expr: Expr): CallExpr | null {
  return expr.type === "call" ? expr : null;
}

function label(node: CallExpr): string {
  const first = node.args[0];
  return first !== undefined && first.type === "literal" && typeof first.value === "string" ? first.value : node.name;
}

function literal(node: CallExpr): string | null {
  const first = node.args[0];
  return first !== undefined && first.type === "literal" && typeof first.value === "string" ? first.value : null;
}

/** The children of a Card's second argument, or null when it is not a list. */
function children(node: CallExpr): readonly Expr[] | null {
  const second = node.args[1];
  return second !== undefined && second.type === "list" ? second.items : null;
}

/** How many boxes a Diagram's mermaid source draws; 0 when it is not a string. */
export function diagramNodes(source: string): number {
  const names = [...source.matchAll(MERMAID_NODE)].map((match) => match[0].slice(0, -1));
  return names.filter((name) => !MERMAID_NOT_A_NODE.has(name)).length;
}

/**
 * What an agent should hear about this spec at this verbosity: one line per
 * thing that would read better as a sentence. Empty at "eager", where more UI
 * is the point, and for a block that is the only one in the reply and carries
 * something prose cannot.
 */
export function lintNoise(program: Program, level: Verbosity = DEFAULT_VERBOSITY): string[] {
  if (level === "eager") return [];
  const notes: string[] = [];
  const at = (pos: { line: number }) => `line ${pos.line}`;

  const blocks = program.roots.length;
  const max = MAX_BLOCKS[level];
  if (blocks > max) {
    notes.push(
      `the reply holds ${blocks} blocks; ${max === 0 ? "none" : max === 1 ? "one is" : `${max} are`} enough at this level — keep the one that carries the most, and write the rest as prose`,
    );
  }

  for (const root of program.roots) {
    const node = call(root);
    if (node === null) continue;

    if (PROSE_ONLY.has(node.name)) {
      notes.push(`${at(node.pos)}: a lone ${node.name} block restates a sentence; say it in the reply instead`);
      continue;
    }

    if (node.name === "Diagram") {
      const note = diagramNote(node, at(node.pos));
      if (note !== null) notes.push(note);
      continue;
    }

    if (node.name !== "Card") continue;
    const kids = children(node);
    if (kids === null) continue;
    if (kids.length === 1) {
      const only = call(kids[0]!);
      if (only !== null && PROSE_ONLY.has(only.name)) {
        notes.push(
          `${at(node.pos)}: "Card(${label(node)})" holds a single ${only.name} — one sentence or one figure belongs in the reply, not in a card`,
        );
      }
    }
    for (const kid of kids) {
      const inner = call(kid);
      if (inner === null || inner.name !== "Diagram") continue;
      const note = diagramNote(inner, at(inner.pos));
      if (note !== null) notes.push(note);
    }
  }
  return notes;
}

/** A flow small enough that a sentence would say it faster, or null. */
function diagramNote(node: CallExpr, where: string): string | null {
  const source = literal(node);
  const boxes = source === null ? 0 : diagramNodes(source);
  if (boxes === 0 || boxes > 3) return null;
  return `${where}: the diagram draws ${boxes} box${boxes === 1 ? "" : "es"}; a flow that small reads faster as a sentence, unless the reader needs to click through to the detail`;
}
