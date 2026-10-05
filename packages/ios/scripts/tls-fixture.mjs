import { spawn } from "node:child_process";
import { createServer as http } from "node:http";
import { createServer as https } from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const { WebSocket, WebSocketServer } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("ws");

export async function startTLSFixture(endpoint, directory) {
  await mkdir(directory, { recursive: true });
  async function openssl(args) {
    await new Promise((done, fail) => {
      const child = spawn("openssl", args, {
        cwd: directory,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let errors = "";
      child.stderr.on("data", (bytes) => {
        errors = (errors + bytes).slice(-2048);
      });
      child.once("error", fail);
      child.once("close", (code) =>
        code === 0
          ? done()
          : fail(
              new Error(
                `TLS fixture openssl ${args[0]} exited ${code}: ${errors}`,
              ),
            ),
      );
    });
  }
  await writeFile(
    join(directory, "root.cnf"),
    "[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n",
  );
  for (const root of ["trusted", "untrusted"]) {
    await openssl([
      "req",
      "-new",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-config",
      "root.cnf",
      "-days",
      "2",
      "-subj",
      `/CN=YA disposable ${root} root`,
      "-keyout",
      `${root}.key`,
      "-out",
      `${root}.crt`,
    ]);
  }
  await writeFile(
    join(directory, "leaf.ext"),
    "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n",
  );
  await openssl([
    "req",
    "-new",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  for (const [name, root, days] of [
    ["trusted-leaf", "trusted", "1"],
    ["untrusted-leaf", "untrusted", "1"],
  ]) {
    await openssl([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      `${root}.crt`,
      "-CAkey",
      `${root}.key`,
      "-CAcreateserial",
      "-days",
      days,
      "-extfile",
      "leaf.ext",
      "-out",
      `${name}.crt`,
    ]);
  }
  await mkdir(join(directory, "issued"), { recursive: true });
  await writeFile(join(directory, "expired-index"), "");
  await writeFile(join(directory, "expired-serial"), "01\n");
  const extensions = await readFile(join(directory, "leaf.ext"), "utf8");
  await writeFile(
    join(directory, "ca.cnf"),
    "[ca]\ndefault_ca=fixture\n[fixture]\ndatabase=expired-index\nserial=expired-serial\nnew_certs_dir=issued\ncertificate=trusted.crt\nprivate_key=trusted.key\ndefault_md=sha256\npolicy=names\nx509_extensions=server\n[names]\ncommonName=supplied\n[server]\n" +
      extensions,
  );
  await openssl([
    "ca",
    "-config",
    "ca.cnf",
    "-batch",
    "-notext",
    "-in",
    "leaf.csr",
    "-out",
    "expired-leaf.crt",
    "-startdate",
    "20200101000000Z",
    "-enddate",
    "20200102000000Z",
  ]);
  const sockets = new Set();
  const servers = [];
  const stats = { trusted: 0, wrongHost: 0, untrusted: 0, expired: 0 };
  const addresses = {};
  const listen = (server) =>
    new Promise((done, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => done(server.address().port));
    });
  const stop = async () => {
    for (const socket of sockets) socket.terminate();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
    );
  };
  try {
    const key = await readFile(join(directory, "leaf.key"));
    for (const [name, leaf] of [
      ["trusted", "trusted-leaf"],
      ["untrusted", "untrusted-leaf"],
      ["expired", "expired-leaf"],
    ]) {
      const server = https({
        key,
        cert: await readFile(join(directory, `${leaf}.crt`)),
      });
      servers.push(server);
      const webSockets = new WebSocketServer({
        noServer: true,
        maxPayload: 32 * 1024 * 1024,
      });
      server.on("upgrade", (request, socket, head) => {
        const mode =
          name === "trusted" && request.headers.host?.startsWith("127.")
            ? "wrongHost"
            : name;
        stats[mode]++;
        webSockets.handleUpgrade(request, socket, head, (client) => {
          const upstream = new WebSocket(endpoint, {
            maxPayload: 32 * 1024 * 1024,
          });
          sockets.add(client);
          sockets.add(upstream);
          let pendingBytes = 0;
          const pending = [];
          client.on("message", (bytes, binary) => {
            if (upstream.readyState === WebSocket.OPEN)
              upstream.send(bytes, { binary });
            else if (
              upstream.readyState === WebSocket.CONNECTING &&
              pendingBytes + bytes.length <= 65536
            ) {
              pendingBytes += bytes.length;
              pending.push([bytes, binary]);
            } else client.terminate();
          });
          upstream.on("open", () => {
            for (const [bytes, binary] of pending)
              upstream.send(bytes, { binary });
            pending.length = 0;
          });
          upstream.on("message", (bytes, binary) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(bytes, { binary });
          });
          for (const [owned, other] of [
            [client, upstream],
            [upstream, client],
          ]) {
            owned.on("error", () => {
              owned.terminate();
              other.terminate();
            });
            owned.on("close", () => {
              sockets.delete(owned);
              other.terminate();
            });
          }
        });
      });
      const port = await listen(server);
      addresses[name] = `wss://localhost:${port}/api/ws`;
      if (name === "trusted")
        addresses.wrongHost = `wss://127.0.0.1:${port}/api/ws`;
    }
    const status = http((_, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(stats));
    });
    servers.push(status);
    addresses.status = `http://127.0.0.1:${await listen(status)}/`;
    return { addresses, root: resolve(directory, "trusted.crt"), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
