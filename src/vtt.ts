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

export function activeCueText(cues: SubtitleCue[], currentTime: number): string | null {
  const cue = cues.find((c) => currentTime >= c.start && currentTime <= c.end);
  return cue ? cue.text : null;
}
