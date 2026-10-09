import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useSettings } from "@/stores/settings";

function Toaster(props: ToasterProps) {
  const theme = useSettings((s) => s.theme);
  return <Sonner theme={theme} className="toaster group" {...props} />;
}

export { Toaster };
