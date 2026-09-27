import { useEffect, useRef } from "react";
import { sendCrashReport } from "./crashReporter";

const PROBE_MS = 20000;
const TICK_MS = 100;

// A diagnostic, not a feature: some details pages (films with parts, one series) are reported as
// heavy to move around on the TV while others are fine, and no device is reachable for profiling.
// For the first PROBE_MS on a page this counts the page's own renders and how late a 100ms timer
// fires (how busy the JS thread is), then sends one line through the crash-report channel - so the
// slow pages can be compared with the fast ones from real numbers.
export function usePerfProbe(label: string, pageKey: string, extra: () => string): void {
  const renders = useRef(0);
  renders.current += 1;
  const extraRef = useRef(extra);
  extraRef.current = extra;

  useEffect(() => {
    renders.current = 0;
    let last = Date.now();
    let ticks = 0;
    let lagTotal = 0;
    let lagMax = 0;
    let slowTicks = 0;
    const interval = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - last - TICK_MS);
      last = now;
      ticks += 1;
      lagTotal += lag;
      lagMax = Math.max(lagMax, lag);
      if (lag > 50) slowTicks += 1;
    }, TICK_MS);
    const done = setTimeout(() => {
      clearInterval(interval);
      sendCrashReport({
        kind: "perf_probe",
        message: label,
        detail:
          `renders=${renders.current}/${PROBE_MS / 1000}s avgLag=${Math.round(lagTotal / Math.max(1, ticks))}ms ` +
          `maxLag=${lagMax}ms slowTicks=${slowTicks}/${ticks} ${extraRef.current()}`,
      });
    }, PROBE_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(done);
    };
  }, [label, pageKey]);
}
