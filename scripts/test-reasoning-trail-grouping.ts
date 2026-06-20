/**
 * Regression test for the 2026-06-19 reasoning-trail turn-numbering bug:
 * headers showed gaps ("turn 1, 3 — no 2") and, in multi-turn threads,
 * out-of-order sequences ("1, 4, 5, 2").
 *
 * Root cause (confirmed against a live prod trail): turn headers were
 * anchored to tool-call render groups. A turn that emitted ZERO tool calls
 * (e.g. the final synthesis turn) had no group to anchor on, so its header
 * silently vanished → gap. And headers rendered in step-arrival order rather
 * than numeric turn order → scramble.
 *
 * Fix: render headers off the sorted iterationUsage list as the spine, and
 * bucket groups under their tagged iteration. This file inlines the exact
 * pure logic shipped in ReasoningTrail.tsx (IterationGroupedTrail's spine
 * walk + bucketing) and asserts the rendered turn sequence. Keep in sync
 * with the component. Run:
 *   npx tsx scripts/test-reasoning-trail-grouping.ts
 */

export {}; // module scope — keeps top-level `failures`/`check` from colliding
// with other no-import test scripts during the Next typecheck pass.

type Usage = { iteration: number };
type Group = { iteration?: number; label: string };

/**
 * Mirrors IterationGroupedTrail: walk the sorted usage list as the spine
 * (every turn gets a header, even with no groups), bucket groups by tagged
 * iteration, append untagged/legacy groups last. Returns the rendered order
 * as a flat list of "turn N" headers and group labels under each.
 */
function renderOrder(groups: Group[], iterationUsage: Usage[]): string[] {
  const sortedUsage = [...iterationUsage].sort(
    (a, b) => a.iteration - b.iteration
  );
  const known = new Set(iterationUsage.map((u) => u.iteration));

  const m = new Map<number, Group[]>();
  const untagged: Group[] = [];
  for (const g of groups) {
    if (g.iteration !== undefined && known.has(g.iteration)) {
      const bucket = m.get(g.iteration);
      if (bucket) bucket.push(g);
      else m.set(g.iteration, [g]);
    } else {
      untagged.push(g);
    }
  }

  const out: string[] = [];
  for (const u of sortedUsage) {
    out.push(`turn ${u.iteration}`);
    for (const g of m.get(u.iteration) ?? []) out.push(g.label);
  }
  for (const g of untagged) out.push(g.label);
  return out;
}

let failures = 0;
function check(name: string, cond: boolean) {
  process.stdout.write(`  ${cond ? "✓" : "✗"} ${name}\n`);
  if (!cond) failures += 1;
}
function eq(name: string, got: string[], want: string[]) {
  check(`${name} — got [${got.join(", ")}]`, JSON.stringify(got) === JSON.stringify(want));
}

// ── Case 1: the GAP — turn 3 made zero tool calls ────────────────────
// Live prod priority trail: it1 & it2 called tools, it3 was final synthesis
// with no tools. Old code dropped the turn-3 header. New code keeps it.
{
  process.stdout.write("Case 1: tool-less final turn (gap fix)\n");
  const groups: Group[] = [
    { iteration: 1, label: "soql" },
    { iteration: 2, label: "dc_sql" },
  ];
  const usage: Usage[] = [{ iteration: 1 }, { iteration: 2 }, { iteration: 3 }];
  eq("turn 3 header present, no gap", renderOrder(groups, usage), [
    "turn 1",
    "soql",
    "turn 2",
    "dc_sql",
    "turn 3",
  ]);
}

// ── Case 2: a middle turn made zero tool calls ───────────────────────
// Reasoning-only turn 2 between two tool turns. Old code: "turn 1, 3".
{
  process.stdout.write("Case 2: tool-less middle turn (gap fix)\n");
  const groups: Group[] = [
    { iteration: 1, label: "a" },
    { iteration: 3, label: "b" },
  ];
  const usage: Usage[] = [{ iteration: 1 }, { iteration: 2 }, { iteration: 3 }];
  eq("turn 2 header present between 1 and 3", renderOrder(groups, usage), [
    "turn 1",
    "a",
    "turn 2",
    "turn 3",
    "b",
  ]);
}

// ── Case 3: ORDER — groups arrive out of iteration order ─────────────
// Simulates accumulated/interleaved rows. Spine walk forces numeric order
// regardless of group arrival order.
{
  process.stdout.write("Case 3: scrambled group order (order fix)\n");
  const groups: Group[] = [
    { iteration: 4, label: "d4" },
    { iteration: 1, label: "a1" },
    { iteration: 5, label: "e5" },
    { iteration: 2, label: "b2" },
  ];
  const usage: Usage[] = [
    { iteration: 5 },
    { iteration: 1 },
    { iteration: 4 },
    { iteration: 2 },
  ];
  eq("headers render 1,2,4,5 in order", renderOrder(groups, usage), [
    "turn 1",
    "a1",
    "turn 2",
    "b2",
    "turn 4",
    "d4",
    "turn 5",
    "e5",
  ]);
}

// ── Case 4: multiple groups in one turn keep arrival order ───────────
{
  process.stdout.write("Case 4: multiple groups per turn\n");
  const groups: Group[] = [
    { iteration: 1, label: "first" },
    { iteration: 1, label: "second" },
    { iteration: 1, label: "third" },
  ];
  const usage: Usage[] = [{ iteration: 1 }];
  eq("intra-turn order preserved", renderOrder(groups, usage), [
    "turn 1",
    "first",
    "second",
    "third",
  ]);
}

// ── Case 5: untagged/legacy groups render last, no crash ─────────────
// A group whose iteration has no usage record (old cached trail) falls to
// the untagged bucket instead of vanishing.
{
  process.stdout.write("Case 5: untagged group falls through\n");
  const groups: Group[] = [
    { iteration: 1, label: "tagged" },
    { iteration: undefined, label: "legacy" },
    { iteration: 99, label: "orphan" }, // iteration not in usage map
  ];
  const usage: Usage[] = [{ iteration: 1 }];
  eq("untagged + orphan render after known turns", renderOrder(groups, usage), [
    "turn 1",
    "tagged",
    "legacy",
    "orphan",
  ]);
}

process.stdout.write(
  failures === 0 ? "\nALL PASS\n" : `\n${failures} CHECK(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
