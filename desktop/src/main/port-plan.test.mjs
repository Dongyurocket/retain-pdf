import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AI_PORT_FALLBACKS,
  API_PORT_FALLBACKS,
  DEFAULT_AI_PORT,
  DEFAULT_API_PORT,
  DEFAULT_SIMPLE_PORT,
  SIMPLE_PORT_FALLBACKS,
  resolveAiPortCandidates,
  resolveApiPortCandidates,
  resolveSimplePortCandidates,
} = require("./port-plan.js");

test("api candidates default to 41000 followed by dedicated fallbacks", () => {
  const candidates = resolveApiPortCandidates({ env: {} });
  assert.deepEqual(candidates, [DEFAULT_API_PORT, ...API_PORT_FALLBACKS]);
});

test("api candidates honor explicit env override exclusively", () => {
  const candidates = resolveApiPortCandidates({ env: { RETAINPDF_DESKTOP_API_PORT: "45555" } });
  assert.deepEqual(candidates, [45555]);
});

test("api candidates ignore invalid env override", () => {
  for (const bad of ["", "0", "65536", "abc", "-1"]) {
    const candidates = resolveApiPortCandidates({ env: { RETAINPDF_DESKTOP_API_PORT: bad } });
    assert.equal(candidates[0], DEFAULT_API_PORT, `override=${bad}`);
  }
});

test("api candidates insert last used port after the default and dedupe", () => {
  const withLast = resolveApiPortCandidates({ env: {}, lastPort: 41200 });
  assert.deepEqual(withLast, [DEFAULT_API_PORT, 41200, 41201, 41202, 41203]);

  const lastIsDefault = resolveApiPortCandidates({ env: {}, lastPort: DEFAULT_API_PORT });
  assert.deepEqual(lastIsDefault, [DEFAULT_API_PORT, ...API_PORT_FALLBACKS]);

  const lastInvalid = resolveApiPortCandidates({ env: {}, lastPort: 70000 });
  assert.deepEqual(lastInvalid, [DEFAULT_API_PORT, ...API_PORT_FALLBACKS]);
});

test("simple candidates keep the existing fallback order", () => {
  const candidates = resolveSimplePortCandidates({ env: {} });
  assert.deepEqual(candidates, [DEFAULT_SIMPLE_PORT, ...SIMPLE_PORT_FALLBACKS]);
});

test("simple candidates honor env override exclusively", () => {
  const candidates = resolveSimplePortCandidates({ env: { RETAINPDF_DESKTOP_SIMPLE_PORT: "43000" } });
  assert.deepEqual(candidates, [43000]);
});

test("ai candidates default to 41100 followed by dedicated fallbacks", () => {
  const candidates = resolveAiPortCandidates({ env: {} });
  assert.deepEqual(candidates, [DEFAULT_AI_PORT, ...AI_PORT_FALLBACKS]);
});

test("ai candidates honor env override exclusively", () => {
  const candidates = resolveAiPortCandidates({ env: { RETAINPDF_DESKTOP_AI_PORT: "43333" } });
  assert.deepEqual(candidates, [43333]);
});
