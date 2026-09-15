import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  readRuntimePorts,
  removeRuntimePorts,
  writeRuntimePorts,
} = require("./runtime-ports.js");

function tempFilePath(name = "runtime-ports.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retainpdf-runtime-ports-"));
  return path.join(dir, name);
}

test("write then read round-trips the resolved ports", () => {
  const filePath = tempFilePath();
  const written = writeRuntimePorts(filePath, {
    apiPort: 41200,
    simplePort: 42000,
    aiPort: 41300,
  });
  assert.equal(written.api_base, "http://127.0.0.1:41200");

  const parsed = readRuntimePorts(filePath);
  assert.equal(parsed.apiPort, 41200);
  assert.equal(parsed.simplePort, 42000);
  assert.equal(parsed.aiPort, 41300);
  assert.equal(parsed.apiBase, "http://127.0.0.1:41200");
  assert.equal(typeof parsed.updatedAt, "string");
});

test("write leaves no temp file behind (atomic rename)", () => {
  const filePath = tempFilePath();
  writeRuntimePorts(filePath, { apiPort: 41000 });
  const siblings = fs.readdirSync(path.dirname(filePath));
  assert.deepEqual(siblings, [path.basename(filePath)]);
});

test("write rejects a missing/invalid apiPort", () => {
  const filePath = tempFilePath();
  assert.throws(() => writeRuntimePorts(filePath, {}), /apiPort/);
  assert.throws(() => writeRuntimePorts(filePath, { apiPort: 70000 }), /apiPort/);
});

test("read returns null for missing or corrupt files", () => {
  const missing = tempFilePath();
  assert.equal(readRuntimePorts(missing), null);

  const corrupt = tempFilePath();
  fs.mkdirSync(path.dirname(corrupt), { recursive: true });
  fs.writeFileSync(corrupt, "{ not json", "utf8");
  assert.equal(readRuntimePorts(corrupt), null);

  const wrongShape = tempFilePath();
  fs.writeFileSync(wrongShape, JSON.stringify({ api_port: "abc" }), "utf8");
  assert.equal(readRuntimePorts(wrongShape), null);
});

test("explicit apiBase wins over the derived default", () => {
  const filePath = tempFilePath();
  writeRuntimePorts(filePath, { apiPort: 41000, apiBase: "http://127.0.0.1:41000" });
  assert.equal(readRuntimePorts(filePath).apiBase, "http://127.0.0.1:41000");
});

test("remove is idempotent", () => {
  const filePath = tempFilePath();
  writeRuntimePorts(filePath, { apiPort: 41000 });
  removeRuntimePorts(filePath);
  assert.equal(fs.existsSync(filePath), false);
  removeRuntimePorts(filePath);
});
