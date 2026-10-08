import "dotenv/config";
import { openOutputFolder, seedLabel } from "./output-folder";

const outDir = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "out";
const folder = openOutputFolder(outDir, (process.env.SEED_SALT ?? "").trim());
// One read of the folder answers every question below, including the failed
// count. A folder the module calls unusable stops the command rather than
// reporting numbers it cannot stand behind.
const state = folder.status();
if (state.problem) {
  console.error(state.problem);
  process.exit(1);
}
const waiting = folder.waitingSeeds();

console.log(`Seed salt       ${state.saltSet ? "set" : "not set"}`);
console.log(`Next new seed   ${state.next}`);
console.log(`Images done     ${state.done}`);
console.log(`Waiting         ${waiting.length}${waiting.length ? `  (${seedLabel(waiting[0])} to ${seedLabel(waiting[waiting.length - 1])})` : ""}`);
if (state.failed) console.log(`Last attempt failed for ${state.failed} seeds, they run first next time`);
