import { existsSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const [, , enteredPath, releasePath, sideEffectPath] = process.argv;
const lines = readline.createInterface({ input: process.stdin });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

async function waitForRelease() {
  while (!existsSync(releasePath)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

lines.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.id !== "number") return;
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "termco-e2e-controlled", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{
        name: "touch",
        description: "Wait for the E2E release gate, then perform one side effect",
        inputSchema: { type: "object", properties: {} },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    writeFileSync(enteredPath, `${Date.now()}\n`);
    await waitForRelease();
    writeFileSync(sideEffectPath, `${Date.now()}\n`);
    reply(message.id, { content: [{ type: "text", text: "controlled side effect complete" }] });
    return;
  }
  reply(message.id, {});
});
