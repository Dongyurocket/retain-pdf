// 端口可用性探测：真实 bind 试探，而不是仅仅"能不能连上"。
//
// 背景：Windows 上 Hyper-V / WSL2 / Docker Desktop 的 HNS 会在开机时成块
// 保留动态端口（实测本机保留了 41890-45985 共 4096 个）。这些端口没有任何
// 监听者，netstat 和 Get-NetTCPConnection 都查不到，connect 探测一律返回
// "空闲"，但真正 bind 时会失败并抛 EADDRINUSE(10048)。
//
// 只做 connect 探测的后果：预检报告 busy=false，随后 rust_api 绑定失败退出，
// 桌面端却在等另一个端口就绪，最终只报"backend did not become ready"，
// 完全看不出是哪个端口出的问题。
const net = require("net");

// 真实 bind 试探。返回 { bindable, code, message }。
// 立刻释放监听，随后由真正的服务进程接管；中间存在极小的竞争窗口，
// 但这仍然严格强于 connect 探测（后者对保留端口是系统性误判）。
function canBindPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    server.once("error", (error) => {
      finish({
        bindable: false,
        code: error?.code || "",
        message: error?.message || String(error),
      });
    });

    server.once("listening", () => {
      server.close(() => {
        finish({ bindable: true, code: "", message: "" });
      });
    });

    // exclusive 让 bind 不与其他进程共享地址，语义贴近 rust_api 的实际绑定。
    try {
      server.listen({ host, port, exclusive: true });
    } catch (error) {
      finish({
        bindable: false,
        code: error?.code || "",
        message: error?.message || String(error),
      });
    }
  });
}

// 综合探测，把端口分成三种状态：
//   "free"      能 bind，没人监听 -> 可以直接用
//   "listening" 有进程在监听    -> 传统的端口占用，可走残留清理/复用逻辑
//   "reserved"  没人监听但 bind 不了 -> 系统级保留（Hyper-V/WSL2/Docker HNS 等）
async function probePort(host, port, options = {}) {
  const connectProbe = typeof options.canConnectToPort === "function"
    ? options.canConnectToPort
    : null;

  const listening = connectProbe ? await connectProbe(host, port) : false;
  if (listening) {
    return { state: "listening", code: "", message: "" };
  }

  const bind = await canBindPort(host, port);
  if (bind.bindable) {
    return { state: "free", code: "", message: "" };
  }
  return { state: "reserved", code: bind.code, message: bind.message };
}

// 依次试探候选端口，返回第一个 state==="free" 的。
// attempts 保留每个候选的探测结果，便于日志里说明为什么跳过。
async function findBindablePort(host, candidates, options = {}) {
  const attempts = [];
  for (const candidate of candidates) {
    const probe = await probePort(host, candidate, options);
    attempts.push({ port: candidate, ...probe });
    if (probe.state === "free") {
      return { port: candidate, attempts };
    }
  }
  return { port: null, attempts };
}

function describeProbe(port, probe) {
  if (!probe) {
    return "";
  }
  if (probe.state === "listening") {
    return `端口 ${port} 已有进程在监听。`;
  }
  if (probe.state !== "reserved") {
    return "";
  }
  const detail = probe.code ? `${probe.code}` : probe.message || "未知错误";
  const lines = [
    `端口 ${port} 无法绑定（${detail}），但没有任何进程在监听它。`,
  ];
  if (process.platform === "win32") {
    lines.push(
      "这是 Windows 端口保留导致的：Hyper-V / WSL2 / Docker Desktop 的 HNS 会在开机时成块保留动态端口，被保留的端口查不到占用进程，却绑不上。",
      "可执行 netsh int ipv4 show excludedportrange protocol=tcp 查看保留段（HNS 的动态保留可能不出现在该列表里）；",
      "退出 Docker Desktop 并执行 wsl --shutdown 可释放这块保留，重启电脑后保留段起点会变化。",
    );
  }
  return lines.join("\n");
}

module.exports = {
  canBindPort,
  describeProbe,
  findBindablePort,
  probePort,
};
