# LearnSpace AI product requirements

Status: proposed architecture baseline, 2026-10-18. No application is implemented. Implementation requires owner approval. Read with [architecture](ARCHITECTURE.md), [roadmap](IMPLEMENTATION_PLAN.md), and [risks](RISKS.md).

## Product and operating assumptions

An open-source learning workspace for one learner on one local machine. The learner supplies a hosted AI key or runs Ollama. React talks only to the local API; PostgreSQL owns saved learning data. Local-first means local ownership and operation, not offline access to hosted models or an offline browser replica. No authentication, billing, collaboration, hosted synchronization, autonomous research, or vector database in this MVP.

Priorities, in order: learning experience; educational accuracy; retention and productivity; preservation of customized notes; maintainability and setup. Safety of saved work is a release gate even when feature scope must shrink.

## Core journeys and acceptance criteria

| ID | User story | Observable acceptance |
|---|---|---|
| P01 | As a new learner, configure a provider and model | Onboarding accepts OpenAI, Anthropic, Gemini, or Ollama plus a model ID; test reports success or actionable failure; model changes retain existing content. Environment keys are sufficient; no key is returned by GET APIs. |
| P02 | Turn a goal into a course plan | Generate only a syllabus; review objectives, prerequisites, and ordered hierarchy before committing. No lessons or chat are generated during this action. Invalid/cyclic output cannot be committed. |
| P03 | Customize the syllabus | Rename, add, delete, move, and reorder arbitrary-depth topics. Dependencies cannot cross courses or form cycles. Skip/study is a learner decision, not deletion of prerequisite knowledge. Deletion discloses affected lessons and requires confirmation. |
| P04 | Open a small learning unit | First opening a leaf offers/generates its lesson; concurrent requests create at most one saved document. Reopening returns saved JSON without invoking AI. Container nodes show objectives and descendants. |
| P05 | Own and edit notes | Headings, paragraphs, marks, lists, tables, code, math, examples, analogies, and images survive save/reload. Undo/redo works locally; versions recover saved states. Navigation awaits save or presents a recovery choice. |
| P06 | Ask AI about selected text | Explain, simplify, expand, rewrite, example, analogy, and custom instruction yield a preview. Reject changes nothing. Accept affects exactly the captured range or insertion boundary. Stale results cannot apply automatically. |
| P07 | Discuss one lesson | Lesson-specific chat uses the saved edited lesson and preferences. Switching topics restores their respective conversations. Inserting a response is an explicit editor action and is autosaved. |
| P08 | Learn actively | Lessons include objectives, first-principles explanation, worked example, and active recall. Preferences control depth, pace, analogies, and optional reflection pauses. Completion is explicit; opening a lesson never marks it complete. |
| P09 | Recover work | Failed saves leave the editor intact; conflicts offer local/server copies without silent merging. Version restore creates a new revision and preserves the state being replaced. Regeneration requires a preview and confirmation tied to a revision. |
| P10 | Add visuals | Upload safe raster files or generate with a configured image adapter. Preview image generation; insert at captured cursor only if still valid. Unsupported models show a clear disabled action and upload alternative. |
| P11 | Take work elsewhere | Markdown or DOCX course ZIP reflects saved customizations, exact nesting/order, relative assets, and explicit placeholders for ungenerated leaves. Export makes zero model calls and contains no credentials. |

## Workspace interaction

Left rail: course list and course actions. Center: active editable leaf lesson, objectives, prerequisite choices, recall and completion controls. Right rail: expandable syllabus, current-topic highlight, and progress. A collapsible contextual chat panel shares the right region through tabs/drawer so the editor retains usable width. On narrow screens the two rails become drawers. Selection opens an accessible floating toolbar; keyboard users can invoke all actions through a menu. Loading, AI generation, unsaved, saving, saved-at, save error, and conflict are distinct visible states. AI previews never masquerade as saved notes.

Prerequisite choices are stored per dependency; skipped prerequisites remain visible and reversible. Reflection pauses hide subsequent teaching blocks until continued only when enabled; all content remains in the document/export. Recall answers are learner inputs, not a high-stakes grading system. MVP retains manual completion and a simple recall reveal, not spaced repetition scheduling or automated mastery scores.

## Release scope and priorities

P0 release blockers: all P01-P09 and P11, four text adapters, environment-key setup, local asset upload, canonical JSONB, conflict handling, version recovery, schema validation, safe export, CI, and reproducible setup. P1 required product scope: P10 image-generation adapter (at least one provider), image onboarding, polished reflection/recall controls and accessibility verification. Image generation is scheduled on day 6; learning controls on day 5 and final accessibility verification on day 7. If any required gate fails, label the seven-day result a core preview, not the complete requested MVP. UI-persisted credentials are optional and deferred; use environment configuration plus session-only onboarding secrets initially.

Selection AI initially supports inline paragraph/heading selections and whole contiguous text blocks, as detailed in EDITOR_DESIGN.md. Partial structural selections in tables/lists and image selections show an explicit unsupported-selection message; direct editing remains available. This is an MVP interaction limit, not arbitrary document replacement as a fallback. Rich-text and image insertion use explicit editor toolbar/menu controls, not only AI actions.

Deferred: encrypted persistent key vault, web retrieval/citations pipeline, embeddings/RAG, LangGraph, shared accounts, mobile app, real-time coediting, import/backup restoration UI, and full Word equation fidelity. Future backup format is specified in [export design](EXPORT_DESIGN.md). Do not silently drop any requested capability to hit a date.

## Quality and nonfunctional acceptance

- Saved edits survive API restart and browser reload. PostgreSQL failure never produces a false saved indicator. Successful save acknowledgement means transaction committed.
- Autosave starts after 750 ms idle, with one request in flight per lesson. Navigation flushes all newer edits, not just the first pending save.
- Educational output is schema-valid, decomposed into teachable units, labels uncertainty, and does not fabricate verified citations. A human rubric checks correctness, prerequisite order, explanation clarity, examples, and recall alignment.
- Local API binds to loopback; provider traffic is server-side. Documents sent to external providers are disclosed in onboarding. No secret, prompt, or full lesson in default logs or exports of configuration.
- Responsive editing and accessible keyboard controls; generation is cancellable and shows status. Provider latency is measured, not guaranteed.
- Setup target: documented Node LTS/npm, Docker Compose PostgreSQL, environment file, migrations, and one dev command on Windows/macOS/Linux. Validate on available platforms and name unverified ones.
- Seven days are seven implementation workdays starting after approval, not a promise of production readiness. Each day has a stop/go gate in the roadmap.

## Prioritized implementation checklist

- [ ] P0 workspace, environment validation, PostgreSQL migrations, shared contracts, health and CI.
- [ ] P0 course/tree/dependency invariants and manual lesson CRUD.
- [ ] P0 rich-text schema, sequential revision autosave, navigation flush, conflict recovery, snapshots/restore.
- [ ] P0 four provider adapters, capability checks, session onboarding, connection tests.
- [ ] P0 syllabus draft review/commit and guarded on-demand lesson generation.
- [ ] P0 selected-range AI preview, rejection, guarded application, undo.
- [ ] P0 contextual persisted chat and explicit insertion.
- [ ] P0 progress, preferences, prerequisite choices, educational rubric.
- [ ] P0 local uploads and both course export formats with assets.
- [ ] P1 separate image configuration, generation preview, safe cursor insertion.
- [ ] P1 reflection/recall polish, responsive/keyboard checks.
- [ ] P0 failure-path E2E, secret scan, setup documentation and release gate.

Measure time to first saved lesson, generation failures, save conflicts, recovery success, and rubric results locally during verification. Do not add telemetry collection by default.
