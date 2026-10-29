import { describe, expect, it } from "vitest";
import { compile } from "./index";
import { diagramNodes, lintNoise } from "./noise";
import type { Program } from "./ast";

function program(source: string): Program {
  const compiled = compile(source);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.program!;
}

describe("noise notes", () => {
  // The case that started the setting: a card wrapped around one line.
  it("flag a card that holds a single sentence or figure", () => {
    expect(lintNoise(program('Card("Summary", [Text("All tests pass")])'), "normal")).toHaveLength(1);
    expect(lintNoise(program('Card("Total", [Metric("Revenue", "$12k")])'), "normal")[0]).toContain("single Metric");
    expect(lintNoise(program('Card("Files", [Table(["a"], [["b"], ["c"]])])'), "normal")).toEqual([]);
  });

  it("flag a block whose whole content is a sentence", () => {
    expect(lintNoise(program('Callout("Careful here")'), "normal")[0]).toContain("say it in the reply instead");
  });

  it("count the blocks against the level's tolerance", () => {
    const two = 'Card("A", [Table(["x"], [["1"], ["2"]])])\nCard("B", [Table(["y"], [["3"], ["4"]])])';
    expect(lintNoise(program(two), "normal")).toEqual([]);
    expect(lintNoise(program(two), "sparing")).toHaveLength(1);
    expect(lintNoise(program(two), "off")[0]).toContain("2 top-level components");
  });

  // A three-box flow is a sentence with arrows; a real topology is not.
  it("flag a diagram too small to need drawing", () => {
    const three = 'Diagram("flowchart LR\\n  A[Browser] --> B[Server]\\n  B --> C[Database]")';
    expect(lintNoise(program(three), "normal")).toHaveLength(1);
    const five = 'Diagram("flowchart LR\\n  A[B] --> B[S]\\n  B --> C[D]\\n  C --> D[Q]\\n  D --> E[W]")';
    expect(lintNoise(program(five), "normal")).toEqual([]);
  });

  it("say nothing at the eager level, where more UI is the point", () => {
    expect(lintNoise(program('Card("Summary", [Text("All tests pass")])'), "eager")).toEqual([]);
    expect(lintNoise(program('Card("Flat", [Text("A"), Text("B")])'), "eager")).toEqual([]);
  });

  it("leave a block that carries something prose cannot alone", () => {
    const chart = 'Card("Latency", [Chart(type: "line", labels: ["a", "b"], series: [1, 2])])';
    expect(lintNoise(program(chart), "sparing")).toEqual([]);
  });
});

describe("diagramNodes", () => {
  it("count boxes, not edges, subgraphs or styling", () => {
    expect(diagramNodes("flowchart LR\n  A[One] --> B[Two]")).toBe(2);
    expect(diagramNodes("graph TD\n  subgraph x\n  A(One) --> B{Two}\n  end")).toBe(2);
    expect(diagramNodes("flowchart LR\n  A[One] --> B[Two]\n  style A fill:#fff")).toBe(2);
    expect(diagramNodes("flowchart LR\n  subgraph S[Service]\n  A[One] --> B[Two]\n  end")).toBe(2);
    expect(diagramNodes("flowchart LR\n  %% A[not drawn]\n  A[One] --> B[Two]\n  click A call open(A)")).toBe(2);
  });

  // A node written with its shape on every edge is still one box.
  it("count a node declared twice once", () => {
    expect(diagramNodes("flowchart LR\n  A[x] --> B[y]\n  A[x] --> C[z]\n  B[y] --> C[z]")).toBe(3);
  });

  // What a shape or an edge says is not a box, brackets and all.
  it("ignore ids and brackets inside labels", () => {
    expect(diagramNodes("flowchart LR\n  A[call fetch(url)] --> B[parse(json)]")).toBe(2);
    expect(diagramNodes("flowchart LR\n  A((Start)) -->|run(x)| B{{ok?}}\n  B --> C>flag]")).toBe(3);
    expect(diagramNodes("flowchart LR\n  A[\"Login (form)\"] --> B[(db)]")).toBe(2);
  });

  it("read an empty or unrecognized body as no boxes", () => {
    expect(diagramNodes("")).toBe(0);
    expect(diagramNodes("just some words")).toBe(0);
  });
});
