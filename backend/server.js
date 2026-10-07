/**
 * API entry point (what Render runs: `node server.js`).
 *
 * WHAT: Loads config (fail-fast validation), creates the app, starts listening.
 *
 * WHY separate from app.js: app.js builds the Express app (importable by tests
 * without opening a port), while server.js owns the process (ports, signals,
 * crash handling). One file, one job.
 */

'use strict';

// config must load FIRST: it throws on missing secrets before we bind a port.
const config = require('./src/config/env');
const createApp = require('./src/app');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[webake] API listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[webake] health check: http://localhost:${config.port}/health`);
});

// A promise rejection nobody caught means a bug. Log it and exit non-zero so
// Render restarts the service instead of running in a half-broken state.
process.on('unhandledRejection', (reason) => {
  console.error('[webake] unhandledRejection:', reason);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('[webake] uncaughtException:', err);
  server.close(() => process.exit(1));
});
