import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

lines.on("line", (line) => {
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
      serverInfo: { name: "termco-e2e-mcp", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{
        name: "ping",
        description: "Fixture MCP ping",
        inputSchema: { type: "object", properties: {} },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    reply(message.id, {
      content: [{ type: "text", text: "pong" }],
    });
    return;
  }
  reply(message.id, {});
});
