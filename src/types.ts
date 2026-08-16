/**
 * Shared types for Cinemana TV App
 */

export interface Episode {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  duration: string;
  storyAr: string;
  storyEn: string;
  thumbnail: string;
  servers: { name: string; url: string }[];
  subtitlesUrlAr?: string;
  subtitlesUrlEn?: string;
  rating?: number;
}

export interface Season {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  storyAr?: string;
  storyEn?: string;
  episodes: Episode[];
}

export interface Movie {
  id: string;
  titleAr: string;
  titleEn: string;
  type: "movie" | "series";
  rating: number;
  year: number;
  duration: string;
  genres: string[];
  poster: string;
  backdrop: string;
  storyAr: string;
  storyEn: string;
  actors: string[];
  quality: string;
  servers: { name: string; url: string }[];
  seasons?: Season[];
  views?: number;
  subtitlesUrlAr?: string;
  subtitlesUrlEn?: string;
  ageRating?: string;
  trailerUrl?: string;
  language?: string;
  country?: string;
  isPublished?: boolean;
  collectionId?: string;
  collectionNameAr?: string;
  collectionNameEn?: string;
  partNumber?: string | number;
  logoUrl?: string;
  titleLogo?: string;
  director?: string;
  writer?: string;
  directorPhotoUrl?: string;
  writerPhotoUrl?: string;
  castMembers?: CastMember[];
}

export interface CastMember {
  name: string;
  role?: string;
  photoUrl: string;
}

export interface Category {
  id: string;
  titleAr: string;
  titleEn: string;
  items: Movie[];
}

export interface AdServer {
  id: string;
  name: string;
  url: string;
  type?: "video" | "hls" | "embed";
}

export interface Ad {
  id: string;
  titleAr: string;
  titleEn: string;
  mediaUrl?: string;
  sponsorNameAr?: string;
  sponsorNameEn?: string;
  sponsorLogo?: string;
  sponsorUrl?: string;
  skipAfterSeconds: number;
  durationSeconds: number;
  servers: AdServer[];
  isActive: boolean;
  targetType: "all" | "movie" | "series";
  createdAt?: string;
}

export interface AdsSettings {
  enabled: boolean;
  globalSkipAfterSeconds: number;
  skipAfterSeconds?: number;
  allowSkip: boolean;
  ads: Ad[];
}

