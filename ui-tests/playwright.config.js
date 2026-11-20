/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');
const { mkdtempSync, rmSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

// The test server's own home, so a run outside the sandbox runner never reads or writes the
// real home's trash, settings or workspaces. It is made in the home, not in /tmp, so the server
// root below it is not on the runner's /tmp mount, which ACC-DELETE-152 and 156 use as another
// mount. Made once: the workers inherit it, and the specs read the trash from it. Only a folder
// made here is removed, never a GALATA_HOME the caller set. The removal is registered here, before
// the webServer starts, so it runs at process exit also when the server fails to start; by then
// the webServer is stopped.
const madeHome = !process.env.GALATA_HOME;
process.env.GALATA_HOME ||= mkdtempSync(join(homedir(), 'galata-home-'));
if (madeHome) {
  const home = process.env.GALATA_HOME;
  process.on('exit', () => {
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      // A failed removal must not change the exit status of the run.
      console.warn(`The test server's home ${home} was not removed: ${error}`);
    }
  });
}

// Galata pins the test server to 8888 and does not move it when the port is taken.
// JUPYTER_TEST_PORT moves the server (jupyter_server_test_config.py) and this base URL together.
const PORT = process.env.JUPYTER_TEST_PORT || '8888';
const BASE_URL = `http://localhost:${PORT}`;

module.exports = {
  ...baseConfig,
  // Under load a parallel worker's tmpPath teardown can 404 the page's start-up listing of the
  // shared server root ("Directory not found" dialog); one retry absorbs that race
  retries: 1,
  // One worker per spec file (17) starts that many JupyterLab pages against the one server;
  // measured start-up listings then take over 10 s and pages exceed Galata's fixed 15 s app-start
  // wait, so outside CI the suite runs at eight; CI keeps Playwright's default for its smaller runner
  workers: process.env.CI ? undefined : 8,
  // It needs its own server: playwright-all-volumes.config.js
  testIgnore: '**/all-volumes.spec.ts',
  use: { ...baseConfig.use, baseURL: BASE_URL },
  webServer: {
    command: 'jlpm start',
    url: `${BASE_URL}/lab`,
    timeout: 120 * 1000,
    // send2trash reads XDG_DATA_HOME before HOME
    env: {
      HOME: process.env.GALATA_HOME,
      XDG_DATA_HOME: join(process.env.GALATA_HOME, '.local', 'share')
    },
    // Never adopt a server this suite did not start: on 8888 that is a developer's own lab.
    reuseExistingServer: false
  }
};
