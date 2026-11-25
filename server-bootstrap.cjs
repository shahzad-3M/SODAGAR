const driverEnv = (process.env.DB_DRIVER || '').trim().toLowerCase();
const isProdEnv = process.env.NODE_ENV === 'production';

if (!isProdEnv && driverEnv !== 'mysql') {
  try {
    const { DatabaseSync } = require('node:sqlite');
    global.DatabaseSync = DatabaseSync;
  } catch {
    // node:sqlite is optional when running with DB_DRIVER=mysql
  }
}

require('tsx/cjs');
require('./server.ts');

