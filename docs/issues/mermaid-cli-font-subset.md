> 대상 저장소: mermaid-js/mermaid-cli (feature_request 양식). 아직 제출하지 않은 초안.
> 근거 측정: mmdc 12.0.0, Windows 11, 2026-10-12. 중복 검색("font embed", "no-font-embed", "svg size large", "Recursive font", "embedded font svg") 결과 관련 이슈 없음.

### Title

Embed only the `@font-face` subsets whose `unicode-range` covers characters used in the diagram

### Body

**Is your feature request related to a problem? Please describe.**

Since 12.0.0 (#1189, #1190), fonts are embedded into SVG output by default, and the default diagram font is Recursive. Recursive is shipped as four `@font-face` subsets split by `unicode-range`, and **all four are embedded regardless of which characters the diagram uses**:

| subset (`unicode-range` starts with) | size in the SVG |
|---|---|
| Latin (`U+0-FF, U+131, …`) | 74,814 chars |
| Latin Extended (`U+100-2BA, …`) | 68,341 chars |
| Vietnamese (`U+102-103, U+110-111, …`) | 16,520 chars |
| Cyrillic Extended (`U+460-52F, …`) | 2,933 chars |

Measured with the same three-node flowchart:

| diagram | default | `--no-font-embed` |
|---|---|---|
| `graph TD; A[Start] --> B{Check}; B --> C[End]` | 197,077 chars, 4 `@font-face` | 30,007 chars |
| same diagram with Korean labels (`시작`, `확인`, `끝`) | 197,069 chars, 4 `@font-face` | 29,999 chars |

- The Latin-only diagram needs just the Latin subset; the other three (~88 KB) are never used.
- The Korean diagram uses **none** of the four subsets — Hangul is outside every `unicode-range`, so the browser falls back to `arial, sans-serif` anyway — yet ~167 KB of font data is embedded.

A small diagram grows ~6.6× (30 KB → 197 KB). This matters for consumers with size limits; for example, we display mmdc SVGs in an app whose SVG element accepts at most 131,072 characters, so every diagram went over the limit after upgrading to 12.0.0.

**Describe the solution you'd like**

When embedding a font, keep only the `@font-face` rules whose `unicode-range` intersects the code points actually present in the rendered SVG's text (the diagram's labels). Rules without a `unicode-range` would be kept as today.

Expected result for the examples above: the Latin diagram embeds only the Latin subset (~105 KB total instead of ~197 KB), and the Korean diagram embeds nothing (~30 KB), with identical rendering to today.

**Describe alternatives you've considered**

- `--no-font-embed`: works and is documented in the 12.0.0 release notes, but drops the portability benefit of #1189 even for the subset that *is* used.
- Post-processing the SVG to remove `<style>` blocks containing `@font-face` (what we do now for display). Same trade-off as `--no-font-embed`, and fragile.
- Subsetting the font files to the exact glyphs used (e.g. with a font-subsetting library) would shrink output further, but `unicode-range` filtering seems much simpler and needs no new dependency.

**Additional context**

- mmdc 12.0.0 (`mmdc --version`), default config, `mmdc -i in.mmd -o out.svg`.
- Each embedded `@font-face` uses `font-family: "Recursive Variable"`, `font-weight: 300 1000`, a `data:font/woff2;base64,…` source and a `unicode-range`; the SVG's text uses `font-family: "Recursive Variable", arial, sans-serif`.
- Related: #1189 (embed fonts into SVG files), #1190 (add Recursive and OpenSans fonts), #474.
