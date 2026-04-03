const API_BASE = '/api/v1';

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
    throw error;
  }

  return json.data;
}

export const apiClient = {
  get:  (path)       => request(path, { method: 'GET', cache: 'no-store' }),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
};
