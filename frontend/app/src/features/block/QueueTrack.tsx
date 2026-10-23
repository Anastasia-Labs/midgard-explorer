"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { QueueBlock, StateQueueResponse } from "@midgard-explorer/contracts";
import { Chip } from "../../components/ui/base/layout";
import { FactRow } from "../../components/ui/base/facts";
import { Icon } from "../../components/ui/base/icons";
import { Timestamp } from "../../components/ui/base/timestamp";
import { BlockRef } from "../../components/ui/domain/blockref";
import { Identifier, ShortId } from "../../components/ui/domain/identifier";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { StatusBadge, ToneBadge } from "../../components/ui/domain/status";
import { cn, countNoun, formatDuration, formatTimestamp } from "../../lib/format";
import { pullSequence, sagFor, type PullSequence } from "../../lib/queuePhysics";
import { queueSlots, type QueueSlot } from "../../lib/stateQueue";
import { statusOf } from "../../lib/status-registry";

/** Motion durations. A block slides in with a small overshoot and cards
 * travel to their new places. An observed merge is its own sequence: the old
 * confirmed card leaves, its successor stops at the front boundary, and a
 * small impact wave travels back through the waiting blocks. */
const ENTER_MS = 320;
const MOVE_MS = 280;
const WAVE_MS = 240;
const TEXT_SETTLE_MS = 440;
const TEXT_FADE_MS = 150;
/** Each card's text starts this much after the card ahead of it. */
const TEXT_STAGGER_MS = 70;
const BOUNCE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** How far a chain hangs at rest. */
const CHAIN_SAG_PX = 14;

/** The text a merge changes, and how long after contact each row starts. */
const TEXT_FIELDS = [
  ["title", "[data-queue-caption-text]", 0],
  ["status", '[data-queue-field="status"]', 25],
  ["counts", '[data-queue-copy="counts"]', 45],
  ["time-label", '[data-queue-copy="time-label"]', 65],
  ["time", '[data-queue-copy="time"]', 65],
] as const;
const TYPE_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "textTransform",
  "lineHeight",
  "color",
] as const;

export const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Animate = (
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => Animation | null;

const animateElement: Animate = (el, keyframes, options) =>
  typeof el.animate === "function" ? el.animate(keyframes, options) : null;

/** A card's place: the confirmed card, a queued block, or anything else. */
const kindOf = (card: HTMLElement) => card.dataset.queueKind ?? "other";

/** A link between two drawn cards, with the gap between them at rest. */
type Link = { left: string; right: string; rest: number };

const linksBetween = (links: HTMLElement[], rects: Map<string, DOMRect>): Link[] =>
  links.flatMap((link) => {
    const [left, right] = link.dataset.queueBetween!.split(" ");
    const a = rects.get(left!);
    const b = rects.get(right!);
    return a && b ? [{ left: left!, right: right!, rest: Math.max(1, b.left - a.right) }] : [];
  });

/** A decorative copy of a card's last drawing, placed where the card was. */
function ghostOf(drawing: HTMLElement, at: DOMRect, origin: DOMRect, parent: HTMLElement) {
  const ghost = drawing.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-queue-key");
  ghost.removeAttribute("data-queue-kind");
  ghost.setAttribute("data-queue-ghost", "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${at.left - origin.left}px`,
    top: `${at.top - origin.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "1",
    listStyle: "none",
  });
  parent.appendChild(ghost);
  return ghost;
}

/** A clipped layer over the track, so a card can leave through the start of
 * the view without shrinking or fading in the middle of the queue. */
function exitLayerOver(el: HTMLElement, viewport: DOMRect, origin: DOMRect) {
  const layer = document.createElement("div");
  layer.setAttribute("data-queue-exit-layer", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  Object.assign(layer.style, {
    position: "absolute",
    left: `${viewport.left - origin.left}px`,
    top: `${viewport.top - origin.top}px`,
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "1",
  });
  el.appendChild(layer);
  return layer;
}

/** A node's text as a sighted reader sees it. */
const visibleText = (node: Element | null) => {
  const copy = node?.cloneNode(true) as HTMLElement | undefined;
  copy?.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
  return copy?.textContent ?? "";
};

/** A positioned copy of `source` laid over `current`, with its text swapped
 * for an empty host the letters go into. */
function textCopy(card: HTMLElement, current: HTMLElement, source: Element, field: string) {
  const cardRect = card.getBoundingClientRect();
  const rect = current.getBoundingClientRect();
  const overlay = source.cloneNode(true) as HTMLElement;
  overlay.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
  for (const name of ["id", "data-queue-caption-text", "data-queue-copy", "data-queue-field"])
    overlay.removeAttribute(name);
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-queue-text-reveal", field);
  if (field === "title") overlay.setAttribute("data-queue-title-reveal", "");
  Object.assign(overlay.style, {
    position: "absolute",
    left: `${rect.left - cardRect.left - card.clientLeft}px`,
    top: `${rect.top - cardRect.top - card.clientTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    whiteSpace: "pre",
    overflow: "visible",
  });
  // The title's typography lives on its parent, so a copy placed directly
  // under the card takes the computed style with it.
  const font = getComputedStyle(current);
  for (const key of TYPE_STYLES) overlay.style[key] = font[key];
  // Keep the badge, icon and time styling; replace only the text.
  const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  const host = document.createElement("span");
  host.style.display = "inline-block";
  host.setAttribute("data-queue-text-shake", "");
  if (texts.length) {
    texts[0]!.replaceWith(host);
    texts.slice(1).forEach((node) => node.remove());
  } else overlay.appendChild(host);
  return { overlay, host };
}

/** Fills `host` with one cell per letter that crossfades from the old glyph
 * to the new one. A letter with nothing after it only rises away. */
function spellOut(
  host: HTMLElement,
  before: string,
  after: string,
  start: number,
  animate: Animate,
) {
  const swap = {
    delay: start + TEXT_SETTLE_MS * 0.3,
    duration: TEXT_FADE_MS,
    easing: "linear",
    fill: "both",
  } as const;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const letter = document.createElement("span");
    letter.setAttribute("data-queue-letter", "");
    letter.style.display = "inline-grid";
    const oldGlyph = document.createElement("span");
    const newGlyph = document.createElement("span");
    oldGlyph.textContent = before[i] ?? " ";
    newGlyph.textContent = after[i] ?? " ";
    newGlyph.setAttribute("data-queue-letter-new", "");
    oldGlyph.style.gridArea = newGlyph.style.gridArea = "1 / 1";
    letter.append(oldGlyph, newGlyph);
    host.appendChild(letter);
    if (before[i]?.trim() && !after[i]?.trim()) {
      letter.setAttribute("data-queue-letter-exit", "");
      newGlyph.style.opacity = "0";
      animate(
        letter,
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-4px)", opacity: 0 },
        ],
        { delay: start, duration: TEXT_SETTLE_MS, easing: "ease-out", fill: "both" },
      );
      continue;
    }
    animate(oldGlyph, [{ opacity: 1 }, { opacity: 0 }], swap);
    animate(newGlyph, [{ opacity: 0 }, { opacity: 1 }], swap);
  }
}

/**
 * Changes a card's text from its previous drawing to its current one at
 * contact, letter by letter, with one restrained recoil per phrase. The work
 * happens in decorative copies; the live text stays whole and accessible
 * underneath, and each copy removes itself when it is done.
 */
function morphText(
  card: HTMLElement,
  previous: HTMLElement,
  index: number,
  contactMs: number,
  animate: Animate,
): HTMLElement[] {
  const overlays: HTMLElement[] = [];
  for (const [field, selector, rowDelay] of TEXT_FIELDS) {
    const current = card.querySelector<HTMLElement>(selector);
    if (!current) continue;
    const old = previous.querySelector(selector);
    const before = visibleText(old);
    const after = visibleText(current);
    if (before === after) continue;
    const start = contactMs + index * TEXT_STAGGER_MS + rowDelay;
    const { overlay, host } = textCopy(
      card,
      current,
      field === "status" ? (old ?? current) : current,
      field,
    );
    const lift = 2 * Math.exp(-index * 0.4 - rowDelay / 180);
    // A field that disappears only exits upward, with no return.
    if (after.trim()) {
      animate(
        host,
        [
          { transform: "translateY(0)" },
          { transform: `translateY(-${lift}px)`, offset: 0.3 },
          { transform: `translateY(${lift * 0.25}px)`, offset: 0.65 },
          { transform: "translateY(0)" },
        ],
        { delay: start, duration: TEXT_SETTLE_MS, easing: "ease-out", fill: "both" },
      );
    }
    spellOut(host, before, after, start, animate);
    card.appendChild(overlay);
    overlays.push(overlay);
    const reveal = animate(current, [{ opacity: 0 }, { opacity: 0 }], {
      duration: start + TEXT_SETTLE_MS + 1,
    });
    if (reveal) reveal.onfinish = () => overlay.remove();
  }
  return overlays;
}

/**
 * Draws the desktop chains frame by frame from the cards' real edges while a
 * merge plays, in place of the static links. The old links stay attached to
 * the departing cards and hand over to the new ones at contact. Returns a
 * function that stops drawing and puts the static links back.
 */
function drawChains({
  el,
  view,
  links,
  before,
  after,
  departing,
  live,
  clock,
  seq,
}: {
  el: HTMLElement;
  view: HTMLElement;
  links: HTMLElement[];
  before: Link[];
  after: Link[];
  departing: Map<string, HTMLElement>;
  live: Map<string, HTMLElement>;
  clock: Animation;
  seq: PullSequence;
}) {
  const ns = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(ns, "svg");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-queue-overlay", "");
  overlay.setAttribute("class", "text-text-3");
  Object.assign(overlay.style, {
    position: "absolute",
    left: "0",
    top: "0",
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: "2",
    width: `${view.clientWidth}px`,
    height: `${view.offsetHeight}px`,
  });
  const withPath = (link: Link) => {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.25");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", "5 3");
    overlay.appendChild(path);
    return { ...link, path };
  };
  const oldPaths = before.map(withPath);
  const newPaths = after.map(withPath);
  links.forEach((link) => {
    link.style.visibility = "hidden";
  });
  el.appendChild(overlay);

  const paint = (items: typeof oldPaths, old: boolean, opacity: number, base: DOMRect) => {
    for (const { left, right, rest, path } of items) {
      const a = (old ? departing.get(left) : null) ?? live.get(left);
      const b = (old ? departing.get(right) : null) ?? live.get(right);
      if (!a || !b) {
        path.setAttribute("opacity", "0");
        continue;
      }
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const x1 = ar.right - base.left;
      const x2 = br.left - base.left;
      const y1 = ar.top + ar.height / 2 - base.top;
      const y2 = br.top + br.height / 2 - base.top;
      const gap = x2 - x1;
      const sag = CHAIN_SAG_PX * sagFor(gap, rest);
      path.setAttribute(
        "d",
        `M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag * 2} ${x2} ${y2}`,
      );
      path.setAttribute("opacity", gap > 0 ? String(opacity) : "0");
    }
  };
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    overlay.remove();
    links.forEach((link) => {
      link.style.visibility = "";
    });
  };
  const draw = () => {
    const ms = Number(clock.currentTime ?? 0);
    const base = el.getBoundingClientRect();
    // The handover runs from 60ms before contact to 60ms after it.
    const blend = Math.min(1, Math.max(0, (ms - seq.arrivalMs + 60) / 120));
    paint(oldPaths, true, 1 - blend, base);
    paint(newPaths, false, blend, base);
    if (ms < seq.durationMs) frame = requestAnimationFrame(draw);
    else stop();
  };
  draw();
  return stop;
}

/**
 * Moves each card from where it was to where it is (FLIP), keyed by header
 * hash, and plays the merge sequence when one is observed.
 *
 * A merge is observed when the confirmed header becomes one this drawing
 * showed in the queue: that block and any drawn before it are what merged,
 * since the queue's order is its links. A block that merely leaves the
 * drawing, for a removal or a moved window, is never absorbed. The previous
 * confirmed card exits and the incoming confirmed card takes its place. With
 * reduced motion nothing moves: the new state simply appears.
 */
function useQueueMotion(
  root: React.RefObject<HTMLElement | null>,
  version: unknown,
  confirmedHash: string | null,
) {
  const rects = useRef(new Map<string, DOMRect>());
  const drawings = useRef(new Map<string, HTMLElement>());
  const anchorDrawing = useRef<HTMLElement | null>(null);
  const order = useRef<string[]>([]);
  const lastConfirmed = useRef(confirmedHash);
  const connections = useRef<Link[]>([]);
  /** The root's place and each scroller's offset when `rects` was measured. */
  const frame = useRef<{
    left: number;
    top: number;
    scroll: Map<Element, { x: number; y: number }>;
  } | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const animations: Animation[] = [];
    const animate: Animate = (...args) => {
      const run = animateElement(...args);
      if (run) animations.push(run);
      return run;
    };
    let clearChains = () => {};
    const textOverlays: HTMLElement[] = [];
    el.querySelectorAll("[data-queue-ghost]").forEach((ghost) => ghost.remove());
    const cards = [...el.querySelectorAll<HTMLElement>("[data-queue-key]")];
    const links = [...el.querySelectorAll<HTMLElement>("[data-queue-between]")];
    for (const card of cards) card.getAnimations?.().forEach((a) => a.cancel());
    // A card the phone layout hides has no box; it neither travels nor is
    // travelled from, so a header that comes into view on a phone slides in.
    const next = new Map(
      cards.flatMap((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width === 0 ? [] : [[card.dataset.queueKey!, rect] as const];
      }),
    );
    // Boxes are measured against the viewport, so a reader who scrolled the
    // page or a queue between readings would make every card travel by that
    // much. The previous boxes are moved by the scroll instead: a reading
    // compares where cards sit in the queue, not where the reader is.
    const rootNow = el.getBoundingClientRect();
    const scrollers = [...el.querySelectorAll<HTMLElement>("[data-queue-scroller]")];
    const scrollerOf = new Map(
      cards.map((card) => [card.dataset.queueKey!, card.closest("[data-queue-scroller]")]),
    );
    const trackScroller = el.querySelector('[data-queue-scroller="track"]');
    const was = frame.current;
    const before = new Map(
      [...rects.current].map(([key, rect]) => {
        if (!was) return [key, rect] as const;
        const scroller = scrollerOf.get(key) ?? trackScroller;
        const then = scroller ? was.scroll.get(scroller) : undefined;
        const dx = rootNow.left - was.left - (scroller && then ? scroller.scrollLeft - then.x : 0);
        const dy = rootNow.top - was.top - (scroller && then ? scroller.scrollTop - then.y : 0);
        if (dx === 0 && dy === 0) return [key, rect] as const;
        return [
          key,
          {
            left: rect.left + dx,
            right: rect.right + dx,
            top: rect.top + dy,
            bottom: rect.bottom + dy,
            width: rect.width,
            height: rect.height,
          } as DOMRect,
        ] as const;
      }),
    );
    const upTo =
      !first.current && confirmedHash !== null && confirmedHash !== lastConfirmed.current
        ? order.current.indexOf(confirmedHash)
        : -1;
    const absorbed = upTo >= 0 ? order.current.slice(0, upTo + 1) : [];

    if (!first.current && !reducedMotion()) {
      const origin = el.getBoundingClientRect();
      const anchor = el.querySelector<HTMLElement>('[data-queue-kind="confirmed"]');
      const track = el.querySelector<HTMLElement>("[data-queue-track]");
      const shift = (card: HTMLElement) => {
        const key = card.dataset.queueKey!;
        const now = next.get(key);
        const then = before.get(key);
        return now && then ? { dx: then.left - now.left, dy: then.top - now.top } : null;
      };

      // The merge is physics; see lib/queuePhysics.ts. The new confirmed card
      // leads, and every other card in the main track that moved is a mover
      // in queue order, tied to the one ahead.
      const pull = (() => {
        if (absorbed.length === 0 || !anchor || !track) return null;
        const from = before.get(absorbed.at(-1)!);
        if (!from) return null;
        const target = anchor.getBoundingClientRect();
        const view = track.parentElement!;
        const dx = from.left - target.left;
        const dy = from.top - target.top;
        const distance = Math.hypot(dx, dy);
        if (!distance) return null;
        const movers = [
          { card: anchor, dx, dy, len: distance },
          ...[...track.querySelectorAll<HTMLElement>(":scope > [data-queue-key]")].flatMap(
            (card) => {
              const d = kindOf(card) === "confirmed" ? null : shift(card);
              return d && (d.dx !== 0 || d.dy !== 0)
                ? [{ card, ...d, len: Math.hypot(d.dx, d.dy) }]
                : [];
            },
          ),
        ];
        return {
          target,
          view,
          viewport: view.getBoundingClientRect(),
          distance,
          dx,
          dy,
          movers,
          seq: pullSequence({ leadDistance: distance, movers: movers.map((m) => m.len) }),
        };
      })();

      const pulledKeys = new Set(pull?.movers.map((m) => m.card.dataset.queueKey!) ?? []);
      for (const card of cards) {
        const key = card.dataset.queueKey!;
        if (!next.has(key) || kindOf(card) === "confirmed" || pulledKeys.has(key)) continue;
        const d = shift(card);
        if (!d) {
          animate(
            card,
            [
              { opacity: 0, transform: "translateX(16px)" },
              { opacity: 1, transform: "none" },
            ],
            {
              duration: ENTER_MS,
              easing: BOUNCE,
              ...(pull ? { delay: pull.seq.arrivalMs, fill: "backwards" as const } : {}),
            },
          );
        } else if (d.dx !== 0 || d.dy !== 0) {
          animate(card, [{ transform: `translate(${d.dx}px, ${d.dy}px)` }, { transform: "none" }], {
            duration: MOVE_MS,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          });
        }
      }

      if (pull && anchor) {
        const { seq } = pull;
        const timing = { duration: seq.durationMs, easing: "linear", fill: "both" as const };
        // A point `distance` along the lead's path toward the confirmed place.
        const toward = (distance: number) =>
          `translate(${(-pull.dx * distance) / pull.distance}px, ${(-pull.dy * distance) / pull.distance}px)`;
        // Where each mover is at each sample, as an offset from its new place.
        const offsets = new Map(
          pull.movers.map((m, i) => [
            m.card.dataset.queueKey!,
            seq.movers[i]!.map((r) => ({ x: (m.dx / m.len) * r, y: (m.dy / m.len) * r })),
          ]),
        );
        const still = seq.lead.map(() => ({ x: 0, y: 0 }));
        const at = (key: string | undefined) => (key && offsets.get(key)) || still;
        for (const m of pull.movers) {
          animate(
            m.card,
            at(m.card.dataset.queueKey).map((o, frame) => ({
              transform: `translate(${o.x}px, ${o.y}px)`,
              ...(m.card === anchor
                ? { opacity: frame * seq.sampleMs >= seq.arrivalMs ? 1 : 0 }
                : {}),
            })),
            timing,
          );
        }

        // Text changes at contact, while the recoil travels backward.
        pull.movers.forEach((m, index) => {
          const previous = drawings.current.get(
            m.card === anchor ? confirmedHash! : m.card.dataset.queueKey!,
          );
          if (previous)
            textOverlays.push(...morphText(m.card, previous, index, seq.arrivalMs, animate));
        });

        // Phone arrows follow their cards. Desktop chains are drawn below from
        // the real endpoints, including the departing block: scaling the new
        // layout's link would join confirmed to the second block before the
        // first had left.
        for (const link of links) {
          const [left, right] = link.dataset.queueBetween!.split(" ");
          const l = at(left);
          const r = at(right);
          animate(
            link,
            l.map((o, t) => ({
              transform: `translate(${(o.x + r[t]!.x) / 2}px, ${(o.y + r[t]!.y) / 2}px)`,
            })),
            timing,
          );
        }

        const exitLayer = exitLayerOver(el, pull.viewport, origin);
        // The outgoing confirmed card leads the pull out of the view.
        const departing = new Map<string, HTMLElement>();
        if (anchorDrawing.current) {
          const old = ghostOf(
            anchorDrawing.current,
            before.get("confirmed") ?? pull.target,
            pull.viewport,
            exitLayer,
          );
          old.setAttribute("data-queue-outgoing", "");
          departing.set("confirmed", old);
          animate(
            old,
            seq.lead.map((distance) => ({ transform: toward(distance) })),
            timing,
          );
        }

        // The last merged block becomes the new confirmed card. Any earlier
        // merged blocks in a batched observation leave with the old front.
        let clock: Animation | null = null;
        absorbed.forEach((key) => {
          const drawing = drawings.current.get(key);
          const from = before.get(key);
          if (!drawing || !from) return;
          const ghost = ghostOf(drawing, from, pull.viewport, exitLayer);
          const incoming = key === confirmedHash;
          departing.set(key, ghost);
          const run = animate(
            ghost,
            seq.lead.map((d, frame) => ({
              transform: toward(incoming ? pull.distance - seq.movers[0]![frame]! : d),
              opacity: incoming && frame * seq.sampleMs >= seq.arrivalMs ? 0 : 1,
            })),
            { duration: seq.durationMs, easing: "linear", fill: "forwards" },
          );
          clock ??= run;
          if (run) run.onfinish = () => ghost.remove();
          else ghost.remove();
        });

        const desktop = links.some(
          (link) =>
            (link.querySelector("[data-queue-cable]")?.getBoundingClientRect().width ?? 0) > 0,
        );
        if (desktop && clock) {
          clearChains = drawChains({
            el,
            view: pull.view,
            links,
            before: connections.current,
            after: linksBetween(links, next),
            departing,
            live: new Map(cards.map((card) => [card.dataset.queueKey!, card])),
            clock,
            seq,
          });
        }

        const layerRun = animate(exitLayer, [{ opacity: 1 }, { opacity: 1 }], timing);
        if (layerRun) layerRun.onfinish = () => exitLayer.remove();
      }
    }

    first.current = false;
    rects.current = next;
    frame.current = {
      left: rootNow.left,
      top: rootNow.top,
      scroll: new Map(scrollers.map((s) => [s, { x: s.scrollLeft, y: s.scrollTop }])),
    };
    const snapshot = (card: HTMLElement) => {
      const drawing = card.cloneNode(true) as HTMLElement;
      drawing.querySelectorAll("[data-queue-text-reveal]").forEach((overlay) => overlay.remove());
      return drawing;
    };
    drawings.current = new Map(
      cards
        .filter((card) => kindOf(card) === "block" && next.has(card.dataset.queueKey!))
        .map((card) => [card.dataset.queueKey!, snapshot(card)]),
    );
    const anchorNow = cards.find((card) => kindOf(card) === "confirmed");
    anchorDrawing.current = anchorNow ? snapshot(anchorNow) : null;
    order.current = cards
      .filter((card) => kindOf(card) === "block")
      .map((card) => card.dataset.queueKey!);
    lastConfirmed.current = confirmedHash;
    connections.current = linksBetween(links, next);
    return () => {
      clearChains();
      textOverlays.forEach((overlay) => overlay.remove());
      animations.forEach((run) => run.cancel());
      el.querySelectorAll("[data-queue-ghost]").forEach((ghost) => ghost.remove());
      el.querySelectorAll("[data-queue-exit-layer]").forEach((layer) => layer.remove());
    };
  }, [root, version, confirmedHash]);
}

/** A small lift on the card just selected. */
function useWave(root: React.RefObject<HTMLElement | null>, selected: string | null) {
  useEffect(() => {
    if (!selected || reducedMotion()) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-queue-key="${selected}"]`);
    if (card)
      animateElement(card, [{ translate: "0 0" }, { translate: "0 -4px" }, { translate: "0 0" }], {
        duration: WAVE_MS,
        easing: "ease-in-out",
      });
  }, [root, selected]);
}

/** A shared clock for "Mature in 9m", read client-side only: the server and
 * the first client render both see null, so they agree. */
let minuteNow = 0;
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
const subscribeMinute = (listener: () => void) => {
  minuteNow = Date.now();
  minuteListeners.add(listener);
  minuteTimer ??= setInterval(() => {
    minuteNow = Date.now();
    minuteListeners.forEach((l) => l());
  }, 30_000);
  return () => {
    minuteListeners.delete(listener);
    if (minuteListeners.size === 0 && minuteTimer) {
      clearInterval(minuteTimer);
      minuteTimer = null;
    }
  };
};
const useMinute = (): number | null =>
  useSyncExternalStore(
    subscribeMinute,
    () => minuteNow,
    () => null,
  );

/** When a queued header's maturity period ends: its commit time plus the
 * deployment's block maturity. Unknown when either is. */
export const maturesAt = (block: QueueBlock, maturityMs: number | null): number | null =>
  block.blockTime === null || maturityMs === null
    ? null
    : new Date(block.blockTime).getTime() + maturityMs;

function Maturity({ at, now }: { at: number | null; now: number | null }) {
  if (at === null || now === null) return null;
  return (
    <span className="flex items-center gap-1 mg-caption text-text-3">
      <Icon name="clock" size={12} />
      {at <= now ? "Mature" : `Mature in ${formatDuration(at - now).split(" ")[0]}`}
    </span>
  );
}

function Hash({ hash, demo }: { hash: string; demo: boolean }) {
  return demo ? (
    <span className="font-mono text-sm text-text">
      <ShortId value={hash} head={6} tail={4} />
    </span>
  ) : (
    <BlockRef hash={hash} height={null} copy={false} head={6} tail={4} />
  );
}

/**
 * The link between two cards. On a wider screen it is a chain that hangs a
 * little between them; during a merge it is redrawn from the moving cards'
 * edges, and it never moves on its own. A phone, where the queue runs
 * downward, keeps a plain arrow.
 */
function Connector({ between, className }: { between: string; className?: string | undefined }) {
  return (
    <li
      aria-hidden
      data-queue-between={between}
      className={cn("flex shrink-0 items-center justify-center text-text-3 sm:w-8", className)}
    >
      {/* The icon sets its own display, so the wrapper is what hides it. */}
      <span className="sm:hidden">
        <Icon name="arrowRight" size={14} className="rotate-90" />
      </span>
      <svg
        data-queue-cable=""
        width="32"
        height="40"
        viewBox="0 -20 32 40"
        className="hidden overflow-visible sm:block"
      >
        <path
          d="M-8 0 Q16 28 40 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeDasharray="5 3"
        />
      </svg>
    </li>
  );
}

function SlotCard({
  slotKey,
  kind,
  caption,
  dashed = false,
  tone = "neutral",
  selected,
  onSelect,
  className,
  children,
}: {
  slotKey: string;
  kind: "confirmed" | "block" | "commit" | "removed";
  caption: string | null;
  dashed?: boolean;
  tone?: "neutral" | "danger";
  selected: boolean;
  onSelect: (key: string) => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <li
      data-queue-key={slotKey}
      data-queue-kind={kind}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-md border bg-surface-2 p-3 sm:w-44 sm:shrink-0",
        "transition-colors duration-150",
        dashed ? "border-dashed" : null,
        tone === "danger" ? "border-danger/50" : dashed ? "border-border-strong" : "border-border",
        selected ? "border-focus ring-2 ring-focus/40" : null,
        className,
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="relative mg-micro font-semibold uppercase tracking-wide text-text-2">
          <span data-queue-caption-text="">{caption ?? " "}</span>
        </span>
        <button
          type="button"
          aria-expanded={selected}
          aria-label={selected ? "Hide details" : "Show details"}
          onClick={() => onSelect(slotKey)}
          className="-m-1 rounded p-1 text-text-3 hover:bg-surface hover:text-text"
        >
          <Icon name="info" size={14} />
        </button>
      </span>
      {children}
    </li>
  );
}

function GapCard({
  slotKey,
  count,
  className,
}: {
  slotKey: string;
  count: number;
  className?: string | undefined;
}) {
  return (
    <li
      data-queue-key={slotKey}
      className={cn(
        "flex items-center justify-center rounded-md border border-dashed border-border px-3 py-2 mg-caption tabular-nums text-text-2 sm:shrink-0",
        className,
      )}
    >
      {count} more
    </li>
  );
}

function blockCounts(b: QueueBlock) {
  const parts = [`${b.transactions} ${countNoun(b.transactions, "transaction", "transactions")}`];
  if (b.deposits > 0) parts.push(`${b.deposits} ${countNoun(b.deposits, "deposit", "deposits")}`);
  if (b.withdrawals > 0)
    parts.push(`${b.withdrawals} ${countNoun(b.withdrawals, "withdrawal", "withdrawals")}`);
  if (b.forcedTransactions > 0) parts.push(`${b.forcedTransactions} forced`);
  return parts.join(" · ");
}

type Ctx = {
  data: StateQueueResponse;
  demo: boolean;
  now: number | null;
  selected: string | null;
  onSelect: (key: string) => void;
};

function Slot({ slot, ctx, className }: { slot: QueueSlot; ctx: Ctx; className?: string }) {
  const card = { selected: ctx.selected === slot.key, onSelect: ctx.onSelect, className };
  switch (slot.kind) {
    case "confirmed":
      return (
        <SlotCard slotKey={slot.key} kind="confirmed" caption="Confirmed state" {...card}>
          <div className="font-medium">
            <Hash hash={slot.headerHash} demo={ctx.demo} />
          </div>
          <div data-queue-field="status">
            <ToneBadge tone={statusOf("merged").tone} label={statusOf("merged").label} />
          </div>
          <div
            data-queue-field="details"
            className="mt-auto flex flex-col gap-1 border-t border-border pt-2 mg-caption text-text-3"
          >
            <span data-queue-copy="counts" className="min-h-[1.25em] mg-caption text-text-2" />
            <span className="flex flex-wrap items-center justify-between gap-1">
              <span data-queue-copy="time-label">Recorded</span>
              <span data-queue-copy="time">
                <Timestamp iso={slot.updatedAt} />
              </span>
            </span>
          </div>
        </SlotCard>
      );
    case "block":
      return (
        <SlotCard
          slotKey={slot.key}
          kind="block"
          caption={
            slot.role === "oldest" ? "Next to merge" : slot.role === "newest" ? "Newest" : null
          }
          {...card}
        >
          <div className="font-medium">
            <Hash hash={slot.block.headerHash} demo={ctx.demo} />
          </div>
          <span data-queue-field="status">
            <ToneBadge tone="warning" label="Waiting to merge" />
          </span>
          <div
            data-queue-field="details"
            className="mt-auto flex flex-col gap-1 border-t border-border pt-2"
          >
            <span data-queue-copy="counts" className="mg-caption tabular-nums text-text-2">
              {blockCounts(slot.block)}
            </span>
            <Maturity at={maturesAt(slot.block, ctx.data.maturityMs)} now={ctx.now} />
            <span className="flex flex-wrap items-center justify-between gap-1 mg-caption text-text-3">
              <span data-queue-copy="time-label">Processed</span>
              <span data-queue-copy="time">
                <Timestamp iso={slot.block.processedAt} />
              </span>
            </span>
            {slot.block.origin === "foreign" ? (
              <span>
                <Chip on="surface">Other operator</Chip>
              </span>
            ) : null}
          </div>
        </SlotCard>
      );
    case "gap":
      return <GapCard slotKey={slot.key} count={slot.count} className={className} />;
    case "commit":
      return (
        <SlotCard slotKey={slot.key} kind="commit" caption="On its way" dashed {...card}>
          <div className="font-medium">
            <Hash hash={slot.commit.headerHash} demo={ctx.demo} />
          </div>
          <div data-queue-field="status">
            <StatusBadge status={slot.commit.status} explain={!ctx.demo} />
          </div>
          <div
            data-queue-field="details"
            className="mt-auto border-t border-border pt-2 mg-caption text-text-3"
          >
            <span className="flex flex-wrap items-center justify-between gap-1">
              <span data-queue-copy="time-label">Commit time</span>
              <span data-queue-copy="time">
                <Timestamp iso={slot.commit.blockTime} />
              </span>
            </span>
          </div>
        </SlotCard>
      );
  }
}

/** The drawn queue. A phone shows only the ends: the confirmed state, the
 * next header to merge, the newest, and the commit on its way, with every
 * header between them folded into one count. Wider screens show the window. */
function queueItems(ctx: Ctx): ReactNode[] {
  const q = ctx.data;
  const slots = queueSlots(q);
  const middle = slots.filter((s) => s.kind === "block" && s.role === null).length;
  const folded = (s: QueueSlot) =>
    (s.kind === "block" && s.role === null) || (s.kind === "gap" && middle > 0);
  const items: ReactNode[] = [];
  slots.forEach((slot, i) => {
    const hide = folded(slot) ? "max-sm:hidden" : undefined;
    if (i > 0)
      items.push(
        <Connector
          key={`${slot.key}-link`}
          between={`${slots[i - 1]!.key} ${slot.key}`}
          className={hide}
        />,
      );
    items.push(
      <Slot key={slot.key} slot={slot} ctx={ctx} {...(hide ? { className: hide } : {})} />,
    );
    if (middle > 0 && slot.kind === "block" && slot.role === "oldest") {
      items.push(
        <Connector key="phone-gap-link" between={`${slot.key} phone-gap`} className="sm:hidden" />,
      );
      items.push(
        <GapCard
          key="phone-gap"
          slotKey="phone-gap"
          count={q.hidden + middle}
          className="sm:hidden"
        />,
      );
    }
  });
  return items;
}

const fullHash = (hash: string, demo: boolean) =>
  demo ? (
    <span className="break-all font-mono text-sm">{hash}</span>
  ) : (
    <Identifier value={hash} full />
  );

/** What a reader can learn about one card, on request. */
function Details({ ctx, slotKey }: { ctx: Ctx; slotKey: string }) {
  const q = ctx.data;
  const block =
    [...q.oldest, ...q.newest].find((b) => b.headerHash === slotKey) ??
    q.removedBlocks.find((b) => b.headerHash === slotKey) ??
    null;
  const removed = q.removedBlocks.some((b) => b.headerHash === slotKey);
  const source = ctx.demo ? (
    "Example"
  ) : (
    <>
      Midgard node database · <Timestamp iso={q.observedAt} />
    </>
  );
  const rows: ReactNode[] = [];
  if (slotKey === "confirmed" && q.confirmed) {
    rows.push(
      <FactRow key="h" label="Header hash">
        {fullHash(q.confirmed.headerHash, ctx.demo)}
      </FactRow>,
      <FactRow key="s" label="State">
        Confirmed state
      </FactRow>,
      <FactRow key="t" label="Merged">
        <Timestamp iso={q.confirmed.updatedAt} exact />
      </FactRow>,
    );
  } else if (q.committing?.headerHash === slotKey) {
    rows.push(
      <FactRow key="h" label="Header hash">
        {fullHash(slotKey, ctx.demo)}
      </FactRow>,
      <FactRow key="s" label="State">
        <StatusBadge status={q.committing.status} explain={!ctx.demo} />
      </FactRow>,
      <FactRow key="t" label="Committed">
        <Timestamp iso={q.committing.blockTime} exact />
      </FactRow>,
    );
  } else if (block) {
    const at = maturesAt(block, q.maturityMs);
    rows.push(
      <FactRow key="h" label="Header hash">
        {fullHash(block.headerHash, ctx.demo)}
      </FactRow>,
      <FactRow key="p" label="Builds on">
        {ctx.demo ? (
          <span className="font-mono text-sm">
            <ShortId value={block.parentHeaderHash} head={8} tail={6} />
          </span>
        ) : (
          <BlockRef hash={block.parentHeaderHash} height={null} />
        )}
      </FactRow>,
      <FactRow key="s" label="State">
        {removed ? (
          <ToneBadge tone="danger" label="Removed" />
        ) : (
          <ToneBadge tone="warning" label="Waiting to merge" />
        )}
      </FactRow>,
      <FactRow key="o" label="Made by">
        {block.origin === "own" ? "This node" : "Another operator"}
      </FactRow>,
      <FactRow key="c" label="Committed">
        {block.blockTime ? <Timestamp iso={block.blockTime} exact /> : "Unavailable"}
      </FactRow>,
      <FactRow key="l" label="Commit on Cardano">
        {block.commitTxHash && !ctx.demo ? (
          <L1TxLink hash={block.commitTxHash} destination="cardano" />
        ) : (
          "Unavailable"
        )}
      </FactRow>,
      <FactRow key="m" label="Matures">
        {at === null ? (
          "Unknown"
        ) : ctx.now !== null && at > ctx.now ? (
          // A relative timestamp reads only the past, so a time still to come
          // is said as a wait, with the instant beside it.
          `In ${formatDuration(at - ctx.now).split(" ")[0]} · ${formatTimestamp(new Date(at).toISOString())}`
        ) : (
          <Timestamp iso={new Date(at).toISOString()} exact />
        )}
      </FactRow>,
      <FactRow key="d" label="Data availability">
        Unavailable
      </FactRow>,
    );
  } else {
    return null;
  }
  rows.push(
    <FactRow key="src" label="Source">
      {source}
    </FactRow>,
  );
  return (
    <section aria-label="Block details" className="mt-3 rounded-md border border-border px-3">
      <dl className="divide-y divide-border">{rows}</dl>
    </section>
  );
}

/**
 * The queue as a row of cards in linked order, the removed headers in a lane
 * of their own, and the details of whichever card is selected. Used by the
 * live queue and by the example, which passes `demo` so nothing links out.
 */
export function QueueTrack({
  data,
  demo = false,
  label,
}: {
  data: StateQueueResponse;
  demo?: boolean;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const now = useMinute();
  useQueueMotion(root, data, data.confirmed?.headerHash ?? null);
  useWave(root, selected);

  // A selection outlives a poll, keyed by header hash, and clears only when
  // that header is no longer drawn at all.
  const drawn = new Set([
    ...queueSlots(data).map((s) => s.key),
    ...data.removedBlocks.map((b) => b.headerHash),
  ]);
  const shown = selected !== null && drawn.has(selected) ? selected : null;
  const ctx: Ctx = {
    data,
    demo,
    now,
    selected: shown,
    onSelect: (key) => setSelected((current) => (current === key ? null : key)),
  };

  return (
    <div ref={root} className="relative">
      <div data-queue-scroller="track" className="relative overflow-x-auto">
        <ol
          aria-label={label}
          data-queue-track=""
          className="flex flex-col gap-2 py-1 sm:flex-row sm:items-stretch"
        >
          {queueItems(ctx)}
        </ol>
      </div>
      {data.removedBlocks.length > 0 ? (
        <div data-queue-scroller="removed" className="relative mt-3 overflow-x-auto">
          <p className="mb-1.5 mg-micro uppercase tracking-wide text-text-3">
            Removed{data.removed > data.removedBlocks.length ? ` · ${data.removed} in all` : ""}
          </p>
          <ol aria-label="Removed from the queue" className="flex flex-col gap-2 sm:flex-row">
            {data.removedBlocks.map((b) => (
              <SlotCard
                key={b.headerHash}
                slotKey={b.headerHash}
                kind="removed"
                caption={null}
                dashed
                tone="danger"
                selected={shown === b.headerHash}
                onSelect={ctx.onSelect}
              >
                <Hash hash={b.headerHash} demo={demo} />
                <ToneBadge tone="danger" label="Removed" />
                <span className="mg-caption text-text-3">
                  <Timestamp iso={b.processedAt} />
                </span>
              </SlotCard>
            ))}
          </ol>
        </div>
      ) : null}
      {shown ? <Details ctx={ctx} slotKey={shown} /> : null}
    </div>
  );
}
