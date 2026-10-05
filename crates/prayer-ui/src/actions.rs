//! App-wide actions and their key bindings (ticket 11: Cmd on macOS, Ctrl
//! elsewhere).

use gpui_kit::*;

actions!(
    prayer_toolkit,
    [
        Save,
        SaveAll,
        OpenLibrary,
        NewPrayer,
        OpenSettings,
        Undo,
        Redo,
        Find,
        FindReplace,
        FindNext,
        FindPrevious,
        CloseFind,
        CheckForUpdates,
        Quit,
        CloseWindow,
        ToggleLibrarySidebar,
        ToggleContentSidebar,
        ToggleFullScreen,
        About,
        Hide,
        HideOthers,
        ShowAll,
        OpenReleases,
    ]
);

pub const RELEASES_URL: &str = "https://github.com/mchlrdev/orthodox-prayer-toolkit/releases";

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("secondary-s", Save, None),
        KeyBinding::new("secondary-shift-s", SaveAll, None),
        KeyBinding::new("secondary-o", OpenLibrary, None),
        KeyBinding::new("secondary-n", NewPrayer, None),
        KeyBinding::new("secondary-,", OpenSettings, None),
        KeyBinding::new("secondary-z", Undo, None),
        KeyBinding::new("secondary-shift-z", Redo, None),
        KeyBinding::new("secondary-f", Find, None),
        KeyBinding::new("secondary-alt-f", FindReplace, None),
        KeyBinding::new("secondary-g", FindNext, None),
        KeyBinding::new("secondary-shift-g", FindPrevious, None),
        KeyBinding::new("f3", FindNext, None),
        KeyBinding::new("shift-f3", FindPrevious, None),
        KeyBinding::new("escape", CloseFind, None),
    ]);
    #[cfg(not(target_os = "macos"))]
    cx.bind_keys([KeyBinding::new("ctrl-y", Redo, None)]);
    #[cfg(target_os = "macos")]
    cx.bind_keys([
        KeyBinding::new("cmd-q", Quit, None),
        KeyBinding::new("cmd-w", CloseWindow, None),
    ]);
}

/// App-wide handlers that need no window.
pub fn register_global(cx: &mut App) {
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.on_action(|_: &Hide, cx| cx.hide());
    cx.on_action(|_: &HideOthers, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx| cx.unhide_other_apps());
    cx.on_action(|_: &OpenReleases, cx| cx.open_url(RELEASES_URL));
}

/// The native menu bar (macOS only; ticket 11: Windows and Linux have none,
/// everything there is reachable in the app). Compiled everywhere so CI
/// checks it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn set_menus(cx: &mut App) {
    use crate::editor;
    use prayer_app::prefs::APP_NAME;
    cx.set_menus([
        Menu::new(APP_NAME).items([
            MenuItem::action(format!("About {APP_NAME}"), About),
            MenuItem::action("Check for Updates…", CheckForUpdates),
            MenuItem::separator(),
            MenuItem::action("Settings…", OpenSettings),
            MenuItem::separator(),
            MenuItem::os_submenu("Services", SystemMenuType::Services),
            MenuItem::separator(),
            MenuItem::action(format!("Hide {APP_NAME}"), Hide),
            MenuItem::action("Hide Others", HideOthers),
            MenuItem::action("Show All", ShowAll),
            MenuItem::separator(),
            MenuItem::action(format!("Quit {APP_NAME}"), Quit),
        ]),
        Menu::new("File").items([
            MenuItem::action("New Prayer…", NewPrayer),
            MenuItem::action("Open Library…", OpenLibrary),
            MenuItem::separator(),
            MenuItem::action("Save", Save),
            MenuItem::action("Save All", SaveAll),
            MenuItem::separator(),
            MenuItem::action("Close Window", CloseWindow),
        ]),
        Menu::new("Edit").items([
            MenuItem::os_action("Undo", Undo, OsAction::Undo),
            MenuItem::os_action("Redo", Redo, OsAction::Redo),
            MenuItem::separator(),
            MenuItem::os_action("Cut", editor::Cut, OsAction::Cut),
            MenuItem::os_action("Copy", editor::Copy, OsAction::Copy),
            MenuItem::os_action("Paste", editor::Paste, OsAction::Paste),
            MenuItem::os_action("Select All", editor::SelectAll, OsAction::SelectAll),
            MenuItem::separator(),
            MenuItem::action("Find…", Find),
            MenuItem::action("Find and Replace…", FindReplace),
            MenuItem::action("Find Next", FindNext),
            MenuItem::action("Find Previous", FindPrevious),
        ]),
        Menu::new("View").items([
            MenuItem::action("Toggle Library Sidebar", ToggleLibrarySidebar),
            MenuItem::action("Toggle Content Sidebar", ToggleContentSidebar),
            MenuItem::separator(),
            MenuItem::action("Toggle Full Screen", ToggleFullScreen),
        ]),
        Menu::new("Help").items([
            MenuItem::action("Check for Updates…", CheckForUpdates),
            MenuItem::action("GitHub Releases", OpenReleases),
        ]),
    ]);
}
