import { Dimensions } from "react-native";
import { s } from "./scale";
import { CARD_TOTAL_WIDTH_LARGE } from "./components/MovieCard";

// Shared by the full-page card grids (Movies/Series) and My Library's rails, so both show the
// exact same card size. Only ever imported by lazily-loaded screens, so s() here already sees the
// viewer's own UI-scale setting (see App.tsx's comment on lazy imports and scale.ts).

// Past the sidebar's own 88px column. Was s(176) (extra clearance for a card focus-scale that
// crept under the sidebar) - reported as sitting too far from the sidebar; cards no longer scale
// on focus (see MovieCard), so that clearance isn't needed.
export const GRID_START = s(120);
export const GRID_END_PADDING = s(24);
// Rounding the column count down left up to almost a whole card's width empty at the end of
// every row (reported as a big gap on the right, varying with screen and UI size). The cards now
// share that leftover instead: each is widened just enough that the row ends exactly at the edge.
// s(16) is the card's own horizontal margins (MovieCard's s(8) each side). For a grid whose
// rows start at `start` from the screen's left edge.
export function fillGrid(start: number): { columns: number; cardWidth: number } {
  const rowWidth = Dimensions.get("window").width - start - GRID_END_PADDING;
  const columns = Math.max(4, Math.floor(rowWidth / CARD_TOTAL_WIDTH_LARGE));
  return { columns, cardWidth: Math.floor(rowWidth / columns) - s(16) };
}
const mainGrid = fillGrid(GRID_START);
export const NUM_COLUMNS = mainGrid.columns;
export const CARD_WIDTH_FILL = mainGrid.cardWidth;
