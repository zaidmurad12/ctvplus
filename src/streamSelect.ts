import type { StreamServer } from "./api";
import { qualityRank } from "./quality";

// Reported as "always plays whatever server happens to be first," which was sometimes the
// slowest and sometimes outright dead (the movie just never loaded, no explanation) - this picks
// a real order to actually try servers in: highest quality first, but only among the ones a quick
// reachability probe confirms are actually up. An unreachable 1080p server no longer wins over a
// working 720p one just because of list order.

// A link that hasn't answered with its headers in 2s isn't dropped - it just goes after the ones
// that did (see pickBestServers) - so this only bounds how long the start of playback waits.
const PROBE_TIMEOUT_MS = 2000;

/**
 * A cheap reachability + rough-latency check: asks for 2 bytes and gives up the moment the server
 * answers with its status line and headers - it never reads a body.
 *
 * This used to be a plain fetch(), which in React Native doesn't resolve until the *whole* response
 * body has arrived - and plenty of video hosts ignore the Range header and answer 200 with the entire
 * file. So every probe was really downloading the movie itself (one per quality, 4K included, all at
 * once) until the timeout cut it off: playback couldn't start before that, and those downloads then
 * competed with the real stream for bandwidth and memory - reported as slow starts, stutter right
 * after starting, and sudden exits.
 */
function probeServer(server: StreamServer): Promise<{ server: StreamServer; latencyMs: number } | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (result: { server: StreamServer; latencyMs: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        xhr.abort();
      } catch {
        // Already finished/aborted - nothing to cancel.
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    xhr.onreadystatechange = () => {
      // HEADERS_RECEIVED (2) or later: the status is known - stop before any body is read.
      if (xhr.readyState < 2) return;
      const ok = xhr.status >= 200 && xhr.status < 400;
      finish(ok ? { server, latencyMs: Date.now() - startedAt } : null);
    };
    xhr.onerror = () => finish(null);
    try {
      xhr.open("GET", server.url);
      xhr.setRequestHeader("Range", "bytes=0-1");
      xhr.send();
    } catch {
      finish(null);
    }
  });
}

/**
 * Returns servers ordered for actual playback attempts: reachable ones first (highest quality
 * among those that responded), then every unreachable one after (kept, not dropped - the player
 * still tries them in order if every "confirmed working" one somehow fails during real playback,
 * see VideoPlayer's own onError fallback). Never returns an empty array if `servers` wasn't
 * empty - a probe failure narrows the *order*, it never removes the viewer's only option.
 */
export async function pickBestServers(servers: StreamServer[]): Promise<StreamServer[]> {
  if (servers.length <= 1) return servers;

  const results = await Promise.all(servers.map(probeServer));
  const reachable = results
    .filter((r): r is { server: StreamServer; latencyMs: number } => r !== null)
    .sort((a, b) => qualityRank(b.server.quality) - qualityRank(a.server.quality))
    .map((r) => r.server);

  const reachableUrls = new Set(reachable.map((s) => s.url));
  const unreachable = servers.filter((s) => !reachableUrls.has(s.url));

  return [...reachable, ...unreachable];
}
