// Detects whether text should render right-to-left, based on the *content itself* (the first
// strong-directional character in it) rather than the app's own current UI language - a subtitle
// track's language doesn't always match the app's own lang setting (an Arabic-UI viewer can watch
// an English-subtitled title, and vice versa), so this has to be checked per cue, not assumed.
const RTL_CHAR_RANGE = /[֑-߿‏יִ-﷽ﹰ-ﻼ]/;

export function isRtlText(text: string): boolean {
  return RTL_CHAR_RANGE.test(text);
}
