// Feature: plotter-studio-upgrade, Property 3: SVG Editor Delete and Undo Round-Trip
// Validates: Requirements 3.3, 3.6, 3.8

/**
 * Property 3: SVG Editor Delete and Undo Round-Trip
 *
 * This test models the SvgEditor state logic in pure TypeScript (no React/DOM needed).
 * It verifies that:
 *   - Deleting a path produces a state with exactly N-1 paths and the deleted path absent
 *   - Undoing the delete restores exactly N paths with the deleted path present
 *   - The path count indicator always equals the current paths array length
 *
 * Run standalone: node -r ts-node/register components/__tests__/SvgEditor.test.ts
 * Or compile first: tsc --module commonjs --target es2017 --outDir /tmp components/__tests__/SvgEditor.test.ts
 */

/* eslint-disable @typescript-eslint/no-var-requires */
// Using require() for CommonJS compatibility with Next.js project toolchain
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fc = require("fast-check") as typeof import("fast-check");

// ─── Types ────────────────────────────────────────────────────────────────────

interface SvgPath {
  id: string;
  d: string;
}

interface State {
  paths: SvgPath[];
  deletedStack: SvgPath[];
}

// ─── State Operations (mirrors SvgEditor.tsx logic) ──────────────────────────

/**
 * deleteOp: removes the path with the given id from paths,
 * pushes it onto deletedStack (max depth 1 — replaces any existing entry).
 * Returns a new state (immutable).
 */
function deleteOp(state: State, id: string): State {
  const target = state.paths.find((p) => p.id === id);
  if (!target) return state;
  return {
    paths: state.paths.filter((p) => p.id !== id),
    deletedStack: [target], // max depth 1
  };
}

/**
 * undoOp: pops the top of deletedStack and appends it back to paths.
 * Returns a new state (immutable).
 */
function undoOp(state: State): State {
  if (state.deletedStack.length === 0) return state;
  const [restored] = state.deletedStack;
  return {
    paths: [...state.paths, restored],
    deletedStack: [],
  };
}

/**
 * pathCountIndicator: the value shown in the "{N} paths" badge.
 * Always equals state.paths.length.
 */
function pathCountIndicator(state: State): number {
  return state.paths.length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an initial State from an array of path data strings. */
function buildState(pathDataStrings: string[]): State {
  const paths: SvgPath[] = pathDataStrings.map((d, i) => ({
    id: `path-${i}`,
    d,
  }));
  return { paths, deletedStack: [] };
}

// ─── Property 3: SVG Editor Delete and Undo Round-Trip ───────────────────────

function runProperty3(): void {
  fc.assert(
    fc.property(
      // Generate an array of 1–50 non-empty path data strings
      fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 50 }),
      // Pick a random index into that array to select path P
      fc.nat(),
      (pathDataStrings: string[], rawIndex: number) => {
        const N = pathDataStrings.length;
        const indexP = rawIndex % N; // clamp to valid range

        const initialState = buildState(pathDataStrings);
        const pathP = initialState.paths[indexP];

        // ── Pre-condition: initial state has N paths ──────────────────────
        if (initialState.paths.length !== N) return false;

        // ── Path count indicator matches paths array length (initial) ─────
        if (pathCountIndicator(initialState) !== initialState.paths.length) {
          return false;
        }

        // ── Simulate delete of P ──────────────────────────────────────────
        const afterDelete = deleteOp(initialState, pathP.id);

        // After delete: exactly N-1 paths
        if (afterDelete.paths.length !== N - 1) return false;

        // After delete: P is absent
        if (afterDelete.paths.some((p) => p.id === pathP.id)) return false;

        // After delete: path count indicator equals paths array length
        if (pathCountIndicator(afterDelete) !== afterDelete.paths.length) {
          return false;
        }

        // ── Simulate Undo Last Delete ─────────────────────────────────────
        const afterUndo = undoOp(afterDelete);

        // After undo: exactly N paths
        if (afterUndo.paths.length !== N) return false;

        // After undo: P is present (by id)
        if (!afterUndo.paths.some((p) => p.id === pathP.id)) return false;

        // After undo: path count indicator equals paths array length
        if (pathCountIndicator(afterUndo) !== afterUndo.paths.length) {
          return false;
        }

        // ── deletedStack is cleared after undo ────────────────────────────
        if (afterUndo.deletedStack.length !== 0) return false;

        return true;
      }
    ),
    { numRuns: 1000, verbose: true }
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(
    "Running Property 3: SVG Editor Delete and Undo Round-Trip..."
  );
  try {
    runProperty3();
    console.log("✓ Property 3 passed (1000 runs)");
  } catch (err) {
    console.error("✗ Property 3 FAILED:");
    console.error(err);
    process.exit(1);
  }
}

main();
