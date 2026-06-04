const API_BASE = "/api";

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
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

export async function apiGet(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  appendParams(url, params);
  const response = await fetch(url);
  return readJson(response);
}

export async function apiPost(path, data = {}, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  appendParams(url, params);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJson(response);
}

export async function apiPatch(path, data = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJson(response);
}

export async function apiDelete(path) {
  const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  return readJson(response);
}
