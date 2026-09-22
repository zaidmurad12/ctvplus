// Some admin-uploaded .srt files turn out to be saved in Windows-1256 (the classic single-byte
// Arabic Windows codepage many older subtitle tools default to), not UTF-8 - reading those bytes
// as UTF-8 (what a plain `fetch(...).then(r => r.text())` always does, with no way to tell it
// otherwise) doesn't error, it just silently produces garbage: each non-ASCII UTF-8 continuation
// byte gets reinterpreted as its own separate, unrelated Windows-1256 character. Reported as
// "unclear symbols/marks" in some subtitles - this is what actually decodes those files correctly
// instead of guessing wrong every time.
//
// Bytes 0x00-0x7F are identical to ASCII in both encodings, so only the upper half needs its own
// table - this is the standard, published Windows-1256 codepage mapping (a technical
// interoperability standard, the same kind of public mapping table every text-processing library
// ships), not anything specific to this app.
const CP1256_HIGH: readonly string[] = [
  "€", "پ", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "ٹ", "‹", "Œ", "چ", "ژ", "ڈ",
  "گ", "‘", "’", "“", "”", "•", "–", "—",
  "ک", "™", "ڑ", "›", "œ", "‌", "‍", "ں",
  " ", "،", "¢", "£", "¤", "¥", "¦", "§",
  "¨", "©", "ھ", "«", "¬", "­", "®", "¯",
  "°", "±", "²", "³", "´", "µ", "¶", "·",
  "¸", "¹", "؛", "»", "¼", "½", "¾", "؟",
  "ہ", "ء", "آ", "أ", "ؤ", "إ", "ئ", "ا",
  "ب", "ة", "ت", "ث", "ج", "ح", "خ", "د",
  "ذ", "ر", "ز", "س", "ش", "ص", "ض", "×",
  "ط", "ظ", "ع", "غ", "ـ", "ف", "ق", "ك",
  "à", "ل", "â", "م", "ن", "ه", "و", "ç",
  "è", "é", "ê", "ë", "ى", "ي", "î", "ï",
  "ً", "ٌ", "ٍ", "َ", "ô", "ُ", "ِ", "÷",
  "ّ", "ù", "ْ", "û", "ü", "‎", "‏", "ے",
];

function decodeCp1256(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : CP1256_HIGH[b - 0x80];
  }
  return out;
}

// A strict manual UTF-8 decoder (not the lenient built-in TextDecoder, which silently substitutes
// U+FFFD for anything invalid instead of reporting it) - returning null on the first invalid byte
// sequence is exactly the signal decodeSubtitleBytes below needs to know this file wasn't real
// UTF-8 at all, rather than rendering a subtitle full of replacement-character boxes.
function decodeUtf8Strict(bytes: Uint8Array): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    let extra: number;
    let codePoint: number;
    if ((b0 & 0xe0) === 0xc0) {
      extra = 1;
      codePoint = b0 & 0x1f;
    } else if ((b0 & 0xf0) === 0xe0) {
      extra = 2;
      codePoint = b0 & 0x0f;
    } else if ((b0 & 0xf8) === 0xf0) {
      extra = 3;
      codePoint = b0 & 0x07;
    } else {
      return null;
    }
    if (i + extra >= bytes.length) return null;
    for (let k = 1; k <= extra; k++) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) return null;
      codePoint = (codePoint << 6) | (b & 0x3f);
    }
    if (codePoint > 0xffff) {
      // Surrogate pair - JS strings are UTF-16 internally.
      codePoint -= 0x10000;
      out += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    } else {
      out += String.fromCharCode(codePoint);
    }
    i += extra + 1;
  }
  return out;
}

// Tried in this order: real UTF-8 first (the overwhelming majority of subtitle files already are,
// and this is the only branch that can ever actually run for them), Windows-1256 only as the
// fallback once strict UTF-8 decoding has already proven the bytes aren't valid UTF-8 at all.
export function decodeSubtitleBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return decodeUtf8Strict(bytes) ?? decodeCp1256(bytes);
}
