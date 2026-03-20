export function makeTag(name, fields = {}) {
  return {
    template_type: 'tag',
    template_name: name,
    data_type: 'f64',
    is_setpoint: false,
    fields,
    children: [],
  };
}

export function makeStruct(name, type = 'parameter', children = [], fields = {}) {
  return {
    template_type: type,
    template_name: name,
    fields,
    children,
  };
}

export function makeEntry(template, hash = 'aabbcc') {
  return { template, hash };
}

// Typical loadRoot API response
// templates: plain object { [name]: { template, hash } }
export function makeLoadRootResponse(templates) {
  return {
    root_template_name: Object.keys(templates)[0],
    templates,
  };
}
