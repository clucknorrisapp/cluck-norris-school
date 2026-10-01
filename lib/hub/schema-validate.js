"use strict";
// The settlement library's JSON Schemas (lib/hub/schema/*.json) use only a small subset of JSON
// Schema (type, required, properties, additionalProperties, enum, items, pattern) — this is that
// subset's validator, factored out of scripts/hub-schema-test.cjs (X2, docs/HUB_VERIFY.md) so a
// judge's own `scripts/hub-validate.cjs <url>` and the CI test run the EXACT SAME check rather
// than two hand-written copies that could drift (CLAUDE.md, "Verification: check every form").
// Dependency-free on purpose — see the CI test's own header for why.

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}
function typeOk(t, v) {
  if (t === "integer") return Number.isInteger(v);
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === t || (t === "number" && typeof v === "number");
}
function validate(schema, data, at = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, data))) { errors.push(`${at}: expected ${types.join("|")}, got ${typeOf(data)}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${at}: ${JSON.stringify(data)} not in ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof data === "string" && !new RegExp(schema.pattern).test(data)) errors.push(`${at}: "${data}" fails /${schema.pattern}/`);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const req of schema.required || []) if (!Object.prototype.hasOwnProperty.call(data, req)) errors.push(`${at}: missing required "${req}"`);
    if (schema.properties) {
      for (const [k, v] of Object.entries(data)) {
        if (Object.prototype.hasOwnProperty.call(schema.properties, k)) validate(schema.properties[k], v, `${at}.${k}`, errors);
        else if (schema.additionalProperties === false) errors.push(`${at}.${k}: additional property not allowed`);
      }
    }
  }
  if (Array.isArray(data) && schema.items) data.forEach((item, i) => validate(schema.items, item, `${at}[${i}]`, errors));
  return errors;
}

module.exports = { validate, typeOf, typeOk };
