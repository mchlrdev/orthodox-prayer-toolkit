mod update;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use gpui_kit::*;
use update::{Channel, UpdateState, Updater};

const APP_NAME: &str = "Orthodox Prayer Toolkit Beta";

/// What a click on the one button does in the current state.
type UpdateAction = (&'static str, fn(&mut Root, &mut Context<Root>));

struct Root {
    updater: Arc<Mutex<Updater>>,
    state: UpdateState,
    busy: bool,
}

impl Root {
    fn new(updater: Arc<Mutex<Updater>>, cx: &mut Context<Self>) -> Self {
        let state = UpdateState::Dev {
            version: updater.lock().unwrap().current_version().into(),
        };
        let mut root = Self {
            updater,
            state,
            busy: false,
        };
        root.check(cx);
        root
    }

    /// The feed call blocks, so it runs on a background thread.
    fn check(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        let updater = self.updater.clone();
        cx.spawn(async move |this, cx| {
            let state = cx
                .background_spawn(async move { updater.lock().unwrap().check() })
                .await;
            this.update(cx, |this, cx| {
                this.state = state;
                this.busy = false;
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
            let (tx, _rx) = mpsc::channel();
            let state = cx
                .background_spawn(async move { updater.lock().unwrap().download(Some(tx)) })
                .await;
            this.update(cx, |this, cx| {
                this.state = match state {
                    Ok(state) => state,
                    Err(message) => UpdateState::Error {
                        version: this.updater.lock().unwrap().current_version().into(),
                        message,
                    },
                };
                this.busy = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn install(&mut self, _cx: &mut Context<Self>) {
        // Does not return when it succeeds: the app restarts into the new version.
        if let Err(message) = self.updater.lock().unwrap().install_and_restart() {
            self.state = UpdateState::Error {
                version: self.updater.lock().unwrap().current_version().into(),
                message,
            };
        }
    }
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let version = self.updater.lock().unwrap().current_version().to_string();

        // Placeholder shell: the editor UI follows in a later phase. What is real
        // here is the update path, so a tagged release can be installed end to end.
        let action: Option<UpdateAction> = match &self.state {
            _ if self.busy => None,
            UpdateState::Available { .. } => Some(("Download update", Root::download)),
            UpdateState::Ready { .. } => Some(("Install and Restart", Root::install)),
            _ => Some(("Check for updates", Root::check)),
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .child(APP_NAME)
            .child(format!("Version {version}"))
            .child(if self.busy {
                "Checking…".to_string()
            } else {
                self.state.message()
            })
            .children(action.map(|(label, handler)| {
                div()
                    .id("update-action")
                    .px_3()
                    .py_1()
                    .border_1()
                    .rounded_md()
                    .cursor_pointer()
                    .child(label)
                    .on_click(cx.listener(move |this, _, _, cx| handler(this, cx)))
            }))
    }
}

fn main() {
    // Must run before any UI: Velopack uses the first run after an update to
    // finish installing, then exits.
    velopack::VelopackApp::build().run();

    let channel = Channel::of_version(env!("CARGO_PKG_VERSION"));
    let updater = Arc::new(Mutex::new(Updater::new(channel)));

    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        let options = WindowOptions {
            titlebar: Some(TitlebarOptions {
                title: Some(APP_NAME.into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        gpui_kit::open_window(options, cx, |_, cx| {
            cx.new(|cx| Root::new(updater.clone(), cx))
        })
        .expect("failed to open window");
        cx.activate(true);
    });
}
