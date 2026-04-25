# Planner LLM Chapter Brief Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current `goal + mustKeep` planning contract with an LLM-ready chapter-brief contract, dissolve `ComposerAgent` into pure utilities over time, and preserve a rule-based fallback while the new planner stabilizes.

**Architecture:** Keep the current writing pipeline running by introducing the new structures in parallel first. The refactor proceeds in three layers: new chapter-brief models and planning-material retrieval, new LLM planner prompt/output path with fallback to the legacy planner, then composer de-agentization and writer/runtime consumption of the brief/context package.

**Tech Stack:** TypeScript, Vitest, Zod, existing InkOS `BaseAgent`/pipeline/state utilities.

---

### Task 1: Introduce chapter-brief models in parallel with legacy intent

**Files:**
- Modify: `packages/core/src/models/input-governance.ts`
- Modify: `packages/core/src/__tests__/models.test.ts`

**Step 1: Write the failing tests**

- Add schema tests for a new `ChapterBriefSchema` covering:
  - `goal`
  - `chapterType`
  - `isGoldenOpening`
  - `beatOutline`
  - `hookPlan`
  - `propsAndSetting`
  - `dormantReason`
- Add validation tests proving:
  - brief accepts structured fields without `mustKeep`
  - hook plan only requires active hook moves, not full dormant lists

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/models.test.ts -t "ChapterBriefSchema"
```

Expected: FAIL because `ChapterBriefSchema` does not exist yet.

**Step 3: Write minimal implementation**

- Add new Zod schemas and exported types beside the existing legacy intent schemas.
- Do not remove `ChapterIntentSchema` yet.

**Step 4: Run test to verify it passes**

Run the same command and expect PASS.

### Task 2: Extract deterministic planning-material retrieval

**Files:**
- Create: `packages/core/src/utils/planning-materials.ts`
- Create/Modify: `packages/core/src/__tests__/planning-materials.test.ts`
- Modify: `packages/core/src/agents/planner.ts`

**Step 1: Write the failing tests**

- Add a test for `gatherPlanningMaterials(...)` that verifies it returns:
  - current focus / author intent
  - matched outline slice
  - chapter summaries / chronicle
  - active hooks
  - previous ending hook
- Add a test proving it does **not** require prior-chapter full正文 to build the planning packet.

**Step 2: Run test to verify it fails**

```bash
pnpm --dir packages/core exec vitest run src/__tests__/planning-materials.test.ts
```

Expected: FAIL because the utility does not exist.

**Step 3: Write minimal implementation**

- Move planner-side file loading and memory retrieval into `gatherPlanningMaterials(...)`.
- Keep it deterministic and pure from the planner’s point of view.

**Step 4: Run test to verify it passes**

Run the same command and expect PASS.

### Task 3: Add planner prompt builder and LLM output parser

**Files:**
- Create: `packages/core/src/agents/planner-prompts.ts`
- Modify: `packages/core/src/agents/planner.ts`
- Create/Modify: `packages/core/src/__tests__/planner-prompts.test.ts`
- Modify: `packages/core/src/__tests__/planner.test.ts`

**Step 1: Write the failing tests**

- Add prompt tests proving the planner prompt uses:
  - chronicle/summaries
  - previous ending hook
  - active hooks to move
  - no raw `mustKeep`
- Add planner tests proving:
  - the new planner path can parse structured brief JSON
  - failed LLM planning falls back to the legacy rule-based intent path

**Step 2: Run tests to verify they fail**

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/planner-prompts.test.ts \
  src/__tests__/planner.test.ts
```

Expected: FAIL because the prompt builder and parser do not exist.

**Step 3: Write minimal implementation**

- Build a prompt builder that asks for `ChapterBrief` only.
- In `PlannerAgent`, add:
  - `planChapterLegacy(...)`
  - `planChapterWithLLM(...)`
  - fallback to legacy when the LLM path throws / returns invalid output
- Keep returning the old `PlanChapterOutput` shape for now, but attach the new brief in parallel.

**Step 4: Run tests to verify it passes**

Run the same command and expect PASS.

### Task 4: De-agentize composer into pure utilities without breaking runner

**Files:**
- Create: `packages/core/src/utils/context-assembly.ts`
- Create: `packages/core/src/utils/runtime-writer.ts`
- Modify: `packages/core/src/agents/composer.ts`
- Modify: `packages/core/src/__tests__/composer.test.ts`

**Step 1: Write the failing tests**

- Add/adjust tests so they target:
  - selected-context assembly
  - runtime artifact writing
  - trace generation
- Keep coverage equivalent to the current `ComposerAgent` expectations.

**Step 2: Run tests to verify it fails**

```bash
pnpm --dir packages/core exec vitest run src/__tests__/composer.test.ts
```

Expected: FAIL because the new utility boundaries do not exist.

**Step 3: Write minimal implementation**

- Move retrieval/assembly logic from `ComposerAgent` into utility functions.
- Keep `ComposerAgent` as a thin shim initially so pipeline call sites remain stable.

**Step 4: Run test to verify it passes**

Run the same command and expect PASS.

### Task 5: Switch writer/runtime consumption from intent-heavy contract to brief-driven contract

**Files:**
- Modify: `packages/core/src/agents/writer.ts`
- Modify: `packages/core/src/utils/governed-context.ts`
- Modify: `packages/core/src/pipeline/runner.ts`
- Modify: `packages/core/src/pipeline/persisted-governed-plan.ts`
- Modify: `packages/core/src/__tests__/writer.test.ts`
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/__tests__/persisted-governed-plan.test.ts`

**Step 1: Write the failing tests**

- Add tests proving writer now consumes:
  - brief goal
  - beat outline
  - hook plan
  - props and setting
- Add persisted plan tests that handle both legacy and new brief formats during the transition.

**Step 2: Run tests to verify they fail**

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/writer.test.ts \
  src/__tests__/pipeline-runner.test.ts \
  src/__tests__/persisted-governed-plan.test.ts
```

Expected: FAIL because the writer/runtime still depend on `mustKeep`-heavy plan data.

**Step 3: Write minimal implementation**

- Use the new brief as the primary writer-facing contract.
- Keep compatibility adapters for persisted legacy plans during the transition.

**Step 4: Run tests to verify it passes**

Run the same command and expect PASS.

### Task 6: Final cleanup and verification

**Files:**
- Modify: `packages/core/src/index.ts`
- Optional cleanup: `packages/core/src/agents/composer.ts` (thin wrapper or delete if safe)

**Step 1: Verify focused suite**

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/models.test.ts \
  src/__tests__/planning-materials.test.ts \
  src/__tests__/planner-prompts.test.ts \
  src/__tests__/planner.test.ts \
  src/__tests__/composer.test.ts \
  src/__tests__/writer.test.ts \
  src/__tests__/pipeline-runner.test.ts \
  src/__tests__/persisted-governed-plan.test.ts
pnpm --dir packages/core run build
```

Expected: PASS.

**Step 2: Commit**

```bash
git add packages/core/src docs/plans/2026-04-11-planner-llm-chapter-brief-refactor.md
git commit -m "refactor(planner): introduce chapter brief planning flow"
```
