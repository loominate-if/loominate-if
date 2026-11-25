//! The Zed extension for Loominate IF (#411, ADR 0119): `.weft` files, with the
//! language server (#148) the game itself depends on.

use std::fs;
use zed_extension_api::{self as zed, LanguageServerId, Result};

/// The language server's package, and its entry inside a `node_modules`.
const PACKAGE: &str = "@loominate-if/language-server";
const ENTRY: &str = "node_modules/@loominate-if/language-server/dist/bin.js";

/// The launcher that picks which server to run, in Node, which sees the real file system.
const LAUNCHER: &str = include_str!("launcher.mjs");

struct Loominate;

impl Loominate {
    /// True if the opened folder has a server of its own: the game's, or a Loominate IF
    /// checkout's. The launcher checks again, as Zed may not show this extension ignored files.
    fn has_own(worktree: &zed::Worktree) -> bool {
        [
            format!("node_modules/{PACKAGE}/package.json"),
            "packages/language-server/package.json".to_string(),
        ]
        .iter()
        .any(|path| worktree.read_text_file(path).is_ok())
    }

    /// The latest release from npm, installed into the extension's own folder, if there is one.
    fn from_npm(id: &LanguageServerId) -> Option<String> {
        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let version = zed::npm_package_latest_version(PACKAGE).ok()?;
        if zed::npm_package_installed_version(PACKAGE).ok()?.as_deref() != Some(version.as_str()) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(PACKAGE, &version).ok()?;
        }
        Some(Self::here(ENTRY).ok()?)
    }

    /// A path in the extension's own folder.
    fn here(path: &str) -> Result<String> {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
            .to_string_lossy()
            .into_owned())
    }
}

impl zed::Extension for Loominate {
    fn new() -> Self {
        Loominate
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let installed = if Self::has_own(worktree) {
            String::new()
        } else {
            Self::from_npm(id).unwrap_or_default()
        };
        fs::write("launcher.mjs", LAUNCHER).map_err(|e| e.to_string())?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                Self::here("launcher.mjs")?,
                worktree.root_path(),
                installed,
                "--stdio".into(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(Loominate);
