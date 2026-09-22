import type { StreamServer } from "./api";
import { qualityRank } from "./quality";

// Reported as "always plays whatever server happens to be first," which was sometimes the
// slowest and sometimes outright dead (the movie just never loaded, no explanation) - this picks
// a real order to actually try servers in: highest quality first, but only among the ones a quick
// reachability probe confirms are actually up. An unreachable 1080p server no longer wins over a
// working 720p one just because of list order.

const PROBE_TIMEOUT_MS = 4000;

/** A cheap reachability + rough-latency check - a 2-byte ranged GET, not a real download. */
async function probeServer(server: StreamServer): Promise<{ server: StreamServer; latencyMs: number } | null> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(server.url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return { server, latencyMs: Date.now() - startedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
