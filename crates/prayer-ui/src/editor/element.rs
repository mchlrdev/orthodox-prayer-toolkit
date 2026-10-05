//! The element that lays out and paints one cell, and hands its layout back
//! to the editor for caret movement, hit testing and the IME.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::*;

use super::buffer::{Cell, RunKind};
use super::layout::{CellLayout, LayoutInput};
use super::style::CellStyle;
use super::{CellKey, Placed, PrayerEditor};

/// Caret and selection of the focused cell.
pub struct Caret {
    pub selection: Range<usize>,
    pub cursor: usize,
    pub marked: Option<Range<usize>>,
    /// The editor has keyboard focus (otherwise no caret is drawn).
    pub focused: bool,
}

pub struct CellElement {
    pub editor: Entity<PrayerEditor>,
    pub key: CellKey,
    pub cell: Cell,
    pub style: CellStyle,
    pub placeholder: SharedString,
    pub caret: Option<Caret>,
    pub highlights: Vec<(Range<usize>, Hsla)>,
    pub selection_color: Hsla,
    pub caret_color: Hsla,
    pub accent: Hsla,
    pub placeholder_color: Hsla,
}

type Measured = Rc<RefCell<Option<CellLayout>>>;

impl IntoElement for CellElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl CellElement {
    /// Colour of the glyph at byte `index`.
    fn color_at(&self, initial: Option<Range<usize>>) -> impl Fn(usize) -> Hsla + '_ {
        let ranges = self.cell.styled_ranges();
        move |index| {
            if initial.as_ref().is_some_and(|r| r.contains(&index)) {
                return self.accent;
            }
            let kind = ranges
                .iter()
                .find(|(r, _)| r.contains(&index))
                .map_or(RunKind::Text, |(_, k)| *k);
            match kind {
                RunKind::Text => self.style.color,
                RunKind::Note => self.style.note_color,
            }
        }
    }

    /// The liturgical initial: up to and including the first letter.
    fn initial(&self) -> Option<Range<usize>> {
        if !self.style.initial_cap {
            return None;
        }
        let text = self.cell.text();
        let (i, c) = text.char_indices().find(|(_, c)| c.is_alphanumeric())?;
        Some(0..i + c.len_utf8())
    }
}

impl Element for CellElement {
    type RequestLayoutState = Measured;
    type PrepaintState = Option<Rc<CellLayout>>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, Measured) {
        let text = self.cell.text().to_owned();
        let style = self.style.clone();
        let runs = vec![TextRun {
            len: text.len(),
            font: style.font.clone(),
            color: style.color,
            background_color: None,
            underline: None,
            strikethrough: None,
        }];
        let measured: Measured = Rc::new(RefCell::new(None));
        let out = measured.clone();
        let layout_style = Style {
            size: Size {
                width: relative(1.).into(),
                height: Length::Auto,
            },
            ..Style::default()
        };
        let id =
            window.request_measured_layout(layout_style, move |known, available, window, _| {
                let width = known
                    .width
                    .or(match available.width {
                        AvailableSpace::Definite(w) => Some(w),
                        _ => None,
                    })
                    .unwrap_or(px(600.));
                let layout = CellLayout::new(
                    LayoutInput {
                        text: &text,
                        runs: &runs,
                        font: &style.font,
                        font_size: style.font_size,
                        line_height: style.line_height,
                        align: style.align,
                        width,
                    },
                    window.text_system(),
                );
                let height = layout.height();
                *out.borrow_mut() = Some(layout);
                size(width, height)
            });
        (id, measured)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        measured: &mut Measured,
        _: &mut Window,
        cx: &mut App,
    ) -> Option<Rc<CellLayout>> {
        let layout = Rc::new(measured.borrow_mut().take()?);
        let key = self.key.clone();
        let placed = Placed {
            layout: layout.clone(),
            bounds,
        };
        self.editor.update(cx, |editor, _| {
            editor.layouts.insert(key, placed);
        });
        Some(layout)
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Measured,
        layout: &mut Option<Rc<CellLayout>>,
        window: &mut Window,
        cx: &mut App,
    ) {
        let Some(layout) = layout.clone() else { return };
        let origin = bounds.origin;
        let offset_rect = |r: Bounds<Pixels>| Bounds {
            origin: r.origin + origin,
            size: r.size,
        };

        if let Some(caret) = &self.caret {
            let focus = self.editor.read(cx).focus_handle.clone();
            window.handle_input(
                &focus,
                ElementInputHandler::new(bounds, self.editor.clone()),
                cx,
            );
            let _ = caret;
        }

        for (range, color) in &self.highlights {
            for rect in layout.range_rects(range.clone()) {
                window.paint_quad(fill(offset_rect(rect), *color));
            }
        }
        if let Some(caret) = &self.caret
            && !caret.selection.is_empty()
        {
            for rect in layout.range_rects(caret.selection.clone()) {
                window.paint_quad(fill(offset_rect(rect), self.selection_color));
            }
        }

        if self.cell.is_empty() {
            let runs = [TextRun {
                len: self.placeholder.len(),
                font: self.style.font.clone(),
                color: self.placeholder_color,
                background_color: None,
                underline: None,
                strikethrough: None,
            }];
            let line = window.text_system().shape_line(
                self.placeholder.clone(),
                self.style.font_size,
                &runs,
                None,
            );
            let x = match self.style.align {
                super::style::Align::Center => ((bounds.size.width - line.width) / 2.).max(px(0.)),
                _ => px(0.),
            };
            line.paint(
                origin + point(x, px(0.)),
                self.style.line_height,
                TextAlign::Left,
                None,
                window,
                cx,
            )
            .ok();
        } else {
            let initial = self.initial();
            layout.paint(origin, self.color_at(initial), window);
        }

        if let Some(caret) = &self.caret {
            if let Some(marked) = &caret.marked {
                for rect in layout.range_rects(marked.clone()) {
                    let r = offset_rect(rect);
                    window.paint_quad(fill(
                        Bounds::new(
                            point(r.left(), r.bottom() - px(3.)),
                            size(r.size.width, px(1.)),
                        ),
                        self.style.color,
                    ));
                }
            }
            if caret.focused && caret.selection.is_empty() {
                let p = layout.position_for_offset(caret.cursor);
                let height = layout.line_height;
                let inset = (height - (layout.ascent + layout.descent)) / 2. - px(1.);
                window.paint_quad(fill(
                    Bounds::new(
                        origin + point(p.x, p.y + inset.max(px(0.))),
                        size(px(1.5), height - inset.max(px(0.)) * 2.),
                    ),
                    self.caret_color,
                ));
            }
        }
    }
}
