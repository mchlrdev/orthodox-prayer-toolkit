// Parts of the UI are wired up step by step; remove once all are used.
#![allow(dead_code)]

mod actions;
mod app;
mod app_settings;
mod dialogs;
mod editor;
mod find;
mod outline;
mod screens;
mod state;
mod theme;
mod update;
mod updates;

use std::borrow::Cow;
use std::sync::{Arc, Mutex};

use gpui_kit::*;
use prayer_app::prefs::{APP_NAME, ColorScheme, Prefs};

use app::Root;
use theme::Palette;
use update::{Channel, Updater};
use updates::Updates;

/// The bundled prayer text font (Noto Serif, OFL).
const FONTS: [&[u8]; 4] = [
    include_bytes!("../assets/fonts/NotoSerif-Regular.ttf"),
    include_bytes!("../assets/fonts/NotoSerif-Italic.ttf"),
    include_bytes!("../assets/fonts/NotoSerif-Bold.ttf"),
    include_bytes!("../assets/fonts/NotoSerif-BoldItalic.ttf"),
];

/// Applies Light / Dark / System to our palette and the component theme.
pub fn apply_appearance(scheme: ColorScheme, window: Option<&mut Window>, cx: &mut App) {
    let dark = match scheme {
        ColorScheme::Light => false,
        ColorScheme::Dark => true,
        ColorScheme::System => matches!(
            cx.window_appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ),
    };
    cx.set_global(if dark {
        Palette::dark()
    } else {
        Palette::light()
    });
    let mode = if dark {
        gpui_kit::component::ThemeMode::Dark
    } else {
        gpui_kit::component::ThemeMode::Light
    };
    gpui_kit::component::Theme::change(mode, window, cx);
    let accent: Hsla = cx.global::<Palette>().accent;
    let theme = gpui_kit::component::Theme::global_mut(cx);
    theme.primary = accent;
    theme.primary_hover = Palette::fade(accent, 0.9);
    theme.primary_active = Palette::fade(accent, 0.8);
    cx.refresh_windows();
}

fn main() {
    // Must run before any UI: Velopack uses the first run after an update to
    // finish installing, then exits.
    velopack::VelopackApp::build().run();

    let channel = Channel::of_version(env!("CARGO_PKG_VERSION"));
    let updater = Arc::new(Mutex::new(Updater::new(channel)));

    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.text_system()
                .add_fonts(FONTS.iter().map(|f| Cow::Borrowed(*f)).collect())
                .expect("bundled fonts load");
            actions::bind_keys(cx);
            editor::bind_keys(cx);
            apply_appearance(Prefs::load().color_scheme, None, cx);
            cx.on_action(|_: &actions::Quit, cx| cx.quit());

            let options = WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some(APP_NAME.into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::centered(size(px(1280.), px(840.)), cx)),
                window_min_size: Some(size(px(400.), px(400.))),
                ..Default::default()
            };
            let updater = updater.clone();
            gpui_kit::open_window(options, cx, move |window, cx| {
                let updates = cx.new(|cx| Updates::new(updater.clone(), cx));
                cx.new(|cx| Root::new(updates, window, cx))
            })
            .expect("failed to open window");
            cx.activate(true);
        });
}
