const { spawn } = require('node:child_process');
const path = require('node:path');

if (!process.execArgv.includes('--experimental-sqlite')) {
  const child = spawn(process.execPath, ['--experimental-sqlite', path.join(__dirname, 'server-bootstrap.cjs')], {
    stdio: 'inherit',
    env: process.env,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };

  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));

  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  global.DatabaseSync = DatabaseSync;
  require('tsx/cjs');
  require('./server.ts');
}
