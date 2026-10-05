const API_BASE = "/api";
const CSRF_COOKIE_NAME = "csrftoken";
const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function appendParams(url, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item !== undefined && item !== null && item !== "") {
        url.searchParams.append(key, item);
      }
    });
  });
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function csrfToken() {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1) || "";
}

function withCsrfHeaders(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return options;
  }
  const token = csrfToken();
  if (!token) {
    return options;
  }
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-CSRFToken": decodeURIComponent(token),
    },
  };
}

export function apiFetch(path, options = {}) {
  return fetch(path, withCsrfHeaders(options));
}

export async function apiGet(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  appendParams(url, params);
  const response = await apiFetch(url);
  return readJson(response);
}

export async function apiPost(path, data = {}, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  appendParams(url, params);
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJson(response);
}

export async function apiPatch(path, data = {}, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  appendParams(url, params);
  const response = await apiFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJson(response);
}

export async function apiDelete(path, data = null) {
  const options = { method: "DELETE" };
  if (data !== null) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(data);
  }
  const response = await apiFetch(`${API_BASE}${path}`, options);
  return readJson(response);
}
