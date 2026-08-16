const parseSubtitlesText = (text) => {
  const cues = [];
  const cleanText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = cleanText.split(/\n\n+/);
  
  const parseTime = (str) => {
    const cleanStr = str.trim().split(/\s+/)[0]; // Discard trailing WebVTT styles (e.g., align:middle)
    const m = cleanStr.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
    if (m) {
      const h = m[1] ? parseInt(m[1], 10) : 0;
      const min = parseInt(m[2], 10);
      const sec = parseInt(m[3], 10);
      const msStr = m[4];
      const ms = parseInt(msStr, 10) / Math.pow(10, msStr.length);
      return h * 3600 + min * 60 + sec + ms;
    }
    const mShort = cleanStr.match(/(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
    if (mShort) {
      const min = parseInt(mShort[1], 10);
      const sec = parseInt(mShort[2], 10);
      const msStr = mShort[3];
      const ms = parseInt(msStr, 10) / Math.pow(10, msStr.length);
      return min * 60 + sec + ms;
    }
    return null;
  };

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIndex = i;
        break;
      }
    }
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const textLines = lines.slice(timeLineIndex + 1);
    const textVal = textLines.join("\n").replace(/<[^>]*>/g, "").trim();

    const parts = timeLine.split(/\s*-->\s*/);
    if (parts.length === 2) {
      const startSec = parseTime(parts[0]);
      const endSec = parseTime(parts[1]);
      if (startSec !== null && endSec !== null) {
        cues.push({ start: startSec, end: endSec, text: textVal });
      }
    }
  }
  return cues;
};

const vttSample = `WEBVTT

1
00:00:05.000 --> 00:00:12.000
تبدأ الآن أحداث القصة المليئة بالإثارة والتشويق

2
00:11:20.000 --> 00:11:27.000
تتعرف الشخصيات على بعضها وتظهر العقبات الأولى`;

console.log(parseSubtitlesText(vttSample));
