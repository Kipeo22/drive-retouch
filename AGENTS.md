# Repository Guidelines

## Project Structure & Module Organization

This is a WXT + React browser extension for Google Drive image preview retouching. Extension entrypoints live in `entrypoints/`:

- `entrypoints/background.ts` defines the background worker.
- `entrypoints/content/` contains the Google Drive content script and its CSS overlay styles.
- `entrypoints/popup/` contains the React popup UI, local styles, and `index.html`.

Shared static assets belong in `assets/` for bundled imports and `public/` for files served at the extension root. Extension metadata, permissions, and host matches are in `wxt.config.ts`. Build output goes under `.output/`; do not edit it manually.

## Build, Test, and Development Commands

Use pnpm for package management; the lockfile is `pnpm-lock.yaml`.

- `pnpm install` installs dependencies and runs `wxt prepare`.
- `pnpm dev` starts WXT in development mode for Chromium-based browsers.
- `pnpm dev:firefox` starts WXT targeting Firefox.
- `pnpm build` creates a production Chromium build.
- `pnpm build:firefox` creates a production Firefox build.
- `pnpm zip` and `pnpm zip:firefox` package extension builds for distribution.
- `pnpm compile` runs TypeScript type checking with `tsc --noEmit`.

## Coding Style & Naming Conventions

Write TypeScript and React components with functional components and hooks. Prefer explicit local types for shared state shapes, as in `Adjustments` and `ImageRect`. Keep component files in PascalCase when they export a component, such as `App.tsx`; use lowercase names for entrypoint files like `background.ts` and `index.tsx`.

Use two-space indentation in JSON and existing TSX formatting. The project currently mixes single and double quotes; match the style of the file you are editing. Keep content-script CSS class names prefixed with `dr-` to avoid collisions with Google Drive page styles.

## Testing Guidelines

There is no dedicated test framework configured yet. Before submitting changes, run `pnpm compile` and at least one relevant build command. For UI or content-script changes, test manually in Google Drive preview pages through `pnpm dev`, checking that the overlay mounts once, does not persist changes to Drive images, and cleans up panel state on close/reset.

## Commit & Pull Request Guidelines

Git history currently contains only an initial commit, so no project-specific commit convention is established. Use short, imperative commit messages such as `Add Drive preview retouch controls` or `Fix content overlay positioning`.

Pull requests should include a concise summary, testing notes with exact commands run, and screenshots or screen recordings for popup or content overlay changes. Mention permission, host match, or manifest changes from `wxt.config.ts` explicitly.
