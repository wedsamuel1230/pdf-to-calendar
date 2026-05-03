# PDF to Calendar

[![CI](https://img.shields.io/github/actions/workflow/status/wedsamuel1230/pdf-to-calendar/ci.yml?branch=main&label=CI)](https://github.com/wedsamuel1230/pdf-to-calendar/actions/workflows/ci.yml)
[![Publish](https://img.shields.io/github/actions/workflow/status/wedsamuel1230/pdf-to-calendar/publish-desktop.yml?label=Publish)](https://github.com/wedsamuel1230/pdf-to-calendar/actions/workflows/publish-desktop.yml)
[![License: MIT](https://img.shields.io/github/license/wedsamuel1230/pdf-to-calendar)](./LICENSE)

Desktop app that parses timetable PDFs and imports event rows into a Notion database for calendar use.

## Highlights

- Native desktop runtime with Tauri 2
- Drag/drop and file-picker input flow
- Deterministic PDF parser with optional NVIDIA LLM repair for low-confidence rows
- Notion database integration with schema-aware mapping
- Cross-platform build/release automation (macOS, Windows, Linux)

## Tech Stack

- Frontend: SvelteKit (SPA/static), TypeScript, Vitest, Playwright
- Desktop backend: Rust, Tauri 2
- Data parsing: `pdfjs-dist`
- Validation: `zod`
- HTTP + integration services: `reqwest`, Notion API
- Secrets: OS keychain via `keyring`

## Open-Source Libraries Used

- [Tauri](https://github.com/tauri-apps/tauri)
- [SvelteKit](https://github.com/sveltejs/kit)
- [pdf.js / pdfjs-dist](https://github.com/mozilla/pdf.js)
- [zod](https://github.com/colinhacks/zod)
- [Lucide](https://github.com/lucide-icons/lucide)

## Quick Start

```bash
npm install
npm run tauri:dev
```

Web preview:

```bash
npm run dev
```

## Environment Variables

Use environment variables on both macOS and Windows (and Linux):

- `NOTION_TOKEN` (preferred for Notion integration)
- `NVIDIA_API_KEY` (primary)
- `NV_API_KEY` (alias)
- `nvapi` (fallback alias)
- `NVIDIA_BASE_URL` (optional, default `https://integrate.api.nvidia.com/v1`)

## Quality Checks

```bash
npm run check
npm run test:unit -- --run
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

## Release Outputs

GitHub Actions publishes desktop bundles via tags (`v*`) or manual dispatch:

- macOS: `.app`, `.dmg`
- Windows: `.msi`, `.exe` (NSIS)
- Linux: `.deb`, `.AppImage`

## License

MIT. Copyright (c) 2026 Samuel F.
