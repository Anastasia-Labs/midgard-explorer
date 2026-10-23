// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeStateQueue, type StateQueueResponse } from "@midgard-explorer/contracts";
import { stateQueue } from "../e2e/fixtures/data.mjs";
import { StateQueue } from "../src/features/block/StateQueue";
import { StateQueueDemo } from "../src/features/block/StateQueueDemo";
import { joinedQueue, queueAnnouncement, queueSlots } from "../src/lib/stateQueue";
import { ToneBadge } from "../src/components/ui/domain/status";
import { statusOf } from "../src/lib/status-registry";

const still = () => decodeStateQueue(stateQueue());
const at = (tick: number) => decodeStateQueue(stateQueue(tick));

afterEach(cleanup);

describe("the queue's drawn order", () => {
  it("runs confirmed, oldest, the hidden middle, newest, then the commit", () => {
    const q = at(1);
    const slots = queueSlots(q);
    expect(slots.map((s) => s.kind)).toEqual([
      "confirmed",
      ...q.oldest.map(() => "block"),
      "gap",
      ...q.newest.map(() => "block"),
      "commit",
    ]);
    // The confirmed card keeps one key while the header it shows changes.
    expect(slots[0]!.key).toBe("confirmed");
    expect(slots.find((s) => s.kind === "gap")).toMatchObject({ count: q.hidden });
  });

  it("names a lone waiting block as the next to merge", () => {
    const q = still();
    const lone = { ...q, depth: 1, linked: 1, oldest: [q.oldest[0]!], newest: [], hidden: 0 };
    const blocks = queueSlots(lone).flatMap((s) => (s.kind === "block" ? [s.role] : []));
    expect(blocks).toEqual(["oldest"]);
  });

  it("names only the ends", () => {
    const roles = queueSlots(still()).flatMap((s) => (s.kind === "block" ? [s.role] : []));
    expect(roles[0]).toBe("oldest");
    expect(roles.at(-1)).toBe("newest");
    expect(roles.slice(1, -1).every((r) => r === null)).toBe(true);
  });
});

describe("what counts as joining the queue", () => {
  it("is a header past the newest one already seen", () => {
    // Tick 2 lands the commit tick 1 had on its way.
    expect(joinedQueue(at(1), at(2))).toEqual([at(2).newest.at(-1)!.headerHash]);
  });

  it("is not a header the window moved into view", () => {
    // Tick 3 merges one header and lands none: the window shifts, nothing joins.
    expect(joinedQueue(at(2), at(3))).toEqual([]);
    // The commit on its way is the same one, a status further on.
    expect(queueAnnouncement(at(2), at(3))).toBe("Merge recorded");
  });
});

describe("the fixture queue", () => {
  it("satisfies the wire contract, still and moving", () => {
    expect(() => decodeStateQueue(stateQueue())).not.toThrow();
    for (let t = 0; t < 12; t++) expect(() => decodeStateQueue(stateQueue(t))).not.toThrow();
  });
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(initial: StateQueueResponse | null, unavailable = false, qc = client()) {
  const view = render(
    <QueryClientProvider client={qc}>
      <StateQueue initial={initial} unavailable={unavailable} />
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

describe("the queue on the Blocks page", () => {
  beforeEach(() => {
    // The poll must not reach a network; the tests drive readings themselves.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws every listed header as a link to its block, with the hidden count", () => {
    const q = still();
    mount(q);
    const list = screen.getByRole("list", { name: /State queue/ });
    for (const b of [...q.oldest, ...q.newest]) {
      expect(list.querySelector(`a[href="/block/${b.headerHash}"]`), b.headerHash).not.toBeNull();
    }
    expect(within(list).getByText(`${q.hidden} more`)).toBeTruthy();
    expect(within(list).getByText("Confirmed state")).toBeTruthy();
    expect(within(list).getByText("Next to merge")).toBeTruthy();
    expect(screen.getByText(`${q.depth} waiting to merge`)).toBeTruthy();
  });

  it("says Unavailable, and draws nothing, when the source cannot read it", () => {
    mount(null, true);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByRole("list", { name: /State queue/ })).toBeNull();
    expect(screen.queryByText(/waiting to merge/)).toBeNull();
  });
});

describe("motion", () => {
  let animate: ReturnType<typeof vi.fn>;
  let reduce = false;
  /** How far the page has scrolled, which moves every box up by as much. */
  let pageScroll = 0;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    animate = vi.fn(() => ({ cancel() {} }));
    reduce = false;
    pageScroll = 0;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduce && query.includes("reduce"),
    }));
    // Element, not HTMLElement: the chain is SVG.
    Object.assign(Element.prototype, { animate, getAnimations: () => [] });
    // Lay the list out in a row, one hundred pixels per item, so a card that
    // changes place has somewhere to travel from.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      // A box inside a sideways scroller moves left by what it has scrolled.
      const scroller = this.parentElement?.closest<HTMLElement>(".overflow-x-auto");
      const left = index * 100 - (scroller?.scrollLeft ?? 0);
      return {
        left,
        right: left + 90,
        top: -pageScroll,
        bottom: 60 - pageScroll,
        width: 90,
        height: 60,
      } as DOMRect;
    });
    // The phone arrow is the first SVG in a connector, but hidden on desktop.
    // Measuring that arrow instead of the cable used to disable chain motion.
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: SVGElement,
    ) {
      return {
        left: 0,
        right: 32,
        top: 0,
        bottom: 40,
        width: this.hasAttribute("data-queue-cable") ? 32 : 0,
        height: 40,
      } as DOMRect;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // react-query delivers an update on a timer, so the step waits for it.
  const step = (qc: QueryClient, q: StateQueueResponse) =>
    act(async () => {
      qc.setQueryData(["state-queue"], q);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it("moves a landed commit to the tail", async () => {
    const { container, qc } = mount(at(1));
    expect(animate).not.toHaveBeenCalled();
    await step(qc, at(2));
    const joined = at(2).newest.at(-1)!.headerHash;
    const card = container.querySelector(`[data-queue-key="${joined}"]`)!;
    // The commit landed: it travels from its old place rather than appearing.
    expect(animate.mock.contexts).toContain(card);
    expect(container.querySelector("[data-queue-ghost]")).toBeNull();
  });

  it("moves the old confirmed card out and promotes its successor at the boundary", async () => {
    const { container, qc } = mount(at(2));
    const merged = at(2).oldest[0]!.headerHash;
    expect(at(3).confirmed!.headerHash).toBe(merged);
    await step(qc, at(3));

    // The successor travels as itself, then switches to the confirmed label.
    const ghosts = [...container.querySelectorAll<HTMLElement>("[data-queue-ghost]")];
    const ghost = ghosts.find((g) => g.textContent?.includes(merged.slice(0, 6)))!;
    expect(ghost).toBeDefined();
    expect(ghost.textContent).toContain("Next to merge");
    expect(ghost.textContent).toContain("Waiting to merge");
    const absorb = animate.mock.calls[animate.mock.contexts.indexOf(ghost)]!;
    expect(absorb[0].at(-1)).toMatchObject({ opacity: 0 });
    expect(absorb[0].every((frame: Keyframe) => !String(frame.transform).includes("scale"))).toBe(
      true,
    );
    expect(ghost.parentElement!.style.overflow).toBe("hidden");
    const outgoing = container.querySelector("[data-queue-outgoing]")!;
    expect(outgoing.textContent).toContain(at(2).confirmed!.headerHash.slice(0, 6));
    const outgoingFrames = animate.mock.calls[animate.mock.contexts.indexOf(outgoing)]![0];
    const exitX = Number(
      /translate\((-?[\d.e-]+)px/.exec(String(outgoingFrames.at(-1).transform))![1],
    );
    expect(exitX).toBeLessThan(-90);
    const cables = container.querySelector("[data-queue-overlay]");
    expect(cables).not.toBeNull();
    const attached = [...cables!.querySelectorAll('path[opacity="1"]')];
    expect(attached.length).toBeGreaterThan(1);
    expect(attached.every((path) => !path.getAttribute("d")!.includes("NaN"))).toBe(true);

    // Contact stops forward travel; the impact then pushes the block back.
    const next = container.querySelector(`[data-queue-key="${at(3).oldest[0]!.headerHash}"]`)!;
    const frames = animate.mock.calls[animate.mock.contexts.indexOf(next)]![0] as Keyframe[];
    const xs = frames.map((f) => Number(/translate\((-?[\d.e-]+)px/.exec(String(f.transform))![1]));
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs[1]).toBe(xs[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs.slice(xs.indexOf(0)))).toBeGreaterThan(3);
    expect(xs.at(-1)).toBe(0);

    // The new confirmed card moves from its old queue position, appears on
    // contact, and recoils from the boundary without crossing it.
    const anchor = container.querySelector('[data-queue-kind="confirmed"]')!;
    const anchorFrames = animate.mock.calls[animate.mock.contexts.indexOf(anchor)]![0];
    expect(anchorFrames[0]).toMatchObject({ opacity: 0 });
    expect(anchorFrames.at(-1)).toMatchObject({ transform: "translate(0px, 0px)", opacity: 1 });
    // Only the decorative letter layer animates; accessible text stays whole.
    const title = anchor.querySelector("[data-queue-title-reveal]")!;
    expect(title.getAttribute("aria-hidden")).toBe("true");
    const letters = [...title.querySelectorAll("[data-queue-letter]")];
    expect(
      letters
        .map((letter) => letter.querySelector("[data-queue-letter-new]")!.textContent)
        .join(""),
    ).toBe("Confirmed state");
    const titleHost = title.querySelector("[data-queue-text-shake]")!;
    const shake = animate.mock.calls[animate.mock.contexts.indexOf(titleHost)]!;
    const revealTime = shake[1].delay as number;
    const movement = animate.mock.calls[animate.mock.contexts.indexOf(anchor)]![1];
    const contact = anchorFrames.findIndex(
      (frame: Keyframe) => frame.transform === "translate(0px, 0px)" && frame.opacity === 1,
    );
    const contactMs = (contact * movement.duration) / (anchorFrames.length - 1);
    expect(Math.abs(revealTime - contactMs)).toBeLessThan(17);
    expect(revealTime).toBeLessThan(movement.duration);
    const wave = shake[0];
    expect(wave.map((frame: Keyframe) => frame.transform)).toEqual([
      "translateY(0)",
      "translateY(-2px)",
      "translateY(0.5px)",
      "translateY(0)",
    ]);
    const liftOf = (frames: Keyframe[]) =>
      Math.abs(Number(/translateY\((-?[\d.e-]+)px\)/.exec(String(frames[1]!.transform))![1]));
    const newGlyph = letters[0]!.querySelector("[data-queue-letter-new]")!;
    const swap = animate.mock.calls[animate.mock.contexts.indexOf(newGlyph)]!;
    expect(swap[1].delay).toBe(revealTime + shake[1].duration * 0.3);
    const lastGlyph = letters.at(-1)!.querySelector("[data-queue-letter-new]")!;
    expect(animate.mock.calls[animate.mock.contexts.indexOf(lastGlyph)]![1].delay).toBe(
      swap[1].delay,
    );
    expect(anchor.querySelector("[data-queue-caption-text]")!.textContent).toBe("Confirmed state");
    expect(anchor.querySelector('[data-queue-field="details"]')!.textContent).toContain("Recorded");
    for (const field of ["status", "counts", "time-label", "time"]) {
      const overlay = anchor.querySelector(`[data-queue-text-reveal="${field}"]`)!;
      expect(overlay, field).not.toBeNull();
      const firstLetter = overlay.querySelector("[data-queue-letter]")!;
      const host = overlay.querySelector("[data-queue-text-shake]")!;
      const motion =
        animate.mock.calls[animate.mock.contexts.indexOf(field === "counts" ? firstLetter : host)]!;
      expect(motion[1].delay).toBeGreaterThan(revealTime);
      if (field === "counts") {
        expect(firstLetter.hasAttribute("data-queue-letter-exit")).toBe(true);
        expect(motion[0]).toHaveLength(2);
        expect(motion[0].at(-1).opacity).toBe(0);
        expect(liftOf(motion[0])).toBeGreaterThan(0);
        expect(animate.mock.contexts.includes(host)).toBe(false);
      } else {
        expect(liftOf(motion[0])).toBeLessThan(liftOf(wave));
        expect(motion[0].at(-1).transform).toBe("translateY(0)");
      }
    }
  });

  it("absorbs nothing when a block leaves without a merge", async () => {
    const q = at(2);
    const { container, qc } = mount(q);
    const removed = q.newest.at(-1)!;
    await step(qc, {
      ...q,
      newest: q.newest.slice(0, -1),
      removed: 1,
      removedBlocks: [removed],
    } as StateQueueResponse);
    expect(container.querySelector("[data-queue-ghost]")).toBeNull();
    // It goes to the removed lane, by its own key.
    const lane = screen.getByRole("list", { name: "Removed from the queue" });
    expect(lane.querySelector(`[data-queue-key="${removed.headerHash}"]`)).not.toBeNull();
  });

  /** A reading with nothing new keeps every card still, however far the
   * reader scrolled the page or the queue in between. */
  it("moves nothing when only the page scrolled between readings", async () => {
    const { qc } = mount(at(1));
    pageScroll = 300;
    await step(qc, decodeStateQueue(stateQueue(1)));
    expect(animate).not.toHaveBeenCalled();
  });

  it("moves nothing when only the queue scrolled sideways between readings", async () => {
    const { container, qc } = mount(at(1));
    container.querySelector<HTMLElement>("[data-queue-track]")!.parentElement!.scrollLeft = 200;
    await step(qc, decodeStateQueue(stateQueue(1)));
    expect(animate).not.toHaveBeenCalled();
  });

  it("fades in a header new to the drawing", async () => {
    const { container, qc } = mount(at(1));
    // Six ticks on: three headers landed, and the window shows ones never drawn.
    await step(qc, at(7));
    const fresh = at(7).newest.at(-1)!.headerHash;
    const card = container.querySelector(`[data-queue-key="${fresh}"]`)!;
    const call = animate.mock.calls[animate.mock.contexts.indexOf(card)]!;
    expect(call[0][0]).toMatchObject({ opacity: 0 });
  });

  it("announces the change, not the queue", async () => {
    const { qc } = mount(at(2));
    await step(qc, at(3));
    expect(screen.getByText(/^Merge recorded ·/)).toBeTruthy();
  });

  it("does not move at all with reduced motion", async () => {
    reduce = true;
    const { qc } = mount(at(1));
    await step(qc, at(2));
    await step(qc, at(3));
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("what a reader can ask of a card", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens a block's details on request and keeps them across a reading", async () => {
    const { qc } = mount(at(1));
    const list = screen.getByRole("list", { name: /State queue/ });
    fireEvent.click(within(list).getAllByRole("button", { name: "Show details" })[1]!);
    const details = screen.getByRole("region", { name: "Block details" });
    const oldest = at(1).oldest[0]!;
    for (const label of ["Header hash", "Builds on", "Made by", "Commit on Cardano", "Matures"]) {
      expect(within(details).getByText(label)).toBeTruthy();
    }
    // No public or node source carries a block's DA status, so it says so.
    expect(within(details).getByText("Data availability").closest("div")!.textContent).toContain(
      "Unavailable",
    );
    expect(details.textContent).toContain(oldest.headerHash);
    await act(async () => {
      qc.setQueryData(["state-queue"], at(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("region", { name: "Block details" }).textContent).toContain(
      oldest.headerHash,
    );
  });

  it("names the confirmed header itself in its details", () => {
    const q = still();
    mount(q);
    const list = screen.getByRole("list", { name: /State queue/ });
    fireEvent.click(within(list).getAllByRole("button", { name: "Show details" })[0]!);
    const details = screen.getByRole("region", { name: "Block details" });
    expect(details.textContent).toContain(q.confirmed!.headerHash);
  });

  it("draws a lone waiting block as next to merge, on a phone too", () => {
    const q = still();
    const only = q.oldest[0]!;
    const { container } = mount({
      ...q,
      depth: 1,
      linked: 1,
      oldest: [only],
      newest: [],
      hidden: 0,
    } as StateQueueResponse);
    const card = container.querySelector(`[data-queue-key="${only.headerHash}"]`)!;
    expect(card.textContent).toContain("Next to merge");
    expect(card.className).not.toContain("max-sm:hidden");
  });

  it("shows the confirmed state's Merged in the tone the registry gives it", () => {
    const { container } = mount(still());
    const badge = container.querySelector(
      '[data-queue-kind="confirmed"] [data-queue-field="status"]',
    )!;
    const merged = statusOf("merged");
    const reference = render(<ToneBadge tone={merged.tone} label={merged.label} />).container;
    expect(badge.innerHTML).toBe(reference.innerHTML);
  });

  it("says when a block matures, from its commit time and the deployment's maturity", () => {
    mount(still());
    expect(screen.getAllByText(/^Mature( in \S+)?$/).length).toBeGreaterThan(0);
  });

  it("puts removed headers in a lane of their own", () => {
    const q = still();
    mount({ ...q, removed: 1, removedBlocks: [q.newest.at(-1)!] } as StateQueueResponse);
    const lane = screen.getByRole("list", { name: "Removed from the queue" });
    expect(within(lane).getByText("Removed")).toBeTruthy();
  });

  it("says nobody is in line only when the queue is known to be empty", () => {
    const q = still();
    mount({ ...q, depth: 0, linked: 0, oldest: [], newest: [], hidden: 0 } as StateQueueResponse);
    expect(screen.getByText("Nobody in line right now.")).toBeTruthy();
    cleanup();
    // Partly linked: not known to be empty.
    mount({ ...q, depth: 3, linked: 0, oldest: [], newest: [], hidden: 0 } as StateQueueResponse);
    expect(screen.queryByText("Nobody in line right now.")).toBeNull();
  });
});

describe("the example", () => {
  /** The live card re-renders it on every poll; a step still lasts its time. */
  it("keeps its pace when the page around it re-renders", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<StateQueueDemo />);
      act(() => vi.advanceTimersByTime(2_000));
      rerender(<StateQueueDemo />);
      act(() => vi.advanceTimersByTime(700));
      expect(screen.getByText(/^2 of \d+$/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is marked as an example, steps through its story, and links nowhere", () => {
    const { container } = render(<StateQueueDemo />);
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByText(/^1 of \d+$/)).toBeTruthy();
    expect(screen.getByText("Blocks wait in line to merge into the confirmed chain.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(screen.getByText(/^2 of \d+$/)).toBeTruthy();
    expect(screen.getByText("A new block is on its way to Cardano.")).toBeTruthy();
    // Stepping pauses it, so the reader stays on the step they chose.
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(container.querySelector('a[href^="/block/"]')).toBeNull();
  });
});
