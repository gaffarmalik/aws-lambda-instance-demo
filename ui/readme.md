# React frontend

React + TypeScript + Vite, with accessible native form controls, responsive CSS, simple SVG/CSS charts, and Lucide icons. No AWS SDK or credentials ship to the browser. Vite proxies `/api` to the local Express process at port 3001.

Run from the repository root with `npm run dev` (local simulation) or `npm run dev:aws` (deployed AWS worker). Open http://127.0.0.1:5173.

The two views are **Collect feedback** and **Overview**. Overview includes branch/date filters, live buffer count and flush, regional comparison, sentiment/topic charts, processing status, question answering, saved report links, and evidence dialogs with original IDs and source objects. Empty, pending, failed, loading, stale-refresh and submission states are surfaced. The UI polls every three seconds.

`npm run build -w ui` generates `ui/dist/`. The standalone Vite preview serves frontend assets only; it needs an API reverse proxy to use the collection backend. The documented development command configures that proxy automatically.

Source: `src/App.tsx` coordinates the workspace; `components/FeedbackForm.tsx`, `components/EvidenceDialog.tsx`, and `components/FeedbackDisplay.tsx` hold the form, evidence and display components. `hooks/useDashboard.ts` polls buffer state independently from filtered results. `api.ts` validates responses against `@feedback/contracts`. `npm run typecheck -w ui` checks UI code and Vite configuration without emitting files.
