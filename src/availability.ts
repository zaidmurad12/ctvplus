import React, { useContext, useMemo } from "react";
import type { Movie } from "./api";

// Settings > "show available titles only": when on, titles that can't be played from the sources are
// hidden from every list (Home rows and banner, Movies/Series, Search, View more, artist pages, a
// film's other parts). The viewer's own lists (Watch later, history) are left as they are.
export const OnlyAvailableContext = React.createContext(false);

// Available = passed the admin panel's source-compatibility check, or has a playable stream of its
// own (an admin-entered link, or - in Search - a live source match).
export function isAvailable(movie: Movie): boolean {
  return movie.hasSourceMatch === true || !!movie.hasPlayableStream;
}

export function useAvailableOnly<T extends Movie>(list: T[]): T[] {
  const only = useContext(OnlyAvailableContext);
  return useMemo(() => (only ? list.filter(isAvailable) : list), [only, list]);
}
