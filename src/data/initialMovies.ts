import moviesJson from "../../movies_db.json";
import { Movie } from "../types";

export const initialMovies: Movie[] = moviesJson as unknown as Movie[];
