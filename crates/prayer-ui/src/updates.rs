//! Background updates: check at start, download right away, then only ask
//! for the restart (ticket 14).

use std::sync::{Arc, Mutex};

use gpui_kit::*;

use crate::update::{UpdateState, Updater};

pub struct Updates {
    pub updater: Arc<Mutex<Updater>>,
    pub state: UpdateState,
    pub busy: bool,
}

impl Updates {
    pub fn new(updater: Arc<Mutex<Updater>>, cx: &mut Context<Self>) -> Self {
        let state = UpdateState::Dev {
            version: updater.lock().unwrap().current_version().into(),
        };
        let mut this = Self {
            updater,
            state,
            busy: false,
        };
        this.check(cx);
        this
    }

    pub fn version(&self) -> String {
        self.updater.lock().unwrap().current_version().to_string()
    }

    /// Checks the feed; a found update is downloaded in the background.
    pub fn check(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        cx.notify();
        let updater = self.updater.clone();
        cx.spawn(async move |this, cx| {
            let state = cx
                .background_spawn(async move { updater.lock().unwrap().check() })
                .await;
            this.update(cx, |this, cx| {
                this.busy = false;
                let available = matches!(state, UpdateState::Available { .. });
                this.state = state;
                if available {
                    this.download(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn download(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        let updater = self.updater.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { updater.lock().unwrap().download(None) })
                .await;
            this.update(cx, |this, cx| {
                this.busy = false;
                this.state = match result {
                    Ok(state) => state,
                    Err(message) => UpdateState::Error {
                        version: this.version(),
                        message,
                    },
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn is_ready(&self) -> bool {
        matches!(self.state, UpdateState::Ready { .. })
    }

    /// Restarts into the new version (does not return on success).
    pub fn install(&mut self, cx: &mut Context<Self>) {
        let result = self.updater.lock().unwrap().install_and_restart();
        if let Err(message) = result {
            self.state = UpdateState::Error {
                version: self.version(),
                message,
            };
            cx.notify();
        }
    }

    pub fn status(&self) -> String {
        if self.busy {
            match self.state {
                UpdateState::Available { .. } => "Downloading update…".into(),
                _ => "Checking for updates…".into(),
            }
        } else {
            self.state.message()
        }
    }
}
