import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.HISTORY_PORT ?? 8787);
const logFile = resolve(process.cwd(), process.env.LOG_FILE ?? "data/rebalances.jsonl");

function parseLog(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

const server = createServer(async (request, response) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "cache-control": "no-store",
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, headers);
    response.end(JSON.stringify({ ok: true, logFile }));
    return;
  }

  if (!request.url?.startsWith("/api/history")) {
    response.writeHead(404, headers);
    response.end(JSON.stringify({ error: "not found", routes: ["/api/history", "/health"] }));
    return;
  }

  try {
    const raw = await readFile(logFile, "utf8");
    const entries = parseLog(raw).slice(-200).reverse();
    response.writeHead(200, headers);
    response.end(JSON.stringify(entries));
  } catch {
    response.writeHead(200, headers);
    response.end("[]");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "history_server_start",
      port,
      logFile,
      endpoint: `http://127.0.0.1:${port}/api/history`,
    }),
  );
});
