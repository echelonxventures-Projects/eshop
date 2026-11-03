import {assertProductionConfig, config} from './config.js';
import app from './app.js';
import {closeDb} from './db.js';

assertProductionConfig();
let server;
server = app.listen(config.port, () => console.log(`Marketly API listening on http://localhost:${config.port}`));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);
  if (!server) { await closeDb(); return; }
  server.close(async error => {
    try { await closeDb(); } finally { process.exitCode = error ? 1 : 0; }
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
