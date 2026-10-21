# React frontend

React + TypeScript + Vite, with accessible native form controls, responsive CSS, simple SVG/CSS charts, and Lucide icons. No AWS SDK or credentials ship to the browser. Vite proxies `/api` to the local Express process at port 3001.

Run from the repository root with `npm run dev` (local simulation) or `npm run dev:aws` (deployed AWS worker). Open http://127.0.0.1:5173.

The two views are **Collect feedback** and **Overview**. Overview includes branch/date filters, live buffer count and flush, regional comparison, sentiment/topic charts, processing status, question answering, saved report links, and evidence dialogs with original IDs and source objects. Empty, pending, failed, loading, stale-refresh and submission states are surfaced. The UI polls every three seconds.

`npm run build -w ui` generates `ui/dist/`. The standalone Vite preview serves frontend assets only; it needs an API reverse proxy to use the collection backend. The documented development command configures that proxy automatically.

Source: `src/App.tsx` coordinates the workspace; `components/FeedbackForm.tsx`, `components/EvidenceDialog.tsx`, and `components/FeedbackDisplay.tsx` hold the form, evidence and display components. `hooks/useDashboard.ts` polls buffer state independently from filtered results. `api.ts` validates responses against `@feedback/contracts`. `npm run typecheck -w ui` checks UI code and Vite configuration without emitting files.

## Deploy the UI to Amplify Hosting

The repository-root [amplify.yml](../amplify.yml) selects Node.js 24, installs the locked npm workspaces from the root (including build-time dependencies), runs the UI's TypeScript check and Vite build, and publishes `ui/dist`. It caches npm downloads between builds.

When connecting the repository in Amplify:

1. Select your repository and branch, then select **My app is a monorepo**.
2. Set the app root to **`ui`**. Amplify sets `AMPLIFY_MONOREPO_APP_ROOT=ui`; verify that value if configuring an existing app.
3. Keep the repository's `amplify.yml` build settings and deploy.

The `frontend.buildPath: /` setting makes installation and builds run from the repository root, so the shared contracts workspace is available. See [AWS's monorepo setup guide](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html).

This deployment publishes the frontend. Its `/api` calls still require a reachable HTTPS Express endpoint and API routing; Vite's development proxy is not part of the production build. Once that endpoint is available, configure an Amplify `/api/<*>` reverse-proxy rewrite to the backend's `/api/<*>` path and update the backend's local-only origin restrictions. See [AWS's rewrite examples](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html). Do not route `/api` to `index.html`. The current views use React state rather than URL routes, so no SPA fallback is needed for them.
