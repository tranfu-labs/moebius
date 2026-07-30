import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const candidatePath = resolve(
  root,
  "sites/marketeam/index-team-diorama-7f3a.html",
);
const modelPath = resolve(
  root,
  "sites/marketeam/assets/team-diorama/team-workspace.glb",
);
const viewerPath = resolve(
  root,
  "sites/marketeam/assets/team-diorama/viewer.js",
);

describe("marketing team diorama candidate", () => {
  it("keeps the formal homepage isolated from the 3D experiment", async () => {
    const formal = await readFile(resolve(root, "sites/marketeam/index.html"), "utf8");

    expect(formal).not.toContain("team-workspace.glb");
    expect(formal).not.toContain("index-team-diorama-7f3a");
  });

  it("ships six accessible hotspots and bounded camera controls", async () => {
    const html = await readFile(candidatePath, "utf8");
    const viewer = await readFile(viewerPath, "utf8");

    expect(html.match(/class="hotspot"/gu)).toHaveLength(6);
    expect(html).toContain('id="diorama-canvas"');
    expect(html).toContain("three@0.185.1");
    expect(html).toContain("./assets/team-diorama/viewer.js");
    expect(viewer).toContain("minAzimuthAngle = THREE.MathUtils.degToRad(-22)");
    expect(viewer).toContain("maxAzimuthAngle = THREE.MathUtils.degToRad(22)");
    expect(viewer).toContain("minPolarAngle = THREE.MathUtils.degToRad(48)");
    expect(viewer).toContain("maxPolarAngle = THREE.MathUtils.degToRad(64)");
    expect(viewer).toContain("UnrealBloomPass");
    expect(viewer).toContain("VSMShadowMap");
    expect(html).toContain("prefers-reduced-motion: reduce");
    expect(html).toContain("data-reference-dialog");
    expect(html).toContain('class="reference-poster"');
  });

  it("contains a valid compact binary glTF asset", async () => {
    const bytes = await readFile(modelPath);
    const modelStat = await stat(modelPath);

    expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(modelStat.size);
    expect(modelStat.size).toBeGreaterThan(500_000);
    expect(modelStat.size).toBeLessThan(4_000_000);
  });
});
