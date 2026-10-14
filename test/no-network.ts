// Preloaded into a spawned command with `--import`, before the command's own
// modules are evaluated. The smoke suite has no API key and must stay offline;
// this is what makes that an observation rather than an intention. Every way
// out of the process that could reach another machine turns into a loud,
// self-naming failure, so a command that reached for one would either die on
// the tripwire or — if the run caught the error and reported it the way it
// reports any other failure — fail the byte contract that names the reason.
//
// Nothing here is imported by the suite itself. It is a side effect on load.
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

/** Every attempt made, so the exit can name them all rather than the first. */
const attempts: string[] = [];

/**
 * The one failure this module raises. It is thrown rather than returned so it
 * arrives the way any other failure inside a command's work arrives, and it
 * names the call that tried, because "something reached out" is not a finding.
 * The CLI contract greps for this phrase, so it is also how a run that reached
 * out and was caught anyway shows up on the child's stderr.
 */
const trip = (what: string): never => {
  attempts.push(what);
  throw new Error(`the smoke suite must not use the network: ${what}`);
};

// Sockets first, because they are the way out every HTTP client ends up using,
// whichever API it was written against. Name resolution is next: a lookup is
// reaching for another machine even though it opens nothing itself. `fetch` is
// last, because a runtime may replace it and any code that cached the original
// is covered by one of the two above.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function tripwiredConnect(...args: unknown[]): net.Socket {
  trip(`net.connect(${String(args[0])})`);
  // Unreachable, but the replacement has to be assignable to what it replaces.
  return (connect as unknown as (...a: unknown[]) => net.Socket).apply(this, args);
};
tls.connect = ((...args: unknown[]) =>
  trip(`tls.connect(${String(args[0])})`)) as unknown as typeof tls.connect;
for (const level of ["lookup", "resolve", "resolve4", "resolve6"] as const) {
  (dns as unknown as Record<string, unknown>)[level] = (...args: unknown[]) =>
    trip(`dns.${level}(${String(args[0])})`);
}
globalThis.fetch = ((input: unknown) =>
  trip(`fetch(${typeof input === "string" ? input : String(input)})`)) as typeof fetch;

// A throw from a socket call inside an async chain arrives as a rejected
// promise, and Node's own wording for one of those says nothing about the
// tripwire. Saying it here keeps the phrase findable wherever it lands.
process.on("unhandledRejection", (reason) => {
  console.error(reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

// And on the way out, so an attempt that was caught somewhere and survived
// still cannot pass for a clean run: the checks below look for the phrase on
// stderr, and a command that exited 0 after reaching out is not one either.
process.on("exit", (code) => {
  if (!attempts.length) return;
  for (const what of attempts) console.error(`the smoke suite must not use the network: ${what}`);
  if (code === 0) process.exitCode = 1;
});