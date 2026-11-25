"""Registers the Loominate IF language server with Sublime Text's LSP package (#413, ADR 0121).

The server is the proxy next to this file. It reads the project folder from
the editor's `initialize` request and hands the connection to the game's own
language server, or a Loominate IF checkout's.
"""

try:
    from LSP.plugin import AbstractPlugin, register_plugin, unregister_plugin
except ImportError:  # The LSP package isn't installed: highlighting still works.
    AbstractPlugin = None


if AbstractPlugin is not None:

    class Loominate(AbstractPlugin):
        @classmethod
        def name(cls) -> str:
            return "LSP-loominate"

    def plugin_loaded() -> None:
        register_plugin(Loominate)

    def plugin_unloaded() -> None:
        unregister_plugin(Loominate)
