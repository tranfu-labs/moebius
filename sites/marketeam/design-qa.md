# 3D 团队空间候选 · Design QA

## Scope

- Source: `assets/team-diorama/reference-front.png`
- Hidden-side reference: `assets/team-diorama/reference-turnaround.png`
- Precision detail reference: `assets/team-diorama/reference-detail-sheet-v2.png`
- Implementation: `index-team-diorama-7f3a.html`
- Renderer: `assets/team-diorama/viewer.js`
- Model: `assets/team-diorama/team-workspace.glb`
- Formal homepage isolation: `index.html` was not changed.

## Evidence and normalization

- Source truth: `assets/team-diorama/reference-front.png`, 1254 × 1254 px.
- Hidden-side source: `assets/team-diorama/reference-turnaround.png`, 1254 × 1254 px.
- GPT Image precision sheet: `assets/team-diorama/reference-detail-sheet-v2.png`, 1254 × 1254 px. It preserves the authoritative front layout and supplies rear, side, character, workstation and cliff detail.
- Desktop implementation: `/tmp/moebius-diorama-80-final-proof.jpg`, 1440 × 1000 px from a 1440 × 1000 CSS viewport at device pixel ratio 1.
- Mobile implementation: `/tmp/moebius-diorama-80-final-mobile.jpg`, 390 × 844 px from a 390 × 844 CSS viewport at device pixel ratio 1.
- Full-view comparison: `/tmp/moebius-diorama-80-source-compare.png`, 2000 × 1000 px. The desktop render was center-cropped to 1000 × 1000 and placed beside a 1000 × 1000 normalization of the source.
- Earlier focused topology evidence: `/tmp/moebius-diorama-topology-focus.png`, 1080 × 864 px.
- State: default camera, dark theme, no role selected, model fully loaded.

The 80% pass preserves the source composition: circular stone platform, six perimeter workstations, six color-coded members, central conversation screen, lamps, planters, stairs, rocks and hanging greenery. The custom renderer uses orthographic presentation, ACES tone mapping, a room-light environment, adaptive 2K/4K VSM shadows, screen-space ambient occlusion, restrained bloom, high-DPI post-processing and SMAA.

## Comparison history

1. Pass 1 failed because imported animation tracks collapsed members into the center and the camera was too close.
2. Pass 2 restored layout but the default viewer made materials flat and the user rejected the visual quality.
3. Pass 4 failed because lamp and centerpiece emission caused severe clipping and erased material colors.
4. Passes 5–9 reduced emission, rebuilt the lighting stack, enlarged the cast, added workstation walls and planters, added clothing and furniture detail, restored the central chat glyph, added vines and tall plants, and matched the source framing more closely.
5. The user then identified edge burrs, faceted topology and insufficient precision. The baseline used two-segment rounded boxes, 10–18 segment character primitives and post-processing at one CSS pixel.
6. The topology pass increased rounded-box, sphere, cylinder, torus and platform subdivisions; added SMAA and renderer-matched post-processing density; replaced radial floor slices with irregular polygon paving; added five-spoke chair bases, smoother capsule arms, hat seams and cheek detail; randomized rock placement without bright protruding fragments; and corrected the six reference hairstyles.
7. The post-fix full-view and focused comparisons show continuous hat, head, chair and platform silhouettes without actionable stair-stepping or visible topology burrs.
8. The 80% pass used the GPT Image precision sheet to add garment panels, drawstrings, cuffs, pockets, larger readable faces, layered notebooks, page edges, chair supports, articulated downward-facing lamp shades, denser foliage and a segmented cliff rim.
9. A lighting iteration was rejected because combined ambient and environment light washed out the six accent colors. The final pass keeps local desk-light pools while restoring dark stone contrast and a readable central screen.
10. Repeated geometry was converted to GPU instances. The authored scene contains 1219 visible detail objects but exports as 342 mesh/instance surfaces, keeping the final GLB at 5.71 MiB.

## Required fidelity surfaces

- Fonts and typography: unchanged from the accepted candidate; hierarchy, weight, wrapping and small-label legibility remain stable at all three breakpoints.
- Spacing and layout rhythm: model framing, camera target, fixed controls and information-card spacing are unchanged. Mobile retains a 17.7 px gap between the stage label and member card.
- Colors and visual tokens: the original six station colors remain mapped to their source positions. Local point lights now create the pink, amber, lavender, mint and blue desk pools visible in the source without washing out the stone palette.
- Image quality and asset fidelity: the real-time GLB is now 5.71 MiB with 342 exported mesh/instance surfaces. Higher subdivisions, smooth leaf silhouettes, segmented rock courses, GPU instancing and SMAA remove the low-poly demo appearance while keeping a web-sized asset. Reference-specific blue beanie, orange cap, mint dark bun, lavender bun, cream short hair and pink beanie/ponytail silhouettes are retained.
- Copy and content: no product copy changed during the 80% precision pass.

## Weighted fidelity assessment

This is a visual-review score, not an automated similarity metric.

| Surface | Weight | Score |
| --- | ---: | ---: |
| Composition and spatial layout | 25% | 88% |
| Character silhouette and clothing detail | 25% | 78% |
| Furniture, lamps and small props | 20% | 81% |
| Color, local lighting and material depth | 20% | 80% |
| Plants, floor and cliff edge | 10% | 76% |
| **Weighted result** | **100%** | **80.7%** |

## Findings

- No actionable P0, P1 or P2 findings remain for the requested 80% real-time-web target.
- P3: the source still has more organic hair strands, cloth folds, leaf density and baked material variation. Those are the remaining gap between the current 80% pass and the high-cost 90% hand-authored asset path.

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

## Implementation checklist

- [x] Remove low-segment rounded-box and character faceting.
- [x] Add screen-space antialiasing and high-DPI post-processing.
- [x] Replace radial floor topology with irregular polygon paving.
- [x] Correct reference-specific hats and hairstyles.
- [x] Add chair-base, clothing and facial micro-detail.
- [x] Rebuild lamps, notebooks, foliage and cliff courses from the precision reference.
- [x] Add local colored light pools without clipping the center screen.
- [x] Instance repeated geometry to preserve real-time web performance.
- [x] Recheck desktop/mobile loading, interaction and console output.

final result: passed
