import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canBindPort,
  describeProbe,
  findBindablePort,
  probePort,
} = require("./port-availability.js");

function listenOn(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// 取一个当前空闲端口，用完即释放，避免测试硬编码端口号互相撞车。
async function pickFreePort() {
  const server = await listenOn("127.0.0.1", 0);
  const { port } = server.address();
  await closeServer(server);
  return port;
}

test("canBindPort reports bindable for a free port", async () => {
  const port = await pickFreePort();
  const result = await canBindPort("127.0.0.1", port);
  assert.equal(result.bindable, true);
  assert.equal(result.code, "");
});

test("canBindPort reports EADDRINUSE for a port already listening", async () => {
  const port = await pickFreePort();
  const server = await listenOn("127.0.0.1", port);
  try {
    const result = await canBindPort("127.0.0.1", port);
    assert.equal(result.bindable, false);
    assert.equal(result.code, "EADDRINUSE");
  } finally {
    await closeServer(server);
  }
});

test("probePort returns free when nobody listens and bind succeeds", async () => {
  const port = await pickFreePort();
  const probe = await probePort("127.0.0.1", port, {
    canConnectToPort: async () => false,
  });
  assert.equal(probe.state, "free");
});

test("probePort returns listening when the connect probe succeeds", async () => {
  const port = await pickFreePort();
  const probe = await probePort("127.0.0.1", port, {
    canConnectToPort: async () => true,
  });
  assert.equal(probe.state, "listening");
});

// 核心回归：系统保留端口的特征是"connect 探测说空闲，但 bind 失败"。
// 旧实现只做 connect 探测，这种端口一律误判为可用。
test("probePort returns reserved when connect says free but bind fails", async () => {
  const port = await pickFreePort();
  const server = await listenOn("127.0.0.1", port);
  try {
    const probe = await probePort("127.0.0.1", port, {
      canConnectToPort: async () => false,
    });
    assert.equal(probe.state, "reserved");
    assert.equal(probe.code, "EADDRINUSE");
  } finally {
    await closeServer(server);
  }
});

test("findBindablePort skips unavailable candidates and records attempts", async () => {
  const blockedPort = await pickFreePort();
  const freePort = await pickFreePort();
  const server = await listenOn("127.0.0.1", blockedPort);
  try {
    const result = await findBindablePort("127.0.0.1", [blockedPort, freePort], {
      canConnectToPort: async () => false,
    });
    assert.equal(result.port, freePort);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].state, "reserved");
    assert.equal(result.attempts[1].state, "free");
  } finally {
    await closeServer(server);
  }
});

test("findBindablePort returns null port when every candidate fails", async () => {
  const port = await pickFreePort();
  const server = await listenOn("127.0.0.1", port);
  try {
    const result = await findBindablePort("127.0.0.1", [port], {
      canConnectToPort: async () => false,
    });
    assert.equal(result.port, null);
    assert.equal(result.attempts.length, 1);
  } finally {
    await closeServer(server);
  }
});

test("describeProbe explains reserved ports with the error code", () => {
  const text = describeProbe(42000, {
    state: "reserved",
    code: "EADDRINUSE",
    message: "bind EADDRINUSE",
  });
  assert.match(text, /42000/);
  assert.match(text, /EADDRINUSE/);
  assert.match(text, /没有任何进程在监听/);
});

test("describeProbe stays quiet for free ports", () => {
  assert.equal(describeProbe(42000, { state: "free", code: "", message: "" }), "");
});
