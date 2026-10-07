/** The person description from a prompt, without the lead-in and the camera notes. */
export function summarize(prompt: string): string {
  const body = prompt.replace(/^Photorealistic portrait photograph of one fictional adult, /, "");
  const end = body.indexOf(". ");
  return end > 0 ? body.slice(0, end) : body.split("\n")[0];
}

export function promptForGemini(prompt: string, prefix: string, negative: string, includeNegative: boolean) {
  return `${prefix}${prompt}${includeNegative ? `\n\nAvoid: ${negative}.` : ""}`;
}

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
