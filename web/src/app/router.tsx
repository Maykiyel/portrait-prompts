import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./app-shell";

// Each page is one dynamic import, so a route's code is fetched when the user
// first goes there instead of on every page load. The boundary in the shell
// catches a chunk that never arrives.
const Overview = lazy(() => import("@/features/overview/overview-page").then((m) => ({ default: m.Overview })));
const Prompts = lazy(() => import("@/features/prompts/prompts-page").then((m) => ({ default: m.Prompts })));
const ImportPage = lazy(() => import("@/features/import/import-page").then((m) => ({ default: m.ImportPage })));
const Generate = lazy(() => import("@/features/generate/generate-page").then((m) => ({ default: m.Generate })));
const Gallery = lazy(() => import("@/features/gallery/gallery-page").then((m) => ({ default: m.Gallery })));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: "prompts", element: <Prompts /> },
      { path: "import", element: <ImportPage /> },
      { path: "generate", element: <Generate /> },
      { path: "gallery", element: <Gallery /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
