# 3D 团队空间候选 · Design QA

## Scope

- Source: `assets/team-diorama/reference-front.png`
- Hidden-side reference: `assets/team-diorama/reference-turnaround.png`
- Implementation: `index-team-diorama-7f3a.html`
- Renderer: `assets/team-diorama/viewer.js`
- Model: `assets/team-diorama/team-workspace.glb`
- Formal homepage isolation: `index.html` was not changed.

## Visual review

- Desktop viewport: 1440 × 1000 at device scale factor 1.
- Tablet viewport: 1024 × 768 at device scale factor 1.
- Mobile viewport: 390 × 844 at device scale factor 1.
- Source/implementation comparison: system temporary directory, `$TMPDIR/moebius-diorama-final-comparison.jpg`.
- Desktop evidence: system temporary directory, `$TMPDIR/moebius-diorama-1440x1000-final-desktop.png`.
- Mobile evidence: system temporary directory, `$TMPDIR/moebius-diorama-390x844-final-mobile.png`.
- Focused mobile information-region evidence: system temporary directory, `$TMPDIR/moebius-mobile-bottom.png`.

The final pass preserves the source composition: circular stone platform, six perimeter workstations, six color-coded members, central conversation screen, lamps, planters, stairs, rocks and hanging greenery. The custom renderer adds orthographic presentation, ACES tone mapping, VSM shadows, screen-space ambient occlusion and restrained bloom.

## Comparison history

1. Pass 1 failed because imported animation tracks collapsed members into the center and the camera was too close.
2. Pass 2 restored layout but the default viewer made materials flat and the user rejected the visual quality.
3. Pass 4 failed because lamp and centerpiece emission caused severe clipping and erased material colors.
4. Passes 5–9 reduced emission, rebuilt the lighting stack, enlarged the cast, added workstation walls and planters, added clothing and furniture detail, restored the central chat glyph, added vines and tall plants, and matched the source framing more closely.

## Interaction and responsive checks

- Six accessible member buttons are visible and update the role card.
- Selecting Leader Agent returns `04 / LEAD`, updates `aria-pressed`, and moves the camera focus.
- Dragging the canvas changed projected hotspot coordinates, confirming orbit interaction.
- Reset restores the team overview and default camera.
- The source-reference dialog opens and closes.
- Camera rotation, polar angle and zoom are bounded.
- Mobile member targets retain a 44 × 44 px interactive area.
- Mobile information regions have a 17.7 px gap after the overlap fix.
- No horizontal overflow at 390, 1024 or 1440 px.
- WebGL failure and no-script states retain the static source poster.
- Reduced-motion CSS is present.
- Browser console errors in the final pass: none.

## Residual differences

The source is a dense offline illustration, while this medium-cost candidate uses a 2.04 MiB real-time GLB optimized for browser rotation. Fine sculpting, baked texture maps and hand-authored foliage remain the boundary between this candidate and the high-cost production option; they are not blocking defects for the selected medium scope.

## Result

passed
