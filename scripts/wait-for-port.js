/**
 * Poll a TCP port until it accepts connections, then exit 0.
 * Usage: node scripts/wait-for-port.js <port> [timeout_ms]
 *
 * On success: prints "Port <port> is ready" and exits 0.
 * On timeout: prints "Timeout waiting for port <port>" to stderr and exits 1.
 */
import net from 'node:net';

const port = parseInt(process.argv[2], 10);
const timeout = parseInt(process.argv[3] ?? '30000', 10);

if (!port || isNaN(port)) {
  process.stderr.write('Usage: node scripts/wait-for-port.js <port> [timeout_ms]\n');
  process.exit(1);
}

const RETRY_INTERVAL = 500;
const deadline = Date.now() + timeout;

function attempt() {
  let socket;
  try {
    socket = net.createConnection({ port, host: 'localhost' });
  } catch {
    process.stderr.write(`Timeout waiting for port ${port}\n`);
    process.exit(1);
  }

  socket.once('connect', () => {
    socket.destroy();
    process.stdout.write(`Port ${port} is ready\n`);
    process.exit(0);
  });

  socket.once('error', () => {
    socket.destroy();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      process.stderr.write(`Timeout waiting for port ${port}\n`);
      process.exit(1);
    }
    setTimeout(attempt, Math.min(RETRY_INTERVAL, remaining));
  });
}

attempt();
