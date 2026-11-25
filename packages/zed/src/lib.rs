//! The Zed extension for Loominate IF (#411, ADR 0119): `.weft` files, with the
//! language server (#148) the game itself depends on.

use std::fs;
use zed_extension_api::{self as zed, LanguageServerId, Result};

/// The language server's package, and its entry, inside a `node_modules`.
const PACKAGE: &str = "@loominate-if/language-server";
const ENTRY: &str = "node_modules/@loominate-if/language-server/dist/bin.js";

struct Loominate {
    /// The entry of the copy this extension installed from npm, once it has.
    installed: Option<String>,
}

impl Loominate {
    /// The game's own copy, so its compiler matches the game's: `node_modules` at the root of
    /// the opened folder.
    fn games_own(worktree: &zed::Worktree) -> Option<String> {
        worktree
            .read_text_file(&format!("node_modules/{PACKAGE}/package.json"))
            .ok()
            .map(|_| format!("{}/{ENTRY}", worktree.root_path()))
    }

    /// A copy installed from npm into the extension's own folder, for games that don't
    /// depend on the server.
    fn from_npm(&mut self, id: &LanguageServerId) -> Result<String> {
        if let Some(entry) = &self.installed {
            if fs::metadata(entry).is_ok() {
                return Ok(entry.clone());
            }
        }
        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let version = zed::npm_package_latest_version(PACKAGE).map_err(|_| {
            format!(
                "Loominate IF: this folder has no {PACKAGE}. Install it in your game with \
                 `npm install --save-dev {PACKAGE}`, then open the game's folder."
            )
        })?;
        if zed::npm_package_installed_version(PACKAGE)?.as_deref() != Some(version.as_str()) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(PACKAGE, &version)?;
        }
        let entry = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(ENTRY)
            .to_string_lossy()
            .into_owned();
        self.installed = Some(entry.clone());
        Ok(entry)
    }
}

impl zed::Extension for Loominate {
    fn new() -> Self {
        Loominate { installed: None }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let entry = match Self::games_own(worktree) {
            Some(entry) => entry,
            None => self.from_npm(id)?,
        };
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![entry, "--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(Loominate);
