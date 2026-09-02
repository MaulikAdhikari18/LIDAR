// Thin fetch wrapper around the FastAPI backend (LiDAR-BE-main).
// Change BASE_URL if the backend runs somewhere other than localhost:8000.

export const BASE_URL = "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Advances the dataset by one frame and returns the full processed result:
// { frame_id, points_processed, objects, future, regions, candidates, decisions, metrics }
export function advanceFrame() {
  return request("/api/frame", { method: "POST" });
}

// Returns the last processed frame result without advancing.
export function getState() {
  return request("/api/state");
}

export function getMetrics() {
  return request("/api/metrics");
}

export function getDatasetStatus() {
  return request("/api/dataset");
}

export function setDatasetPath(path) {
  return request("/api/dataset/path", { method: "POST", body: JSON.stringify({ path }) });
}

export function resetBackend() {
  return request("/api/reset", { method: "POST" });
}

export function updateConfig(partial) {
  return request("/api/config", { method: "POST", body: JSON.stringify(partial) });
}

// Reads the config the backend is actually running with, so the UI doesn't have
// to keep its own hardcoded copy of the budget / map size / resolution ladder.
export function getConfig() {
  return request("/api/config");
}