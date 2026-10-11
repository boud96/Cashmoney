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

// Errors come back as JSON from the API; anything else (an HTML error page) is reduced to a
// short message instead of being shown as raw markup.
export async function readJson(response, fallbackError = "") {
  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const statusMessage = response.status >= 500
      ? `Server error (${response.status})`
      : `Request failed (${response.status})`;
    const error = new Error(payload?.error || fallbackError || statusMessage);
    error.payload = payload; // e.g. the report of a failed import
    throw error;
  }
  return payload ?? {};
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

// Fired on window when requests stop (or start again) reaching the backend at all;
// event.detail.reachable says which. HTTP errors don't count: the backend answered.
export const BACKEND_REACHABILITY_EVENT = "cashmoney:backend-reachability";
let backendReachable = true;

function reportReachability(reachable) {
  if (reachable !== backendReachable) {
    backendReachable = reachable;
    window.dispatchEvent(new CustomEvent(BACKEND_REACHABILITY_EVENT, { detail: { reachable } }));
  }
}

export async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(path, withCsrfHeaders(options));
  } catch {
    reportReachability(false);
    throw new Error("Can't reach the Cashmoney backend.");
  }
  reportReachability(true);
  return response;
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
