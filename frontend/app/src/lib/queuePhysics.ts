/** A short, constrained pull followed by a backward impact wave.
 * The old confirmed card leads the line out of view. The next card stops at
 * the boundary and becomes confirmed. Links may take up their hanging slack,
 * but cannot stretch like springs. Returned positions are sampled at 60 Hz. */
export type PullInput = {
  leadDistance: number;
  movers: number[];
};

export type PullSequence = {
  sampleMs: number;
  durationMs: number;
  /** When the incoming confirmed card first hits its new position. */
  arrivalMs: number;
  lead: number[];
  /** Distance remaining to each new position; positive during recoil. */
  movers: number[][];
};

export const SLACK_PX = 8;
const DRAW_MS = 620;
const SAMPLE_MS = 1000 / 60;
const RECOIL_PX = 5;
const RECOIL_MS = 300;
const IMPACT_STEP_MS = 35;

export function pullSequence({ leadDistance, movers }: PullInput): PullSequence {
  const distance = Math.max(0, leadDistance);
  const speed = Math.max(0.1, (2 * distance) / DRAW_MS);
  const leadAt = (ms: number) => distance * Math.min(1, ms / DRAW_MS) ** 2;
  // After the old card exits, momentum carries each follower through the
  // remaining slack. Stop exactly at its slot; never cross the front wall.
  const driverAt = (ms: number) => (ms <= DRAW_MS ? leadAt(ms) : distance + (ms - DRAW_MS) * speed);
  // A block that does not move still passes the pull on, but adds no slack.
  let moving = 0;
  const delays = movers.map((length) => (length > 0 ? ++moving : moving) * SLACK_PX);
  const hitTimes = delays.map((slack) => DRAW_MS + slack / speed);
  // Keep one sampled frame of contact before the kick, so the impact reads.
  const contacts = hitTimes.map((ms) => Math.ceil(ms / SAMPLE_MS) * SAMPLE_MS);
  const durationMs =
    Math.ceil(
      (DRAW_MS + moving * (SLACK_PX / speed + IMPACT_STEP_MS) + RECOIL_MS + 180) / SAMPLE_MS,
    ) * SAMPLE_MS;
  const lead: number[] = [];
  const out: number[][] = movers.map(() => []);
  for (let frame = 0; frame <= Math.round(durationMs / SAMPLE_MS); frame++) {
    const ms = frame * SAMPLE_MS;
    lead.push(leadAt(ms));
    movers.forEach((length, i) => {
      if (!length || !distance) {
        out[i]!.push(0);
        return;
      }
      const travelled = Math.min(distance, Math.max(0, driverAt(ms) - delays[i]!));
      const remaining = length * (1 - travelled / distance);
      const recoilStart = contacts[i]! + SAMPLE_MS + i * IMPACT_STEP_MS;
      const t = (ms - recoilStart) / RECOIL_MS;
      const recoil = t > 0 && t < 1 ? RECOIL_PX * 0.7 ** i * Math.sin(Math.PI * t) ** 2 : 0;
      out[i]!.push(Math.max(0, remaining) + recoil);
    });
  }
  return { sampleMs: SAMPLE_MS, durationMs, arrivalMs: contacts[0] ?? DRAW_MS, lead, movers: out };
}

/** How deep a link hangs, as a share of its rest sag: straight once its cards
 * are SLACK_PX further apart than at rest, and up to 1.8 times deeper as they
 * close up. */
export const sagFor = (gap: number, rest: number): number =>
  Math.sqrt(Math.min(3.24, Math.max(0, 1 - (gap - rest) / SLACK_PX)));
