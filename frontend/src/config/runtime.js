const LOCAL_API_BASE = "http://127.0.0.1:8000";
const PROD_API_BASE = "https://mockmate-api-6dvm.onrender.com";

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function resolveApiBase() {
  const envValue = normalizeBaseUrl(import.meta.env.VITE_API_BASE);
  if (envValue) return envValue;
  return import.meta.env.PROD ? PROD_API_BASE : LOCAL_API_BASE;
}

function resolveVrStreamingAssetsUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_VR_STREAMING_ASSETS_URL);
}

export const API_BASE = resolveApiBase();
export const VR_STREAMING_ASSETS_URL = resolveVrStreamingAssetsUrl();
