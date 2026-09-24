import { NativeModules } from "react-native";
import { API_BASE } from "./api";
import { CURRENT_VERSION_CODE, CURRENT_VERSION_NAME } from "./appVersion";

// Sends crash/exit reports to the backend (POST /app/crash-report, logged there under
// "AppCrashReport") so sudden exits on real TVs can be diagnosed from actual data - there's no
// other way to see what happened on a viewer's device. Three sources:
//  - Android's own record of why the app's process last ended (crash, native crash, low-memory
//    kill, ANR - Android 11+), plus the stack of the last Java-side crash (see CrashInfoModule.kt).
//  - Fatal JS errors, sent the moment they happen (best effort - the process is about to die).
//  - Render errors caught by ErrorBoundary.

const VERSION = `${CURRENT_VERSION_NAME} (${CURRENT_VERSION_CODE})`;
let deviceInfo = { device: "", android: "" };

interface Report {
  kind: string;
  message?: string;
  detail?: string;
}

export function sendCrashReport(report: Report): void {
  fetch(`${API_BASE}/app/crash-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...report, version: VERSION, ...deviceInfo }),
  }).catch(() => {});
}

async function reportPreviousExits(): Promise<void> {
  const { CrashInfo } = NativeModules;
  if (!CrashInfo?.collect) return;
  try {
    const info = await CrashInfo.collect();
    deviceInfo = { device: info.device ?? "", android: info.android ?? "" };
    if (info.javaCrash) sendCrashReport({ kind: "java_crash", message: String(info.javaCrash).split("\n")[1] ?? "", detail: info.javaCrash });
    for (const exit of info.exits ?? []) {
      sendCrashReport({
        kind: `exit_${exit.reason}`,
        message: `${exit.description || exit.reason} at ${new Date(exit.timestamp).toISOString()}`,
        detail: `pss=${Math.round(exit.pssKb / 1024)}MB rss=${Math.round(exit.rssKb / 1024)}MB importance=${exit.importance}${exit.trace ? `\n${exit.trace}` : ""}`,
      });
    }
  } catch {
    // Reporting must never be the thing that breaks the app.
  }
}

export function installCrashReporting(): void {
  const errorUtils = (globalThis as any).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error: any, isFatal?: boolean) => {
    if (isFatal) sendCrashReport({ kind: "js_fatal", message: String(error?.message ?? error), detail: String(error?.stack ?? "") });
    previous?.(error, isFatal);
  });
  // A few seconds in, past the app's own first loads - but short, so an app that keeps crashing
  // soon after launch still gets to report the previous crash.
  setTimeout(reportPreviousExits, 6000);
}
