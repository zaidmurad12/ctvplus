export const BACKEND_SERVER_URL = "https://ais-dev-y5ulc2o3n7cireamjvyi3x-460709864021.europe-west3.run.app";

/**
 * Returns a fully-qualified API URL if running under file:// protocol (e.g. local Android WebView assets),
 * or returns the relative URL if running on the web server.
 */
export function getApiUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const cleanPath = url.startsWith("/") ? url : `/${url}`;
  
  // Always use relative paths when running on HTTP/HTTPS web protocol (localhost, dev preview, production)
  if (typeof window !== "undefined") {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return cleanPath;
    }
  }

  return cleanPath;
}
