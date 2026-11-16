import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatHub } from "../src/core/hub.js";
import { createHttpServer } from "../src/web/http-server.js";

async function fixture(run: (port: number) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "seance-http-test-"));
  const root = join(dir, "web");
  await mkdir(root);
  await mkdir(join(dir, "web-private"));
  await writeFile(join(root, "index.html"), "public index");
  await writeFile(join(dir, "web-private", "secret.txt"), "private fixture");
  const hub = new ChatHub({ serverName: "test", networkName: "Test", defaultChannels: [] });
  const server = createHttpServer(hub, root, {
    ircPort: 0, publicIrcHost: "", ghostNick: null, provider: "mock",
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await run((server.address() as { port: number }).port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

function request(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, agent: false }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("HTTP fixture timed out")));
  });
}

test("malformed URL encodings return 400 and leave the HTTP server healthy", async () => {
  await fixture(async port => {
    for (const path of ["/%", "/%E0%A4%A", "http://["]) {
      assert.equal((await request(port, path)).status, 400, path);
      assert.equal((await request(port, "/healthz")).status, 200);
    }
    assert.equal((await request(port, "/")).body, "public index");
  });
});

test("static file containment rejects sibling directories sharing the web root prefix", async () => {
  await fixture(async port => {
    const result = await request(port, "/..%2fweb-private%2fsecret.txt");
    assert.equal(result.status, 403);
    assert.doesNotMatch(result.body, /private fixture/);
  });
});
