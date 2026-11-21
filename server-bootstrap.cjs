const { DatabaseSync } = require('node:sqlite');
global.DatabaseSync = DatabaseSync;

require('tsx/cjs');
require('./server.ts');
