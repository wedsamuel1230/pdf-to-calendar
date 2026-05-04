# AGENTS.md

## Scope
This repository is a Tauri + SvelteKit desktop app that parses timetable PDFs and imports lesson events to Notion.

## Core Rules
- Ask clarifying questions when scope, DoD, constraints, stakeholders, safety, or success criteria are unclear.
- If ambiguity is minor, state the assumption and continue.
- Keep changes minimal and scoped to the user request.
- Do not revert unrelated local changes.
- Prefer deterministic parsing and explicit diagnostics over hidden heuristics.

## Execution Flow
- Phase 0 Recon: inspect workspace and current behavior first.
- Phase 1 Input: restate goal, constraints, assumptions, and DoD.
- Phase 1.5 Ideation: suggest up to 5 actionable improvements when useful.
- Phase 2 Execution: implement the smallest safe patch; use TDD for behavior changes.
- Phase 3 Verify: run required checks; auto-fix deterministic failures once.
- Phase 4 Audit: verify scope, regressions, and compatibility.
- Phase 5 Report: concise outcome, evidence, and remaining risks.
- Phase 6 Next: record owner and next action; persist only durable memory.

## Repo Standards
- Frontend: `npm run check`, `npm run test:unit -- --run`.
- Backend: `cargo test --manifest-path src-tauri/Cargo.toml`.
- E2E: `npm run test:e2e` when UI behavior is changed.
- Keep Notion token and NVIDIA token env-first; never expose secrets in UI logs.

## Release and CI
- CI workflow validates macOS, Windows, and Linux.
- Desktop publish workflow builds and publishes platform bundles on version tags (`v*`).
- Supported release bundles:
  - macOS: `.app`, `.dmg` (arm64 + x64)
  - Windows: `nsis`, `msi`
  - Linux: `AppImage`, `deb`

## Communication
- Keep updates concise and factual.
- Surface blockers immediately with concrete remediation options.
