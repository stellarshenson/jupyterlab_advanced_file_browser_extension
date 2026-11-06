import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { requestAPI } from './request';

/**
 * Initialization data for the @stellarshenson/jupyterlab-advanced-file-browser-extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin',
  description:
    'File browser with foldable folder tree, extra columns and sorting; replaces our separate file browser extensions',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log(
      'JupyterLab extension @stellarshenson/jupyterlab-advanced-file-browser-extension is activated!'
    );

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log(
            '@stellarshenson/jupyterlab-advanced-file-browser-extension settings loaded:',
            settings.composite
          );
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for @stellarshenson/jupyterlab-advanced-file-browser-extension.',
            reason
          );
        });
    }

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_advanced_file_browser_extension server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
