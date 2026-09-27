import { useEffect, useRef } from "react";
import { sendCrashReport } from "./crashReporter";

const PROBE_MS = 20000;
const TICK_MS = 100;

// Focus changes anywhere in the app during a probe window (Focusable bumps it) - tells a page that
// is slow on its own apart from one that's only slow while keys are being pressed.
export const perfCounters = { focusEvents: 0 };

type HermesStats = { js_heapSize?: number; js_allocatedBytes?: number; js_numGCs?: number; js_gcTime?: number };
function hermesStats(): HermesStats {
  try {
    return ((globalThis as any).HermesInternal?.getInstrumentedStats?.() ?? {}) as HermesStats;
  } catch {
    return {};
  }
}

// A diagnostic, not a feature: details pages are reported as heavy to move around on the TV, and no
// device is reachable for profiling. For the first PROBE_MS on a page this records how late a 100ms
// timer fires (how busy the JS thread is) second by second, the page's own renders, focus changes,
// and the JS engine's garbage-collection count/time and heap size - then sends one line through the
// crash-report channel.
export function usePerfProbe(label: string, pageKey: string, extra: () => string): void {
  const renders = useRef(0);
  renders.current += 1;
  const extraRef = useRef(extra);
  extraRef.current = extra;

  useEffect(() => {
    renders.current = 0;
    perfCounters.focusEvents = 0;
    const startStats = hermesStats();
    const started = Date.now();
    let last = started;
    let ticks = 0;
    let lagTotal = 0;
    let lagMax = 0;
    const lagBySecond: number[] = [];
    const interval = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - last - TICK_MS);
      last = now;
      ticks += 1;
      lagTotal += lag;
      lagMax = Math.max(lagMax, lag);
      const second = Math.floor((now - started) / 1000);
      lagBySecond[second] = (lagBySecond[second] ?? 0) + lag;
    }, TICK_MS);
    const done = setTimeout(() => {
      clearInterval(interval);
      const end = hermesStats();
      const mb = (b?: number) => (b == null ? "?" : (b / 1048576).toFixed(0));
      sendCrashReport({
        kind: "perf_probe",
        message: label,
        detail:
          `renders=${renders.current} focus=${perfCounters.focusEvents} ticks=${ticks}/${PROBE_MS / TICK_MS} ` +
          `avgLag=${Math.round(lagTotal / Math.max(1, ticks))}ms maxLag=${lagMax}ms ` +
          `lagPerSec=[${Array.from(lagBySecond, (v) => Math.round((v ?? 0) / 10) * 10).join(",")}] ` +
          `gc=${(end.js_numGCs ?? 0) - (startStats.js_numGCs ?? 0)} gcMs=${Math.round((end.js_gcTime ?? 0) - (startStats.js_gcTime ?? 0))} ` +
          `heapMB=${mb(end.js_heapSize)} allocMB=${mb((end.js_allocatedBytes ?? 0) - (startStats.js_allocatedBytes ?? 0))} ` +
          extraRef.current(),
      });
    }, PROBE_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(done);
    };
  }, [label, pageKey]);
}
