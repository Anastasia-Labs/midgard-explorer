/**
 * A manifest family name in the reader's terms: `stateQueue` reads as
 * "State queue".
 *
 * This module also held a validator label with a "manifest" badge whose tooltip
 * said the contract was "verified against" the deployment manifest. A manifest
 * that parses is configuration, not verification, and the label's only users
 * were pages built on the decommissioned Cardano index, so both went with it.
 */
export function contractName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.length === 0 ? value : `${words[0]?.toUpperCase()}${words.slice(1)}`;
}
