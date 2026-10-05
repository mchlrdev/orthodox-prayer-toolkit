//! Text layout of one cell: GPUI shapes and wraps the text, then we place
//! every glyph ourselves so lines can be centred or justified (GPUI's own
//! `TextAlign` has no justify), and so the caret, hit testing and painting
//! all use the same positions.

use std::ops::Range;

use gpui_kit::*;

use super::style::Align;

/// A glyph at its final x within the cell.
#[derive(Clone, Debug)]
pub struct PlacedGlyph {
    pub x: Pixels,
    /// Byte offset of the glyph's text in the cell.
    pub index: usize,
    pub font_id: FontId,
    pub id: GlyphId,
    pub emoji: bool,
}

/// One visual (possibly wrapped) line.
#[derive(Clone, Debug)]
pub struct VisualLine {
    /// Bytes of the cell text on this line (a hard line's `\n` is not part
    /// of any line).
    pub range: Range<usize>,
    pub top: Pixels,
    pub glyphs: Vec<PlacedGlyph>,
    /// Where a caret at `range.end` sits.
    pub end_x: Pixels,
    /// The line ends a hard line (text end or `\n`), rather than wrapping.
    pub hard_end: bool,
}

/// Layout of a cell's text, relative to the cell's origin.
#[derive(Clone, Debug, Default)]
pub struct CellLayout {
    pub lines: Vec<VisualLine>,
    pub line_height: Pixels,
    pub ascent: Pixels,
    pub descent: Pixels,
    pub font_size: Pixels,
    pub width: Pixels,
}

/// What to lay out.
pub struct LayoutInput<'a> {
    pub text: &'a str,
    pub runs: &'a [TextRun],
    pub font: &'a Font,
    pub font_size: Pixels,
    pub line_height: Pixels,
    pub align: Align,
    pub width: Pixels,
}

fn is_space(c: char) -> bool {
    c == ' ' || c == '\u{a0}'
}

impl CellLayout {
    pub fn new(input: LayoutInput<'_>, text_system: &WindowTextSystem) -> Self {
        let font_id = text_system.resolve_font(input.font);
        let ascent = text_system.ascent(font_id, input.font_size);
        let descent = text_system.descent(font_id, input.font_size);
        let mut layout = CellLayout {
            lines: Vec::new(),
            line_height: input.line_height,
            ascent,
            descent,
            font_size: input.font_size,
            width: input.width,
        };

        let shaped = if input.text.is_empty() {
            Default::default()
        } else {
            text_system
                .shape_text(
                    SharedString::from(input.text.to_owned()),
                    input.font_size,
                    input.runs,
                    Some(input.width),
                    None,
                )
                .unwrap_or_default()
        };

        let mut segment_start = 0;
        let mut top = px(0.);
        for wrapped in shaped.iter() {
            let segment_len = wrapped.len();
            let segment_text = &input.text[segment_start..segment_start + segment_len];
            layout.place_segment(
                &wrapped.unwrapped_layout,
                &wrapped.wrap_boundaries,
                segment_text,
                segment_start,
                &input,
                &mut top,
            );
            // Skip the `\n` between hard lines.
            segment_start += segment_len + 1;
        }
        if layout.lines.is_empty() {
            layout.lines.push(VisualLine {
                range: 0..0,
                top: px(0.),
                glyphs: Vec::new(),
                end_x: align_offset(input.align, input.width, px(0.), true),
                hard_end: true,
            });
        }
        layout
    }

    fn place_segment(
        &mut self,
        line: &LineLayout,
        wraps: &[WrapBoundary],
        text: &str,
        start: usize,
        input: &LayoutInput<'_>,
        top: &mut Pixels,
    ) {
        // All glyphs in order, with the visual line each starts.
        struct Raw {
            x: Pixels,
            index: usize,
            font_id: FontId,
            id: GlyphId,
            emoji: bool,
        }
        let mut visual: Vec<Vec<Raw>> = vec![Vec::new()];
        let mut wraps = wraps.iter().peekable();
        for (run_ix, run) in line.runs.iter().enumerate() {
            for (glyph_ix, glyph) in run.glyphs.iter().enumerate() {
                if wraps.peek() == Some(&&WrapBoundary { run_ix, glyph_ix }) {
                    wraps.next();
                    visual.push(Vec::new());
                }
                visual.last_mut().expect("one line").push(Raw {
                    x: glyph.position.x,
                    index: glyph.index,
                    font_id: run.font_id,
                    id: glyph.id,
                    emoji: glyph.is_emoji,
                });
            }
        }

        let count = visual.len();
        for (i, glyphs) in visual.iter().enumerate() {
            let last = i + 1 == count;
            let line_start = if i == 0 {
                0
            } else {
                glyphs.first().map_or(text.len(), |g| g.index)
            };
            let line_end = if last {
                text.len()
            } else {
                visual[i + 1].first().map_or(text.len(), |g| g.index)
            };
            let x0 = if i == 0 {
                px(0.)
            } else {
                glyphs.first().map_or(px(0.), |g| g.x)
            };
            let x_end = if last {
                line.width
            } else {
                visual[i + 1].first().map_or(line.width, |g| g.x)
            };
            // The end of each glyph is where the next one starts.
            let glyph_end = |k: usize| glyphs.get(k + 1).map_or(x_end, |g| g.x);
            let char_at = |index: usize| text[index..].chars().next().unwrap_or(' ');

            // Trailing spaces hang past the line and don't count.
            let visible_end = glyphs
                .iter()
                .rposition(|g| !char_at(g.index).is_whitespace())
                .map(|k| (k, glyph_end(k)));
            let visible_width = visible_end.map_or(px(0.), |(_, end)| end - x0);
            let spaces = visible_end.map_or(0, |(k, _)| {
                glyphs[..k]
                    .iter()
                    .filter(|g| is_space(char_at(g.index)))
                    .count()
            });

            let justify = input.align == Align::Justify && !last && spaces > 0;
            let extra = if justify {
                ((input.width - visible_width) / spaces as f32).max(px(0.))
            } else {
                px(0.)
            };
            let offset = if justify {
                px(0.)
            } else {
                align_offset(input.align, input.width, visible_width, true)
            };

            let mut placed = Vec::with_capacity(glyphs.len());
            let mut gaps = 0usize;
            for g in glyphs {
                placed.push(PlacedGlyph {
                    x: g.x - x0 + offset + extra * gaps as f32,
                    index: start + g.index,
                    font_id: g.font_id,
                    id: g.id,
                    emoji: g.emoji,
                });
                if is_space(char_at(g.index)) && gaps < spaces {
                    gaps += 1;
                }
            }
            self.lines.push(VisualLine {
                range: start + line_start..start + line_end,
                top: *top,
                glyphs: placed,
                end_x: x_end - x0 + offset + extra * gaps as f32,
                hard_end: last,
            });
            *top += input.line_height;
        }
    }

    pub fn height(&self) -> Pixels {
        (self.line_height * self.lines.len() as f32).max(self.line_height)
    }

    /// The visual line a caret at `offset` sits on.
    pub fn line_for_offset(&self, offset: usize) -> usize {
        self.lines
            .iter()
            .position(|l| offset < l.range.end || (offset == l.range.end && l.hard_end))
            .unwrap_or(self.lines.len().saturating_sub(1))
    }

    /// x of a caret at `offset` on line `line` (clamped into the line).
    pub fn x_in_line(&self, line: usize, offset: usize) -> Pixels {
        let l = &self.lines[line];
        if offset >= l.range.end {
            return l.end_x;
        }
        l.glyphs
            .iter()
            .find(|g| g.index >= offset)
            .map_or(l.end_x, |g| g.x)
    }

    /// Caret position (top-left of the caret) relative to the cell origin.
    pub fn position_for_offset(&self, offset: usize) -> Point<Pixels> {
        let line = self.line_for_offset(offset);
        point(self.x_in_line(line, offset), self.lines[line].top)
    }

    /// Offset nearest a point relative to the cell origin.
    pub fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        if self.lines.is_empty() {
            return 0;
        }
        let ix =
            ((position.y / self.line_height).floor().max(0.) as usize).min(self.lines.len() - 1);
        let line = &self.lines[ix];
        let mut best = (line.range.start, Pixels::MAX);
        let mut consider = |index: usize, x: Pixels| {
            let d = (x - position.x).abs();
            if d < best.1 {
                best = (index, d);
            }
        };
        for g in &line.glyphs {
            consider(g.index, g.x);
        }
        if line.hard_end || line.glyphs.is_empty() {
            consider(line.range.end, line.end_x);
        }
        best.0
    }

    /// Rectangles covering `range` (relative to the cell origin), one per
    /// visual line it touches.
    pub fn range_rects(&self, range: Range<usize>) -> Vec<Bounds<Pixels>> {
        let mut rects = Vec::new();
        for (ix, line) in self.lines.iter().enumerate() {
            // The `\n` after a hard line belongs to the selection too.
            let line_end = if line.hard_end && ix + 1 < self.lines.len() {
                line.range.end + 1
            } else {
                line.range.end
            };
            if range.end < line.range.start || range.start > line_end {
                continue;
            }
            if range.start == range.end || (range.end == line.range.start && ix > 0) {
                continue;
            }
            let x0 = self.x_in_line(ix, range.start.max(line.range.start));
            let mut x1 = if range.end >= line.range.end {
                line.end_x
            } else {
                self.x_in_line(ix, range.end)
            };
            if range.end > line.range.end && line.hard_end {
                // Show the selected line break as a little extra.
                x1 += self.font_size * 0.3;
            }
            if x1 > x0 {
                rects.push(Bounds::from_corners(
                    point(x0, line.top),
                    point(x1, line.top + self.line_height),
                ));
            }
        }
        rects
    }

    /// Baseline y of line `ix`, relative to the cell origin.
    pub fn baseline(&self, ix: usize) -> Pixels {
        let padding = (self.line_height - self.ascent - self.descent) / 2.;
        self.lines[ix].top + padding + self.ascent
    }

    /// Paints the glyphs; `color_at` gives the colour for a byte offset.
    pub fn paint(
        &self,
        origin: Point<Pixels>,
        color_at: impl Fn(usize) -> Hsla,
        window: &mut Window,
    ) {
        for (ix, line) in self.lines.iter().enumerate() {
            let y = origin.y + self.baseline(ix);
            for g in &line.glyphs {
                let at = point(origin.x + g.x, y);
                if g.emoji {
                    window.paint_emoji(at, g.font_id, g.id, self.font_size).ok();
                } else {
                    window
                        .paint_glyph(at, g.font_id, g.id, self.font_size, color_at(g.index))
                        .ok();
                }
            }
        }
    }
}

/// x where a line of `visible` width starts.
fn align_offset(align: Align, width: Pixels, visible: Pixels, _last: bool) -> Pixels {
    match align {
        Align::Center => ((width - visible) / 2.).max(px(0.)),
        Align::Left | Align::Justify => px(0.),
    }
}
