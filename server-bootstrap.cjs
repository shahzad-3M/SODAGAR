try {
  const { DatabaseSync } = require('node:sqlite');
  global.DatabaseSync = DatabaseSync;
} catch {
  // node:sqlite is optional when running with DB_DRIVER=mysql
}

require('tsx/cjs');
require('./server.ts');

