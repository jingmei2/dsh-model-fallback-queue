const mk = (def) => ({
  __def: def,
  default(v) { return mk({ ...def, defVal: v }); },
  description(d) { return mk({ ...def, desc: d }); },
  volatile() { return mk({ ...def, vol: true }); },
});
const s = {
  object: (shape) => ({ __kind: 'object', shape }),
  boolean: () => mk({ type: 'boolean' }),
  number: () => mk({ type: 'number' }),
  string: () => mk({ type: 'string' }),
  array: (inner) => mk({ type: 'array', inner }),
  union: (vals) => mk({ type: 'union', vals }),
};
export default s;
