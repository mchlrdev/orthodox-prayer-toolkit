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
    ]
);

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
