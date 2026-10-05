Type: grilling
Status: open
Blocked by: 01, 04

## Question

Wie ist die Rust-App geschnitten? Welche Crates (`prayer-core`, eine App-Logik-Crate, `prayer-ui`), wo leben Library catalog, Session draft, Dirty-Status und Undo, wie fließen Änderungen zwischen GPUI-Entities, und was bleibt UI-frei und damit ohne Fenster testbar? Dazu der Undo-Umfang: heute gibt es nur Browser-Undo pro Zelle (siehe Ticket 03); reicht das, oder bekommt die neue App ein Undo über Blocks und Strukturänderungen hinweg?
