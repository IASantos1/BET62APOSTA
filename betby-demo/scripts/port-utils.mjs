import net from "net";

export function isPortFree(port, host = "::") {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => { try { srv.close(); } catch {} resolve(false); });
    srv.once("listening", () => { try { srv.close(); } catch {} resolve(true); });
    srv.listen({ port, host, exclusive: true });
  });
}

export async function choosePort(preferred, { maxTries = 10, host = "::" } = {}) {
  let port = Number(preferred) || 0;
  for (let i = 0; i < maxTries; i++) {
    if (!port) return 0;
    if (await isPortFree(port, host)) return port;
    port += 1;
  }
  return 0;
}

export function listenWithFallback(server, preferred, opts = {}) {
  const { label = "server", onListen = null } = opts;
  return new Promise(async (resolve) => {
    const chosen = await choosePort(preferred);
    function ok() {
      const a = server.address();
      const p = typeof a === "string" ? 0 : a.port;
      if (Number(preferred) && p !== Number(preferred)) {
        console.warn(`[${label}] ⚠️  Porta ${preferred} ocupada — subindo em http://localhost:${p}`);
      } else {
        console.log(`[${label}] HTTP rodando em http://localhost:${p}`);
      }
      if (onListen) onListen(p);
      resolve(p);
    }
    server.once("listening", ok);
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.warn(`[${label}] EADDRINUSE em porta escolhida — dinâmica`);
        server.listen(0, "::", () => ok());
      } else {
        throw e;
      }
    });
    server.listen(chosen || 0, "::");
  });
}

export default { choosePort, isPortFree, listenWithFallback };
