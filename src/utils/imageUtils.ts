import { getApiUrl } from "./apiUtils";

// Utility to ensure all images across the app are loaded in 4K / Ultra-HD resolution for large screens

export function getHighResImage(url?: string | null, isBackdrop = false): string {
  if (!url) {
    return isBackdrop
      ? "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=3840&q=95&auto=format&fit=crop"
      : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
  }

  let cleanUrl = url.trim();

  // 1. TMDB Images Upgrade
  if (cleanUrl.includes("image.tmdb.org/t/p/")) {
    if (isBackdrop) {
      // Upgrade backdrop image resolution to original (4K)
      return getApiUrl(cleanUrl.replace(
        /\/t\/p\/(w500|w300|w185|w780|w1280|w1920_and_h1080_bestv2|1920_and_h800_multi_faces|1000_and_h563_multi_faces)\//,
        "/t/p/original/"
      ));
    } else {
      // Upgrade poster or thumbnail resolution to w780 or original
      return getApiUrl(cleanUrl.replace(
        /\/t\/p\/(w500|w300|w185|w154|w92|w342)\//,
        "/t/p/w780/"
      ));
    }
  }

  // 2. Profile / Actor Photo Upgrade
  if (cleanUrl.includes("image.tmdb.org/t/p/") && (cleanUrl.includes("/w185/") || cleanUrl.includes("/w300/"))) {
    return getApiUrl(cleanUrl.replace(/\/t\/p\/(w185|w300)\//, "/t/p/h632/"));
  }

  // 3. Unsplash Images Upgrade
  if (cleanUrl.includes("images.unsplash.com")) {
    let upgraded = cleanUrl;
    if (upgraded.includes("w=")) {
      upgraded = upgraded.replace(/w=\d+/, isBackdrop ? "w=3840" : "w=1920");
    } else {
      upgraded += `&w=${isBackdrop ? "3840" : "1920"}`;
    }

    if (upgraded.includes("q=")) {
      upgraded = upgraded.replace(/q=\d+/, "q=95");
    } else {
      upgraded += "&q=95";
    }

    return getApiUrl(upgraded);
  }

  return getApiUrl(cleanUrl);
}

