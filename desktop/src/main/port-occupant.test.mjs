import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPortOccupant } = require("./port-occupant.js");

test("isOwnResidualBackend matches known images case-insensitively", () => {
  const occupant = createPortOccupant();
  assert.equal(occupant.isOwnResidualBackend("rust_api.exe"), true);
  assert.equal(occupant.isOwnResidualBackend("RUST_API.EXE"), true);
  assert.equal(occupant.isOwnResidualBackend("retain-jobsd.exe"), true);
  assert.equal(occupant.isOwnResidualBackend("python.exe"), false);
  assert.equal(occupant.isOwnResidualBackend("node.exe"), false);
});

test("killProcessTreeSync terminates the tree synchronously on win32", () => {
  const calls = [];
  const occupant = createPortOccupant({
    platform: "win32",
    runCommandSync: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });
  assert.equal(occupant.killProcessTreeSync(1234), true);
  assert.deepEqual(calls, [["taskkill", ["/PID", "1234", "/T", "/F"]]]);
});

test("killProcessTreeSync failure returns false gracefully", () => {
  const occupant = createPortOccupant({
    platform: "win32",
    runCommandSync: () => {
      throw new Error("access denied");
    },
    logger: { warn: () => {} },
  });
  assert.equal(occupant.killProcessTreeSync(1234), false);
});

test("describeOccupant produces clear actionable messages", () => {
  const occupant = createPortOccupant({ platform: "win32" });
  const desc = occupant.describeOccupant(41000, { pid: "5678", image: "rust_api.exe" });
  assert.match(desc, /rust_api\.exe/);
  assert.match(desc, /5678/);
  assert.match(desc, /taskkill \/PID 5678 \/F/);
});
