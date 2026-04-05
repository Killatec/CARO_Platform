/**
 * API client - handles HTTP requests with response unwrapping
 */

const API_BASE = '/api/v1';

/**
 * Make a fetch request and unwrap the response envelope
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const json = await response.json();

  if (!json.ok) {
    const error = new Error(json.error.message || 'An error occurred');
    error.code = json.error.code;
    error.details = json.error.details;
    throw error;
  }

  return json.data;
}

export const apiClient = {
  get: (path) => request(path, { method: 'GET', cache: 'no-store' }),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path, body) => request(path, { method: 'DELETE', body: JSON.stringify(body) })
};
