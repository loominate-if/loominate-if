#!/bin/sh
# Installs Loominate IF support into BBEdit (#412): the language module, and the
# language server it starts. Run it again after updating this checkout.
set -e
here=$(cd "$(dirname "$0")" && pwd)
support="$HOME/Library/Application Support/BBEdit"
mkdir -p "$support/Language Modules" "$support/Language Servers"
cp "$here/Loominate IF.bbdlm" "$support/Language Modules/"
cp "$here/Language Servers/loominate-language-server" "$here/Language Servers/loominate-proxy.mjs" "$support/Language Servers/"
chmod +x "$support/Language Servers/loominate-language-server"
echo "Installed into $support. Quit and reopen BBEdit to load the language module."
