import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Globe, Delete } from "lucide-react-native";
import Focusable from "./Focusable";
import { font } from "../theme";
import { s, fs } from "../scale";

// Nine keys per row, every row full (no short last row), with the digits on top. Letters are in plain
// alphabetical order - the quickest layout for a remote control, where you scan by knowing the alphabet
// rather than by remembering where a typist's keys sit. Arabic reads right-to-left, so each Arabic row is
// mirrored: ا sits at the right edge and the run continues leftwards. English runs left to right, and its
// last row's ninth key is the "TH" digraph.
//
// Arabic uses all 36 keys of the 4x9 grid: the 28 letters, ى ة ء, and the hamza forms أ إ آ ؤ ئ. Plain ا
// leads the first row (it is the most common letter and is what "ال" needs); "لا" has no key of its own
// since it is just ل then ا.
const COLUMNS = 9;
// Dark gray rule between cells and around the whole keyboard.
const GRID_COLOR = "#2a2a2a";
const AR_LOGICAL_ROWS: string[][] = [
  ["ا", "أ", "ب", "ت", "ث", "ج", "ح", "خ", "د"],
  ["ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ"],
  ["ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه"],
  ["و", "ي", "ة", "ى", "ء", "إ", "آ", "ؤ", "ئ"],
];
const AR_ROWS: string[][] = AR_LOGICAL_ROWS.map((row) => [...row].reverse());
const EN_ROWS: string[][] = [
  Array.from("ABCDEFGHI"),
  Array.from("JKLMNOPQR"),
  [...Array.from("STUVWXYZ"), "TH"],
];
// Latin letters and digits sit visibly smaller than Arabic glyphs at the same font size, so they get a
// larger one to fill the key.
const LATIN_LETTER = /^[a-z]$/i;
const DIGIT = /^[0-9]$/;
const ARABIC_LETTER = /[؀-ۿ]/;
const NUMBER_ROW = Array.from("1234567890");
const SYMBOL_ROWS: string[][] = (() => {
  const chars = Array.from(".,-_@'!?/():;\"");
  const rows: string[][] = [];
  for (let i = 0; i < chars.length; i += COLUMNS) rows.push(chars.slice(i, i + COLUMNS));
  return rows;
})();

interface Props {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onSpace: () => void;
}

// Three separate bordered grids with a gap between them - digits on top, letters in the middle, the
// control row (symbols / language / space / delete) at the bottom. Only the keyboard's OUTER corners
// are rounded (the top corners of the digit grid at 1 and 0, the bottom corners of the control grid);
// the letter grid stays square.
const BLOCK_GAP = s(12);
const OUTER_RADIUS = s(12);

// The system's own on-screen keyboard is what a focused TextInput would normally bring up -
// built as a real in-app D-pad-navigable keyboard instead so both Arabic and English are
// always available from the remote regardless of which one the OS keyboard defaults to, and
// regardless of the app's own current UI language (the toggle here is independent of it).
export default function VirtualKeyboard({ onKey, onBackspace, onSpace }: Props) {
  const [kbLang, setKbLang] = useState<"ar" | "en">("ar");
  const [showSymbols, setShowSymbols] = useState(false);
  const rows = showSymbols ? SYMBOL_ROWS : kbLang === "ar" ? AR_ROWS : EN_ROWS;
  const rtl = !showSymbols && kbLang === "ar";
  const preferredKey = showSymbols ? "." : kbLang === "ar" ? "ا" : "A";
  // The English keys are drawn in capitals but typed as lowercase (search is case-insensitive).
  const typeKey = (ch: string) => onKey(/^[A-Z]+$/.test(ch) ? ch.toLowerCase() : ch);

  return (
    <View style={styles.panel}>
      <View style={[styles.block, styles.blockTop]}>
        <Row keys={NUMBER_ROW} onKey={typeKey} lastRow />
      </View>

      <View style={styles.block}>
        {rows.map((row, ri) => (
          <Row
            key={`${showSymbols}-${kbLang}-${ri}`}
            keys={row}
            onKey={typeKey}
            rtl={rtl}
            lastRow={ri === rows.length - 1}
            preferredKey={ri === 0 ? preferredKey : undefined}
          />
        ))}
      </View>

      <View style={[styles.block, styles.blockBottom]}>
        <View style={styles.row}>
          <Key
            label={showSymbols ? (kbLang === "ar" ? "أب" : "ABC") : "#+="}
            flexGrow={1.5}
            tall
            lastRow
            large
            onPress={() => setShowSymbols((v) => !v)}
          />
          {!showSymbols && (
            <Key
              label=""
              icon={Globe}
              flexGrow={1.2}
              tall
              lastRow
              onPress={() => setKbLang((l) => (l === "ar" ? "en" : "ar"))}
            />
          )}
          <Key label={kbLang === "ar" ? "مسافة" : "space"} flexGrow={showSymbols ? 7.5 : 6.3} tall lastRow large onPress={onSpace} />
          <Key label="" icon={Delete} flexGrow={1.5} tall lastRow lastCol onPress={onBackspace} />
        </View>
      </View>
    </View>
  );
}

function Row({
  keys,
  onKey,
  preferredKey,
  rtl,
  lastRow,
}: {
  keys: string[];
  onKey: (ch: string) => void;
  preferredKey?: string;
  rtl?: boolean;
  lastRow?: boolean;
}) {
  // Empty cells keep a short row's keys the same width as a full row's; an Arabic row starts at the
  // right edge, so its filler goes on the left.
  const padCount = Math.max(0, COLUMNS - keys.length);
  const pads = Array.from({ length: padCount }, (_, i) => {
    // The right-most cell of the row carries no right rule (the block's own border is there).
    const isEdge = rtl ? false : i === padCount - 1;
    return <View key={`pad${i}`} style={[styles.padCell, isEdge && styles.noRight, lastRow && styles.noBottom]} />;
  });
  return (
    <View style={styles.row}>
      {rtl && pads}
      {keys.map((ch, i) => (
        <Key
          key={ch}
          label={ch}
          flexGrow={1}
          lastRow={lastRow}
          lastCol={!rtl ? padCount === 0 && i === keys.length - 1 : i === keys.length - 1}
          onPress={() => onKey(ch)}
          hasTVPreferredFocus={ch === preferredKey}
        />
      ))}
      {!rtl && pads}
    </View>
  );
}

function Key({
  label,
  onPress,
  flexGrow,
  icon: Icon,
  hasTVPreferredFocus,
  lastRow,
  lastCol,
  tall,
  large,
}: {
  label: string;
  onPress: () => void;
  flexGrow: number;
  icon?: typeof Globe;
  hasTVPreferredFocus?: boolean;
  lastRow?: boolean;
  lastCol?: boolean;
  tall?: boolean;
  large?: boolean;
}) {
  // Focusable's own `style` prop only ever reaches its *inner* Animated.View, not the
  // Pressable wrapping it (the same issue the video player's seek-bar touch targets ran into)
  // - flexGrow passed straight to it has no sized parent within `row` to actually grow into,
  // since the Pressable itself shrink-wraps to content and never adopts that flexGrow. A plain
  // flex-grow View here does the row-sharing; Focusable inside it just fills that space.
  return (
    <View style={{ flexGrow, flexBasis: 0 }}>
      <Focusable onPress={onPress} scaleTo={1} hasTVPreferredFocus={hasTVPreferredFocus} style={styles.keyTouch}>
        {(focused: boolean) => (
          // No focusShadowTight - keyFocused already turns this solid white, and a white glow
          // behind an already-white fill is redundant at best (rendered as a visible hatch
          // artifact on at least one real device).
          <View
            style={[
              styles.key,
              tall && styles.keyTall,
              lastCol && styles.noRight,
              lastRow && styles.noBottom,
              focused && styles.keyFocused,
            ]}
          >
            {Icon ? (
              <View style={styles.iconKey}>
                <Icon size={s(22)} strokeWidth={2} color={focused ? "#000" : "#fff"} />
                {!!label && <Text style={[styles.iconKeyLabel, focused && styles.keyTextFocused]}>{label}</Text>}
              </View>
            ) : (
              <Text
                style={[
                  styles.keyText,
                  large && styles.keyTextLarge,
                  LATIN_LETTER.test(label) && styles.keyTextLatin,
                  DIGIT.test(label) && styles.keyTextDigit,
                  ARABIC_LETTER.test(label) && styles.keyTextArabic,
                  focused && styles.keyTextFocused,
                ]}
              >
                {label}
              </Text>
            )}
          </View>
        )}
      </Focusable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: s(20), gap: BLOCK_GAP },
  // A bordered grid: every key is a cell whose right/bottom edge is a thin dark-gray rule (dropped on the
  // block's last column/row, where the block's own border already sits), so neighbors share ONE line.
  // overflow:hidden is what clips a focused (white) corner key to the rounded corner.
  block: { borderWidth: 1, borderColor: GRID_COLOR, overflow: "hidden" },
  blockTop: { borderTopLeftRadius: OUTER_RADIUS, borderTopRightRadius: OUTER_RADIUS },
  blockBottom: { borderBottomLeftRadius: OUTER_RADIUS, borderBottomRightRadius: OUTER_RADIUS },
  row: { flexDirection: "row" },
  padCell: { flexGrow: 1, flexBasis: 0, height: s(40), borderRightWidth: 1, borderBottomWidth: 1, borderColor: GRID_COLOR },
  noRight: { borderRightWidth: 0 },
  noBottom: { borderBottomWidth: 0 },
  keyTouch: { width: "100%" },
  key: {
    height: s(40),
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: GRID_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
  keyTall: { height: s(48) },
  keyFocused: { backgroundColor: "#fff" },
  keyText: { color: "#fff", fontSize: fs(14), fontFamily: font.bold },
  keyTextLarge: { fontSize: fs(19) },
  keyTextLatin: { fontSize: fs(20) },
  keyTextDigit: { fontSize: fs(18) },
  // Arabic glyphs are drawn lower/smaller than Latin ones at the same size - brought up to read about the same.
  keyTextArabic: { fontSize: fs(19) },
  keyTextFocused: { color: "#000" },
  iconKey: { flexDirection: "row", alignItems: "center", gap: s(6) },
  iconKeyLabel: { color: "#fff", fontSize: fs(13), fontFamily: font.bold },
});
