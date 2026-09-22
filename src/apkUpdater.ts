import { NativeModules, NativeEventEmitter } from "react-native";

// See android/app/src/main/java/com/cinemanatvrn/ApkUpdaterModule.kt - downloads the update APK
// via Android's own DownloadManager and hands it straight to the system installer, replacing the
// "open a browser, wait, pull down the notification, tap it" round trip per explicit request.
const { ApkUpdater } = NativeModules;

export type ApkUpdaterEvent =
  | { type: "progress"; downloaded: number; total: number }
  | { type: "installPrompted" }
  | { type: "error"; message: string };

export function isApkUpdaterAvailable(): boolean {
  return !!ApkUpdater;
}

export function downloadAndInstallApk(url: string, fileName: string): Promise<void> {
  if (!ApkUpdater) return Promise.reject(new Error("ApkUpdater native module unavailable"));
  return ApkUpdater.downloadAndInstall(url, fileName);
}

// The native side only ever handles one in-flight download at a time (see the module's own
// comment) - a single subscription for the app's whole lifetime is enough, callers just filter
// events by whether they currently care.
export function subscribeApkUpdaterEvents(callback: (event: ApkUpdaterEvent) => void): () => void {
  if (!ApkUpdater) return () => undefined;
  const emitter = new NativeEventEmitter(ApkUpdater);
  const subscription = emitter.addListener("ApkUpdaterEvent", (event: Object) => callback(event as ApkUpdaterEvent));
  return () => subscription.remove();
}
