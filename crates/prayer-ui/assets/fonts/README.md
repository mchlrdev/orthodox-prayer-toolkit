# Prayer text font

Noto Serif (SIL Open Font License 1.1, see `OFL.txt`), chosen in
`docs/wayfinder/gpui-rewrite/issues/12-prayer-font.md` because it covers
Latin, Church Slavonic (including titlo and the combining marks) and
polytonic Greek.

The files are static instances of the variable font (`wght` 400/700,
`wdth` 100), made with fontTools so every platform gets the same styles:

```
fonttools varLib.instancer NotoSerif.ttf wght=400 wdth=100 --update-name-table -o NotoSerif-Regular.ttf
fonttools varLib.instancer NotoSerif.ttf wght=700 wdth=100 --update-name-table -o NotoSerif-Bold.ttf
fonttools varLib.instancer NotoSerif-Italic.ttf wght=400 wdth=100 --update-name-table -o NotoSerif-Italic.ttf
fonttools varLib.instancer NotoSerif-Italic.ttf wght=700 wdth=100 --update-name-table -o NotoSerif-BoldItalic.ttf
```
