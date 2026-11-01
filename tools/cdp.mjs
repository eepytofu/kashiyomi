import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = process.env.NCM_DEBUG_PORT ?? "9223";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && !String(target.url).startsWith("devtools:"));
if (!page) throw new Error(`No NCM page target on CDP port ${port}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let id = 0;
function command(method, params = {}) {
  const commandId = ++id;
  return new Promise((resolve, reject) => {
    const receive = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== commandId) return;
      socket.removeEventListener("message", receive);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
}

const [mode, value] = process.argv.slice(2);
if (mode === "--eval") {
  const result = await command("Runtime.evaluate", {
    expression: value,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value, null, 2));
} else if (mode === "--screenshot") {
  const target = path.resolve(value);
  await mkdir(path.dirname(target), { recursive: true });
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(target, Buffer.from(result.data, "base64"));
  console.log(target);
} else if (mode === "--reload") {
  await command("Page.reload", { ignoreCache: true });
  console.log("reload requested");
} else if (mode === "--command") {
  const params = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  console.log(JSON.stringify(await command(value, params), null, 2));
} else {
  throw new Error("Use --eval EXPRESSION, --screenshot PATH, --reload, or --command METHOD JSON");
}
socket.close();
