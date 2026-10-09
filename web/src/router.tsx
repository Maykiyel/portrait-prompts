import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { Prompts } from "@/features/prompts/prompts-page";
import { Gallery } from "@/features/gallery/gallery-page";
import { Generate } from "@/pages/generate";
import { ImportPage } from "@/features/import/import-page";
import { Overview } from "@/features/overview/overview-page";

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
