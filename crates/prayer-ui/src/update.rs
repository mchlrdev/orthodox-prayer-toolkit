//! Auto-update against GitHub Releases.
//!
//! Mirrors the Electron app's `electron/updateCheck.ts`: the same five states,
//! so the UI copy and behaviour stay identical. Velopack replaces
//! `electron-updater`; beta builds read pre-releases, which is how the beta
//! stays separate from the Electron app's `v*` releases.

use std::sync::mpsc::Sender;

use velopack::sources::GithubSource;
use velopack::{UpdateCheck, UpdateManager, UpdateOptions, VelopackAsset};

const REPO_URL: &str = "https://github.com/mchlrdev/orthodox-prayer-toolkit";

/// Release channel this build updates from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Pre-releases (`gpui-v*`), used while the rewrite is in beta.
    Beta,
    /// Stable releases, used once the rewrite replaces the Electron app.
    Stable,
}

impl Channel {
    /// A version with a pre-release segment (`0.2.0-beta.1`) follows pre-releases;
    /// a plain version follows stable releases. So the build picks its own channel
    /// and a beta never offers a stable release, or the other way round.
    pub fn of_version(version: &str) -> Self {
        if version.contains('-') {
            Channel::Beta
        } else {
            Channel::Stable
        }
    }

    /// Beta builds take pre-releases; stable builds ignore them.
    fn prerelease(self) -> bool {
        self == Channel::Beta
    }
}

/// What a check found, mirroring `AppUpdateCheckResult` in the Electron app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateState {
    /// Not a packaged build; no feed is contacted.
    Dev {
        version: String,
    },
    UpToDate {
        version: String,
    },
    Available {
        version: String,
        latest: String,
    },
    /// Downloaded and waiting for a restart.
    Ready {
        version: String,
        latest: String,
    },
    Error {
        version: String,
        message: String,
    },
}

impl UpdateState {
    /// User-facing text, mirroring `updateStatusMessage`.
    pub fn message(&self) -> String {
        match self {
            UpdateState::Dev { .. } => "Update checks run only in the installed app.".into(),
            UpdateState::UpToDate { .. } => "You're up to date.".into(),
            UpdateState::Available { latest, .. } => format!("Version {latest} is available."),
            UpdateState::Ready { latest, .. } => format!("Version {latest} is ready to install."),
            UpdateState::Error { message, .. } => message.clone(),
        }
    }
}

/// Turns a raw check into a state. Pure, so the state machine is testable
/// without a packaged app or a network.
fn resolve_update_check(
    packaged: bool,
    current_version: &str,
    pending_version: Option<&str>,
    latest_version: Option<&str>,
    error_message: Option<&str>,
) -> UpdateState {
    let version = current_version.to_string();
    if !packaged {
        return UpdateState::Dev { version };
    }
    if let Some(message) = error_message {
        return UpdateState::Error {
            version,
            message: message.to_string(),
        };
    }
    if let Some(pending) = pending_version {
        return UpdateState::Ready {
            version,
            latest: pending.to_string(),
        };
    }
    match latest_version {
        Some(latest) if latest != version => UpdateState::Available {
            version,
            latest: latest.to_string(),
        },
        _ => UpdateState::UpToDate { version },
    }
}

/// Checks GitHub Releases, downloads in the background and installs on restart.
pub struct Updater {
    manager: Option<UpdateManager>,
    current_version: String,
    downloaded: Option<VelopackAsset>,
}

impl Updater {
    /// A dev build (`cargo run`) has no Velopack locator, so `UpdateManager`
    /// fails to construct. That is the `Dev` state, not an error.
    pub fn new(channel: Channel) -> Self {
        let source = GithubSource::new(REPO_URL, None, channel.prerelease());
        let manager = UpdateManager::new(source, None::<UpdateOptions>, None).ok();
        let current_version = manager
            .as_ref()
            .map(|m| m.get_current_version_as_string())
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
        Self {
            manager,
            current_version,
            downloaded: None,
        }
    }

    pub fn current_version(&self) -> &str {
        &self.current_version
    }

    /// Asks the feed what is available. Blocking, so callers run it off the UI thread.
    pub fn check(&self) -> UpdateState {
        let Some(manager) = &self.manager else {
            return resolve_update_check(false, &self.current_version, None, None, None);
        };

        let pending = manager
            .get_update_pending_restart()
            .map(|a| a.Version.clone());
        if pending.is_some() {
            return resolve_update_check(
                true,
                &self.current_version,
                pending.as_deref(),
                None,
                None,
            );
        }

        match manager.check_for_updates() {
            Ok(UpdateCheck::UpdateAvailable(info)) => resolve_update_check(
                true,
                &self.current_version,
                None,
                Some(&info.TargetFullRelease.Version),
                None,
            ),
            Ok(_) => resolve_update_check(true, &self.current_version, None, None, None),
            Err(err) => resolve_update_check(
                true,
                &self.current_version,
                None,
                None,
                Some(&err.to_string()),
            ),
        }
    }

    /// Downloads the available update; `progress` receives percentages.
    pub fn download(&mut self, progress: Option<Sender<i16>>) -> Result<UpdateState, String> {
        let manager = self
            .manager
            .as_ref()
            .ok_or("No update feed in a dev build")?;
        let UpdateCheck::UpdateAvailable(info) =
            manager.check_for_updates().map_err(|e| e.to_string())?
        else {
            return Ok(self.check());
        };
        manager
            .download_updates(&info, progress)
            .map_err(|e| e.to_string())?;
        let latest = info.TargetFullRelease.Version.clone();
        self.downloaded = Some(info.TargetFullRelease);
        Ok(UpdateState::Ready {
            version: self.current_version.clone(),
            latest,
        })
    }

    /// Installs a downloaded update and restarts. Does not return on success.
    pub fn install_and_restart(&self) -> Result<(), String> {
        let manager = self
            .manager
            .as_ref()
            .ok_or("No update feed in a dev build")?;
        let asset = self
            .downloaded
            .clone()
            .or_else(|| manager.get_update_pending_restart())
            .ok_or("No update has been downloaded")?;
        manager
            .apply_updates_and_restart(&asset)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpackaged_build_never_contacts_the_feed() {
        let state = resolve_update_check(false, "0.2.0", None, Some("0.3.0"), None);
        assert_eq!(
            state,
            UpdateState::Dev {
                version: "0.2.0".into()
            }
        );
        assert_eq!(
            state.message(),
            "Update checks run only in the installed app."
        );
    }

    #[test]
    fn error_wins_over_a_pending_update() {
        let state = resolve_update_check(true, "0.2.0", Some("0.3.0"), None, Some("offline"));
        assert_eq!(
            state,
            UpdateState::Error {
                version: "0.2.0".into(),
                message: "offline".into()
            }
        );
    }

    #[test]
    fn a_downloaded_update_reports_ready() {
        let state = resolve_update_check(true, "0.2.0", Some("0.3.0"), None, None);
        assert_eq!(state.message(), "Version 0.3.0 is ready to install.");
    }

    #[test]
    fn a_newer_release_reports_available() {
        let state = resolve_update_check(true, "0.2.0", None, Some("0.3.0"), None);
        assert_eq!(state.message(), "Version 0.3.0 is available.");
    }

    #[test]
    fn the_same_version_reports_up_to_date() {
        let state = resolve_update_check(true, "0.2.0", None, Some("0.2.0"), None);
        assert_eq!(
            state,
            UpdateState::UpToDate {
                version: "0.2.0".into()
            }
        );
    }

    #[test]
    fn beta_builds_take_prereleases() {
        assert!(Channel::Beta.prerelease());
        assert!(!Channel::Stable.prerelease());
    }

    #[test]
    fn the_version_picks_the_channel() {
        assert_eq!(Channel::of_version("0.2.0-beta.1"), Channel::Beta);
        assert_eq!(Channel::of_version("0.2.0"), Channel::Stable);
    }
}
