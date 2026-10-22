// A stand-in for the Codex CLI, so no test runs the real one. It answers
// `login status` from FAKE_CODEX_LOGIN, and `exec` from FAKE_CODEX_MODE, in the
// shapes codex-cli 0.163.0 was measured to use in Phase 0: `exec --json` prints
// the thread and the agent's messages, and the image call goes to a session log
// under CODEX_HOME, with the PNG beside it in generated_images/<thread>/.
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (args[0] === "login" && args[1] === "status") {
  const login = process.env.FAKE_CODEX_LOGIN ?? "none";
  if (login === "chatgpt") console.log("Logged in using ChatGPT");
  else if (login === "apikey") console.log("Logged in using an API key");
  else {
    console.error("Not logged in");
    process.exit(1);
  }
  process.exit(0);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const prompt = /\n=== PROMPT ===\n([\s\S]*)$/.exec(input)?.[1] ?? "";
  const mode = process.env.FAKE_CODEX_MODE ?? "good";
  const home = process.env.CODEX_HOME;
  const thread = randomUUID();
  const day = join(home, "sessions", "2026", "10", "22");
  mkdirSync(day, { recursive: true });
  const log = join(day, `rollout-2026-10-22T08-55-07-${thread}.jsonl`);
  const record = (payload) => appendFileSync(log, `${JSON.stringify({ type: "event_msg", payload })}\n`);
  const message = (text) => emit({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } });
  // What the image tool records: the text it used and where it saved the PNG.
  const image = (revisedPrompt) => {
    const id = `exec-${randomUUID()}`;
    const dir = join(home, "generated_images", thread);
    mkdirSync(dir, { recursive: true });
    const savedPath = join(dir, `${id}.png`);
    copyFileSync(process.env.FAKE_CODEX_IMAGE, savedPath);
    record({
      type: "item_completed",
      thread_id: thread,
      item: {
        type: "Extension", kind: "image_gen.generation", id, status: "completed",
        ...(revisedPrompt === undefined ? {} : { revisedPrompt }),
        transparentBackground: false, failure: null, savedPath,
      },
    });
  };

  emit({ type: "thread.started", thread_id: thread });
  emit({ type: "turn.started" });
  if (process.env.OPENAI_API_KEY) {
    emit({ type: "error", message: "The stand-in saw OPENAI_API_KEY, which the provider must remove." });
    process.exit(1);
  }
  if (mode === "good") {
    image(prompt);
    message("Generated one image.");
  } else if (mode === "altered") {
    image(`${prompt}, cinematic lighting`);
  } else if (mode === "leaked") {
    // What codex-wrapper-2 drew: a prefix the agent made up, and the closing marker.
    image(`Generate an image. ${prompt} PROMPT>>>`);
  } else if (mode === "unverified") {
    image(undefined);
  } else if (mode === "refused") {
    message("I can’t create that image because it goes against our content policy.");
  } else if (mode === "usage") {
    emit({ type: "turn.failed", error: { message: "You've hit your usage limit. Try again in 3 hours." } });
    process.exit(1);
  } else if (mode === "signed-out") {
    emit({ type: "error", message: "401 Unauthorized: not logged in" });
    process.exit(1);
  } else if (mode === "no-image") {
    message("Done.");
  } else if (mode === "hang") {
    setTimeout(() => {}, 600_000);
    return;
  }
  emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
});
