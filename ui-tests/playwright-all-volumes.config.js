/**
 * The suite of ACC-DELETE-153-ALL-VOLUMES: tests/all-volumes.spec.ts against a test server
 * with c.AdvancedFileBrowser.trash_on_all_volumes = True (jupyter_server_all_volumes_config.py)
 */
const config = require('./playwright.config');

module.exports = {
  ...config,
  testIgnore: [],
  testMatch: '**/all-volumes.spec.ts',
  webServer: {
    ...config.webServer,
    command: 'jupyter lab --config jupyter_server_all_volumes_config.py'
  }
};
