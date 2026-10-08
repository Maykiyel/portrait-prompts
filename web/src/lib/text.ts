/** A short excerpt for the list, without encoding any knowledge of Prompt wording. */
export function summarize(prompt: string): string {
  const firstLine = prompt.split("\n")[0];
  const excerpt = firstLine.split(". ").slice(1).join(". ") || firstLine;
  const end = excerpt.indexOf(". ");
  return end > 0 ? excerpt.slice(0, end) : excerpt;
}

/**
 * The five-digit Seed label the pages show. The output-folder module owns the same
 * form for filenames and the command line, but it pulls in the image library, so
 * the browser cannot import it. This is the only place the browser states the rule,
 * and the smoke test fails if a second copy appears.
 */
export const seedLabel = (seed: number) => String(seed).padStart(5, "0");

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
