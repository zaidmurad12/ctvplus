import { useEffect, useState } from "react";

// A long horizontal row (Home's rails, a season's full episode list, cast/parts rows) used to
// mount every one of its poster/thumbnail Images at once - for Home specifically, a dozen-plus
// rails each up to 20 cards fires that many concurrent network+decode requests in a single burst
// the moment the screen appears. That's what read as "images/posters loading slowly": the first
// screenful competes with everything scrolled off to the right (or below), so even it trickles in
// over several seconds on a weaker Android TV box/network instead of appearing quickly. Revealing
// items in a few small batches a beat apart spreads that burst out - it changes nothing about
// layout, focus routing, or anything else that keeps rendering regardless of this count, only how
// soon each item's own Image actually starts fetching.
export function useProgressiveReveal(total: number, batchSize = 6, stepMs = 90): number {
  const [visible, setVisible] = useState(() => Math.min(total, batchSize));

  useEffect(() => {
    setVisible(Math.min(total, batchSize));
    if (total <= batchSize) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let shown = batchSize * 2; shown < total + batchSize; shown += batchSize) {
      const step = Math.min(shown, total);
      const delay = stepMs * (shown / batchSize - 1);
      timers.push(setTimeout(() => setVisible(step), delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [total, batchSize, stepMs]);

  return visible;
}
