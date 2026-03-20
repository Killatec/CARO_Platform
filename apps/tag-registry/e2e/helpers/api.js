const API_BASE = 'http://10.0.0.184:3001/api/v1';

/**
 * Internal fetch wrapper. Unwraps the { ok, data/error } envelope.
 * Throws an Error (with .code and .status) on ok:false.
 */
async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();

  if (!json.ok) {
    const err = new Error(json.error?.message ?? `API error ${res.status}`);
    err.code   = json.error?.code;
    err.status = res.status;
    throw err;
  }

  return json.data;
}

/**
 * Creates a tag template via batch POST, then re-fetches to get the
 * server-assigned hash.
 * Returns { template, hash }.
 */
export async function createTagTemplate(name, dataType = 'f64', isSetpoint = false, fields = {}) {
  const template = {
    template_type: 'tag',
    template_name: name,
    data_type:     dataType,
    is_setpoint:   isSetpoint,
    fields:        fields,
    children:      [],
  };

  await request('POST', '/templates/batch', {
    changes:   [{ template_name: name, original_hash: null, template }],
    deletions: [],
    confirmed: true,
  });

  const data = await request('GET', `/templates/${name}`);
  return { template: data.template, hash: data.hash };
}

/**
 * Creates a structural (non-tag) template via batch POST.
 * Returns { template, hash }.
 */
export async function createStructuralTemplate(name, templateType = 'parameter', children = [], fields = {}) {
  const template = {
    template_name: name,
    template_type: templateType,
    fields,
    children,
  };

  await request('POST', '/templates/batch', {
    changes:   [{ template_name: name, original_hash: null, template }],
    deletions: [],
    confirmed: true,
  });

  const data = await request('GET', `/templates/${name}`);
  return { template: data.template, hash: data.hash };
}

/**
 * Returns the server-assigned hash string for a template.
 */
export async function getTemplateHash(name) {
  const data = await request('GET', `/templates/${name}`);
  return data.hash;
}

/**
 * Deletes a template by name. Fetches the hash first; silently skips if the
 * template does not exist (404). Never throws — logs a warning on unexpected errors.
 */
export async function deleteTemplate(name) {
  let hash;
  try {
    const data = await request('GET', `/templates/${name}`);
    hash = data.hash;
  } catch (err) {
    if (err.status === 404 || err.code === 'TEMPLATE_NOT_FOUND') return;
    console.warn(`deleteTemplate(${name}) GET failed: ${err.message}`);
    return;
  }

  try {
    await fetch(`${API_BASE}/templates/${name}`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ original_hash: hash, confirmed: true }),
    });
  } catch (err) {
    console.warn(`deleteTemplate(${name}) DELETE failed: ${err.message}`);
  }
}

/**
 * Deletes each template in namesArray in order.
 */
export async function deleteTemplates(namesArray) {
  for (const name of namesArray) {
    await deleteTemplate(name);
  }
}

/**
 * Lists templates. Filters by type if provided.
 * Returns the templates array from the response.
 */
export async function listTemplates(type) {
  const path = type
    ? `/templates?type=${encodeURIComponent(type)}`
    : '/templates';
  const data = await request('GET', path);
  return data.templates;
}

/**
 * Calls POST /api/v1/templates/batch and returns the full data object.
 * Callers can inspect requires_confirmation, diff, and affectedParents.
 */
export async function batchSave(changes, deletions, confirmed = false) {
  return request('POST', '/templates/batch', { changes, deletions, confirmed });
}
