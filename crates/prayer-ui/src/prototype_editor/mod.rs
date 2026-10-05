//! PROTOTYPE — throwaway. Answers wayfinder ticket 02 (inline editor):
//! can GPUI edit a Block directly in its formatted form, with notes as
//! differently coloured runs, and feel like the Electron editor?
//!
//! Not production code: no persistence, no error handling, no polish.
//! Once the ticket is decided this module is captured on a `prototype/`
//! branch and removed here; the validated parts get rebuilt properly.
#![allow(dead_code)]

pub mod editor;
pub mod model;
