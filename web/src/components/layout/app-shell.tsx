import { NavLink, Outlet } from "react-router";
import { AlertCircle, ClipboardList, GalleryHorizontal, LayoutDashboard, Monitor, Moon, Sparkles, Sun, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useSettings, type Theme } from "@/stores/settings";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/prompts", label: "Prompts", icon: ClipboardList },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/generate", label: "Generate", icon: Sparkles },
  { to: "/gallery", label: "Gallery", icon: GalleryHorizontal },
];

const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const themeIcon = { system: Monitor, light: Sun, dark: Moon };

export function AppShell() {
  const { data: status } = useStatus();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const ThemeIcon = themeIcon[theme];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13.5rem_1fr]">
      <aside className="border-b bg-sidebar md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:flex-col md:items-stretch md:gap-5 md:py-5">
          <span className="text-base font-semibold tracking-tight">Portrait workbench</span>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
                {to === "/prompts" && !!status?.waiting && (
                  <span className="ml-auto rounded-full bg-waiting/25 px-1.5 text-xs text-foreground tabular-nums">{status.waiting}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-muted-foreground md:mt-auto"
            onClick={() => setTheme(nextTheme[theme])}
            aria-label={`Theme: ${theme}. Switch theme`}
          >
            <ThemeIcon />
            <span className="hidden capitalize md:inline">{theme}</span>
          </Button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {status?.problem && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle />
            <AlertTitle>The output folder does not match your settings</AlertTitle>
            <AlertDescription>
              <p>{status.problem}</p>
            </AlertDescription>
          </Alert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
