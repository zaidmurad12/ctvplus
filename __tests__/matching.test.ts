import { calculateMatchScore, extractImdbId, matchTmdbWithCinemana, normalizeTitle } from "../src/api";
import type { CinemanaSearchItem } from "../src/providers/cinemana";
import type { Movie } from "../src/api";

const movie: Movie = {
  id: "tmdb-1",
  titleAr: "بريكنج باد",
  titleEn: "Breaking Bad",
  originalTitle: "Breaking Bad",
  year: 2008,
  type: "series",
};

const cinemana: CinemanaSearchItem = {
  nb: 42,
  en_title: "Breaking Bad",
  ar_title: "بريكنج باد",
  year: 2008,
  type: "series",
};

test("normalizes titles and safely extracts IMDb IDs", () => {
  expect(normalizeTitle("  Breaking-Bad! ")).toBe("breakingbad");
  expect(extractImdbId("https://www.imdb.com/title/tt0903747/")).toBe("tt0903747");
  expect(extractImdbId(undefined)).toBeUndefined();
});

test("matches the same title and type while preserving a conservative threshold", () => {
  expect(calculateMatchScore(movie, cinemana)).toBeGreaterThanOrEqual(85);
  expect(matchTmdbWithCinemana(movie, [cinemana])?.nb).toBe(42);
  expect(matchTmdbWithCinemana({ ...movie, type: "movie" }, [cinemana])).toBeNull();
  expect(matchTmdbWithCinemana(movie, [{ ...cinemana, year: 2020 }])).toBeNull();
});

test("uses a compatible IMDb ID as a decisive signal", () => {
  const withImdb = { ...movie, imdbId: "tt0903747" };
  expect(calculateMatchScore(withImdb, { ...cinemana, imdbUrlRef: "https://imdb.com/title/tt0903747" })).toBe(100);
  expect(matchTmdbWithCinemana(withImdb, [{ ...cinemana, imdbUrlRef: "https://imdb.com/title/tt0903747" }])?.nb).toBe(42);
});
