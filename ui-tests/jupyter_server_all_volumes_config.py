"""Server configuration of the trash_on_all_volumes suite (ACC-DELETE-153-ALL-VOLUMES): the
integration test server of jupyter_server_test_config.py with the option on.

!! Never use this configuration in production; see jupyter_server_test_config.py.
"""
load_subconfig("jupyter_server_test_config.py")  # noqa: F821

c.AdvancedFileBrowser.trash_on_all_volumes = True  # noqa: F821
