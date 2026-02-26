import { execSync, spawnSync } from "node:child_process";

const PORTS = [3000, 4173];

function run(command: string) {
  return spawnSync("zsh", ["-lc", command], {
    stdio: "pipe",
    encoding: "utf8",
  });
}

function printPortStatus(label: string) {
  console.log(`\n[${label}] Port ownership`);
  for (const port of PORTS) {
    const result = run(`lsof -n -P -iTCP:${port} -sTCP:LISTEN`);
    if (result.status === 0 && result.stdout.trim()) {
      console.log(`\n:${port}`);
      console.log(result.stdout.trim());
    } else {
      console.log(`:${port} no listener`);
    }
  }
}

function bestEffort(command: string, note: string) {
  const result = run(command);
  if (result.status === 0) {
    console.log(`- ${note}: ok`);
    return;
  }

  const stderr = (result.stderr ?? "").trim();
  const stdout = (result.stdout ?? "").trim();
  const detail = stderr || stdout;
  console.log(`- ${note}: skipped${detail ? ` (${detail})` : ""}`);
}

function killPortListener(port: number) {
  const list = run(`lsof -t -iTCP:${port} -sTCP:LISTEN`);
  if (list.status !== 0 || !list.stdout.trim()) return;

  const pids = list.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const pid of pids) {
    bestEffort(`kill -TERM ${pid}`, `terminate listener pid ${pid} on :${port}`);
  }
}

console.log("[e2e:reset] Starting Playwright reset");
printPortStatus("before");

console.log("\n[e2e:reset] Best-effort cleanup");
bestEffort("pkill -f 'playwright test --ui'", "pkill playwright ui");
bestEffort("pkill -f 'playwright test --project=desktop --grep @tour'", "pkill playwright @tour runs");
bestEffort("pkill -f 'next dev -- --port 4173'", "pkill next dev port 4173 (double-dash form)");
bestEffort("pkill -f 'next dev --port 4173'", "pkill next dev port 4173");
killPortListener(4173);

// give processes a moment to release sockets
try {
  execSync("sleep 0.5", { stdio: "ignore" });
} catch {
  // no-op
}

printPortStatus("after");
console.log("\n[e2e:reset] Done");
