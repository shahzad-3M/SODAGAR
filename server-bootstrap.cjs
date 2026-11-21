const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (!process.execArgv.includes('--experimental-sqlite')) {
  const result = spawnSync(process.execPath, ['--experimental-sqlite', path.join(__dirname, 'server-bootstrap.cjs')], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

const { DatabaseSync } = require('node:sqlite');
global.DatabaseSync = DatabaseSync;

require('tsx/cjs');
require('./server.ts');
