/**
 * A process and everything below it.
 *
 * `pnpm` runs a command through a shell and does not pass a signal on to it,
 * so the server sits two forks below `pnpm dev`. A stop that signals only the
 * process it started leaves the server holding the port.
 */
import { readFileSync } from "node:fs";

/**
 * The pids of `root` and every descendant, parents first.
 *
 * Read from /proc rather than by asking `ps`, so no child process is started
 * while the tree is being taken and the answer cannot include the question.
 * A pid that exits between being listed and being read contributes nothing,
 * which is the same answer as a pid with no children.
 */
export const descendants = (root) => {
  const found = [root];
  for (let i = 0; i < found.length; i += 1) {
    let children = [];
    try {
      children = readFileSync(`/proc/${found[i]}/task/${found[i]}/children`, "utf8")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
    } catch {
      children = [];
    }
    for (const child of children) if (!found.includes(child)) found.push(child);
  }
  return found;
};
