async function testSubs() {
  try {
    const res = await fetch("http://localhost:3000/api/subtitles?movieId=movie_1&lang=ar");
    console.log("Status:", res.status);
    console.log("Headers Content-Type:", res.headers.get("content-type"));
    const text = await res.text();
    console.log("Response text sample:\n", text.substring(0, 300));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
testSubs();
