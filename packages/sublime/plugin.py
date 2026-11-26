"""Registers the Loominate IF language server with Sublime Text's LSP package (#413, ADR 0121).

The server is the proxy next to this file. It reads the project folder from
the editor's `initialize` request and hands the connection to the game's own
language server, or a Loominate IF checkout's.
"""

import sublime

try:
    from LSP.plugin import AbstractPlugin, register_plugin, unregister_plugin
except ImportError:  # The LSP package isn't installed: highlighting still works.
    AbstractPlugin = None
    print("Loominate IF: install the LSP package for diagnostics and completion.")

SETTINGS = "LSP-loominate.sublime-settings"


if AbstractPlugin is not None:

    class Loominate(AbstractPlugin):
        # LSP prefixes "LSP-" to this, so it names the server LSP-loominate.
        @classmethod
        def name(cls) -> str:
            return "loominate"

        # LSP's default looks in Packages/LSP-loominate, but this package is
        # "Loominate IF", and LSP won't register from a path that isn't there.
        @classmethod
        def configuration(cls):
            return sublime.load_settings(SETTINGS), "Packages/Loominate IF/" + SETTINGS

    def plugin_loaded() -> None:
        register_plugin(Loominate)

    def plugin_unloaded() -> None:
        unregister_plugin(Loominate)
