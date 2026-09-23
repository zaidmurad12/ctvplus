export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function timeToSeconds(t: string): number {
  // Accepts both HH:MM:SS.mmm and MM:SS.mmm
  const parts = t.trim().split(":");
  let seconds = 0;
  for (const p of parts) {
    seconds = seconds * 60 + parseFloat(p.replace(",", "."));
  }
  return seconds;
}

// Minimal WebVTT (and SRT, which the same cue-block shape covers) cue parser - just enough
// to drive "what text is on screen at time X", not full VTT feature support (no styling
// cues, no regions).
export function parseVtt(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const timeLineIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIndex].split("-->").map((s) => s.trim().split(" ")[0]);
    const start = timeToSeconds(startRaw);
    const end = timeToSeconds(endRaw);
    const text = lines
      .slice(timeLineIndex + 1)
      .join("\n")
      // <...> is real WebVTT/SRT markup (<b>, <i>, ...) - {...} is a leftover ASS/SSA style
      // override block (font/color/position codes like {\fnArabic Typesetting\c&H000000&}) that
      // some "SRT" files still carry from an ASS source conversion. This app has no renderer for
      // either's actual styling (font/color/position all come from subtitleSettings instead), so
      // both are just noise to strip - left in, the ASS block rendered as literal on-screen text
      // instead of disappearing the way <...> tags already did.
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]*\}/g, "")
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

// Was a linear .find() over the WHOLE array from the start every single call - fine for a few
// cues, but a real 2-hour movie's subtitle file commonly has 1500-2000+ lines, and the video
// player calls this 4x/second for the entire duration of playback (see VideoPlayer.tsx's
// progressUpdateInterval). That's thousands of full-array scans a minute, growing longer as
// currentTime moves later into the file - genuine, continuous main-thread CPU cost on every
// single playback session, independent of network or resolution, and a real contributor to
// "playback feels laggy/stutters" reports on weaker TV hardware. Cues are already in chronological
// (start-time-ascending) order from parseVtt, so a binary search for the last cue whose start is
// at or before currentTime turns this into O(log n) - ~11 comparisons instead of up to ~2000 for a
// typical file - and it's naturally correct across seeks in either direction too, no cursor/state
// to keep in sync.
export function activeCueText(cues: SubtitleCue[], currentTime: number): string | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= currentTime) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return null;
  const cue = cues[candidate];
  return currentTime <= cue.end ? cue.text : null;
}
