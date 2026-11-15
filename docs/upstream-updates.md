# Updating LiveSync

The upstream version and source commit are recorded in [UPSTREAM.md](../UPSTREAM.md). `plugin/` contains vendored source files, not a Git submodule or subtree.

Compare a new upstream release with that baseline, merge the changes into `plugin/`, and update the recorded version. Preserve the original licence and attribution.

Run the plugin checks and integration tests after an update. Check that all Glass requests still use the authenticated transport and that device credentials remain outside exported settings.
