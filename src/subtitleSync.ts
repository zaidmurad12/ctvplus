// A real detected correction at one specific point in the video's own timeline (video-time ms ->
// how many ms the subtitle needs to be delayed there) - see the backend's own comment on
// Subtitle.syncAnchors in schema.prisma for the full reasoning on why several of these, not one
// global offset+speed, is what this app now applies by default.
export interface SyncAnchor {
  tMs: number;
  offsetMs: number;
}

// Piecewise-linear: the correction at any given moment is interpolated between whichever two
// anchors bracket it, not one constant value for the whole file - this is what lets a subtitle
// authored for a *different cut* of the video (a jump in the real correction at one specific
// point, not a smooth drift) come out right on both sides of that jump instead of only ever
// matching near wherever the (old, single) analysis happened to sample.
export function interpolateOffsetMs(anchors: SyncAnchor[], videoTimeMs: number): number {
  if (anchors.length === 0) return 0;
  if (anchors.length === 1 || videoTimeMs <= anchors[0].tMs) return anchors[0].offsetMs;
  const last = anchors[anchors.length - 1];
  if (videoTimeMs >= last.tMs) return last.offsetMs;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (videoTimeMs >= a.tMs && videoTimeMs <= b.tMs) {
      const frac = (videoTimeMs - a.tMs) / (b.tMs - a.tMs);
      return a.offsetMs + frac * (b.offsetMs - a.offsetMs);
    }
  }
  return last.offsetMs;
}

// The single lookup every subtitle-cue consumer in VideoPlayer.tsx goes through: prefers the
// server's multi-point anchors (see interpolateOffsetMs above) whenever any exist, falling back
// to the old constant offset+speed formula otherwise - either a title whose analysis hasn't run
// under the new pipeline yet, or a viewer's own manually-saved override (see VideoPlayer.tsx's own
// comment on why a manual correction always clears activeSyncAnchors first).
export function correctedSubtitleTime(
  videoTimeSec: number,
  anchors: SyncAnchor[] | null,
  offsetMs: number,
  speed: number
): number {
  if (anchors && anchors.length > 0) {
    return videoTimeSec - interpolateOffsetMs(anchors, videoTimeSec * 1000) / 1000;
  }
  return (videoTimeSec - offsetMs / 1000) / speed;
}
