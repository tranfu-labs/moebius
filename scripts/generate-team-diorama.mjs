import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  scriptDir,
  "../sites/marketeam/assets/team-diorama/team-workspace.glb",
);

globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const palette = {
  stone: 0x433c39,
  stoneTop: 0x514845,
  stoneEdge: 0x342d2e,
  stoneLight: 0x605550,
  furniture: 0x584a44,
  furnitureEdge: 0x332c2b,
  skin: 0xd9955e,
  hair: 0x2e201a,
  cream: 0xe6d8bd,
  cloth: 0xbfb2a0,
  paper: 0xeadfc9,
  warm: 0xf4b55f,
  green: 0x49603d,
  leafDark: 0x2e442e,
  floorSeam: 0x443b39,
  stationAccents: [0xec8e9a, 0xa993d1, 0xe7c487, 0x8fc9ac, 0x79b7d8, 0xf0a54e],
  personAccents: [0xf0a54e, 0xec8e9a, 0xe7c487, 0xa993d1, 0x8fc9ac, 0x79b7d8],
};

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.78,
    metalness: options.metalness ?? 0.02,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    flatShading: options.flatShading ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
}

const materials = {
  stone: material(palette.stone, { roughness: 0.92 }),
  stoneTop: material(palette.stoneTop, { roughness: 0.86 }),
  stoneTopWarm: material(0x554b47, { roughness: 0.88 }),
  stoneTopCool: material(0x4e4643, { roughness: 0.9 }),
  stoneEdge: material(palette.stoneEdge, { roughness: 0.95 }),
  stoneLight: material(palette.stoneLight, { roughness: 0.9 }),
  rockFacet: material(0x3a3434, { roughness: 1, flatShading: true }),
  rockFacetLight: material(0x47403e, { roughness: 0.98, flatShading: true }),
  furniture: material(palette.furniture, { roughness: 0.8 }),
  furnitureEdge: material(palette.furnitureEdge, { roughness: 0.88 }),
  skin: material(palette.skin, { roughness: 0.74 }),
  skinLight: material(0xe3a371, { roughness: 0.76 }),
  hair: material(palette.hair, { roughness: 0.9 }),
  hairSoft: material(0x3a2820, { roughness: 0.92 }),
  cream: material(palette.cream, { roughness: 0.72 }),
  cloth: material(palette.cloth, { roughness: 0.86 }),
  paper: material(palette.paper, { roughness: 0.82 }),
  pageEdge: material(0xcbbfa9, { roughness: 0.9 }),
  leather: material(0x5b3828, { roughness: 0.82 }),
  metal: material(0x262324, { roughness: 0.52, metalness: 0.36 }),
  warm: material(palette.warm, {
    roughness: 0.62,
    emissive: palette.warm,
    emissiveIntensity: 0.2,
  }),
  screen: material(0xa56031, {
    roughness: 0.4,
    emissive: 0xf08b35,
    emissiveIntensity: 0.42,
  }),
  green: material(palette.green, { roughness: 0.94 }),
  leafDark: material(palette.leafDark, { roughness: 0.96 }),
  floorSeam: material(palette.floorSeam, { roughness: 0.96 }),
  eye: material(0x181313, { roughness: 0.8 }),
  cheek: material(0xc97572, { roughness: 0.82 }),
  contactShadow: material(0x171314, {
    roughness: 1,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
  }),
};

const stationAccentMaterials = palette.stationAccents.map((color) =>
  material(color, { roughness: 0.72 }),
);
const stationGlowMaterials = palette.stationAccents.map((color) =>
  material(color, {
    roughness: 0.42,
    emissive: color,
    emissiveIntensity: 0.5,
  }),
);
const personAccentMaterials = palette.personAccents.map((color) =>
  material(color, { roughness: 0.72 }),
);
const personAccentDarkMaterials = palette.personAccents.map((color) =>
  material(new THREE.Color(color).multiplyScalar(0.7).getHex(), {
    roughness: 0.78,
  }),
);

const geometryCache = new Map();

function cachedGeometry(key, create) {
  if (!geometryCache.has(key)) {
    geometryCache.set(key, create());
  }
  return geometryCache.get(key);
}

function roundedBoxGeometry(width, height, depth, radius = 0.08, segments = 4) {
  const key = `rounded:${width}:${height}:${depth}:${radius}:${segments}`;
  return cachedGeometry(
    key,
    () => new RoundedBoxGeometry(width, height, depth, segments, radius),
  );
}

function cylinderGeometry(radiusTop, radiusBottom, height, segments = 32) {
  const key = `cylinder:${radiusTop}:${radiusBottom}:${height}:${segments}`;
  return cachedGeometry(
    key,
    () =>
      new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        height,
        segments,
        1,
        false,
      ),
  );
}

function sphereGeometry(radius, widthSegments = 32, heightSegments = 20) {
  const key = `sphere:${radius}:${widthSegments}:${heightSegments}`;
  return cachedGeometry(
    key,
    () => new THREE.SphereGeometry(radius, widthSegments, heightSegments),
  );
}

function domeGeometry(radius) {
  const key = `dome:${radius}`;
  return cachedGeometry(
    key,
    () =>
      new THREE.SphereGeometry(
        radius,
        40,
        20,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
  );
}

function capsuleGeometry(radius, length) {
  const key = `capsule:${radius}:${length}`;
  return cachedGeometry(
    key,
    () => new THREE.CapsuleGeometry(radius, length, 8, 20),
  );
}

function torusGeometry(radius, tube, radialSegments = 12, tubularSegments = 72) {
  const key = `torus:${radius}:${tube}:${radialSegments}:${tubularSegments}`;
  return cachedGeometry(
    key,
    () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments),
  );
}

function circleGeometry(radius, segments = 48) {
  const key = `circle:${radius}:${segments}`;
  return cachedGeometry(
    key,
    () => new THREE.CircleGeometry(radius, segments),
  );
}

function icosahedronGeometry(radius, detail = 1) {
  const key = `icosahedron:${radius}:${detail}`;
  return cachedGeometry(
    key,
    () => new THREE.IcosahedronGeometry(radius, detail),
  );
}

function leafGeometry(width, length) {
  const key = `leaf:${width}:${length}`;
  return cachedGeometry(key, () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -length / 2);
    shape.bezierCurveTo(
      -width * 0.62,
      -length * 0.2,
      -width * 0.52,
      length * 0.24,
      0,
      length / 2,
    );
    shape.bezierCurveTo(
      width * 0.52,
      length * 0.24,
      width * 0.62,
      -length * 0.2,
      0,
      -length / 2,
    );
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.min(width * 0.1, 0.034),
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: Math.min(width * 0.045, 0.012),
      bevelThickness: Math.min(width * 0.05, 0.014),
      curveSegments: 8,
      steps: 1,
    });
    geometry.center();
    return geometry;
  });
}

function facetedRockGeometry(variant) {
  const normalizedVariant = variant % 12;
  const key = `faceted-rock:${normalizedVariant}`;
  return cachedGeometry(key, () => {
    const top = 0.38 + (normalizedVariant % 4) * 0.025;
    const bottom = 0.48 + ((normalizedVariant * 3) % 5) * 0.018;
    const sides = 7 + (normalizedVariant % 2);
    const geometry = new THREE.CylinderGeometry(top, bottom, 1, sides, 2, false);
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index);
      const phase = index * 1.91 + normalizedVariant * 0.77;
      const drift = Math.sin(phase) * 0.035 * (1 - Math.abs(y) * 0.7);
      position.setX(index, position.getX(index) + drift);
      position.setZ(index, position.getZ(index) + Math.cos(phase) * 0.03);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
}

function floorTileGeometry(radius, variant) {
  const key = `floor-tile:${radius}:${variant}`;
  return cachedGeometry(key, () => {
    const shape = new THREE.Shape();
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 + Math.PI / 6;
      const jitter = 0.9 + (((variant * 13 + index * 7) % 9) / 9) * 0.18;
      const x = Math.cos(angle) * radius * jitter;
      const y = Math.sin(angle) * radius * jitter;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.035,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.024,
      bevelThickness: 0.012,
      curveSegments: 1,
      steps: 1,
    });
    geometry.center();
    return geometry;
  });
}

function mesh(geometry, meshMaterial, options = {}) {
  const object = new THREE.Mesh(geometry, meshMaterial);
  object.position.set(...(options.position ?? [0, 0, 0]));
  object.rotation.set(...(options.rotation ?? [0, 0, 0]));
  object.scale.set(...(options.scale ?? [1, 1, 1]));
  object.name = options.name ?? "";
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function addContactShadow(parent, radius, position, opacityScale = 1) {
  const shadowMaterial = materials.contactShadow.clone();
  shadowMaterial.opacity *= opacityScale;
  const shadow = mesh(circleGeometry(radius), shadowMaterial, {
    position,
    rotation: [-Math.PI / 2, 0, 0],
    scale: [1.22, 0.84, 1],
  });
  shadow.castShadow = false;
  shadow.receiveShadow = false;
  shadow.renderOrder = 1;
  parent.add(shadow);
  return shadow;
}

function addRoundedBox(
  parent,
  dimensions,
  meshMaterial,
  position,
  rotation = [0, 0, 0],
  radius = 0.08,
  name = "",
) {
  const object = mesh(
    roundedBoxGeometry(...dimensions, radius),
    meshMaterial,
    { position, rotation, name },
  );
  parent.add(object);
  return object;
}

function addFloorSeam(parent, start, end) {
  const deltaX = end[0] - start[0];
  const deltaZ = end[1] - start[1];
  const length = Math.hypot(deltaX, deltaZ);
  const seam = mesh(
    roundedBoxGeometry(0.014, 0.012, length, 0.004, 1),
    materials.floorSeam,
    {
      position: [
        (start[0] + end[0]) / 2,
        0.435,
        (start[1] + end[1]) / 2,
      ],
      rotation: [0, Math.atan2(deltaX, deltaZ), 0],
    },
  );
  seam.castShadow = false;
  parent.add(seam);
}

function addCylinder(
  parent,
  radii,
  height,
  meshMaterial,
  position,
  rotation = [0, 0, 0],
  segments = 16,
  name = "",
) {
  const object = mesh(
    cylinderGeometry(radii[0], radii[1], height, segments),
    meshMaterial,
    { position, rotation, name },
  );
  parent.add(object);
  return object;
}

function createPlant(scale = 1, tall = false, withPot = true) {
  const plant = new THREE.Group();
  const soilTop = withPot ? 0.35 : 0.06;
  if (withPot) {
    addCylinder(
      plant,
      [0.22 * scale, 0.18 * scale],
      0.34 * scale,
      materials.furnitureEdge,
      [0, 0.17 * scale, 0],
      [0, 0, 0],
      20,
    );
    addCylinder(
      plant,
      [0.19 * scale, 0.17 * scale],
      0.04 * scale,
      materials.stoneTop,
      [0, 0.35 * scale, 0],
      [0, 0, 0],
      20,
    );
  }

  const stemHeight = (tall ? 0.82 : 0.5) * scale;
  addCylinder(
    plant,
    [0.025 * scale, 0.035 * scale],
    stemHeight,
    materials.leafDark,
    [0, soilTop * scale + stemHeight / 2, 0],
    [0, 0, 0],
    12,
  );

  const leafCount = tall ? 13 : 9;
  for (let index = 0; index < leafCount; index += 1) {
    const angle = (index / leafCount) * Math.PI * 2;
    const band = index % (tall ? 4 : 3);
    const height = tall
      ? (soilTop + 0.17 + band * 0.2) * scale
      : (soilTop + 0.1 + band * 0.11) * scale;
    const length = (tall ? 0.56 : 0.34) * scale * (0.92 + (index % 3) * 0.08);
    const width = (tall ? 0.23 : 0.175) * scale;
    const leaf = mesh(
      tall ? sphereGeometry(1, 28, 18) : leafGeometry(width, length),
      index % 2 ? materials.green : materials.leafDark,
      {
        position: [
          Math.sin(angle) * (tall ? 0.18 : 0.13) * scale,
          height,
          Math.cos(angle) * (tall ? 0.18 : 0.13) * scale,
        ],
        rotation: [
          Math.sin(angle) * 0.68,
          angle,
          Math.cos(angle) * 0.68,
        ],
        scale: tall
          ? [width * 0.58, length * 0.5, width * 0.18]
          : [1, 1, 1],
      },
    );
    plant.add(leaf);
  }
  return plant;
}

function createShrub(scale = 1) {
  const shrub = new THREE.Group();
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const radius = (index % 3) * 0.075 * scale;
    const leaf = mesh(
      leafGeometry(0.18 * scale, (0.32 + (index % 4) * 0.035) * scale),
      index % 3 === 0 ? materials.green : materials.leafDark,
      {
        position: [
          Math.sin(angle) * radius,
          (0.2 + (index % 4) * 0.055) * scale,
          Math.cos(angle) * radius,
        ],
        rotation: [
          Math.sin(angle) * 0.75,
          angle,
          Math.cos(angle) * 0.75,
        ],
      },
    );
    shrub.add(leaf);
  }
  for (const [x, y, z] of [
    [0, 0.18, 0],
    [-0.14, 0.16, 0.04],
    [0.14, 0.15, -0.03],
    [-0.1, 0.25, -0.11],
    [0.11, 0.26, 0.1],
    [0, 0.31, 0],
  ]) {
    shrub.add(
      mesh(
        icosahedronGeometry(0.14 * scale, 1),
        materials.leafDark,
        {
          position: [x * scale, y * scale, z * scale],
          scale: [1.04, 0.9, 1],
        },
      ),
    );
  }
  return shrub;
}

function createVine(scale = 1, length = 7) {
  const vine = new THREE.Group();
  addCylinder(
    vine,
    [0.018 * scale, 0.025 * scale],
    length * 0.17 * scale,
    materials.leafDark,
    [0, -(length * 0.17 * scale) / 2, 0],
    [0, 0, 0],
    10,
  );
  for (let index = 0; index < length; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const leaf = mesh(
      leafGeometry(0.16 * scale, 0.3 * scale),
      index % 3 === 0 ? materials.green : materials.leafDark,
      {
        position: [
          side * (0.05 + (index % 3) * 0.035) * scale,
          -index * 0.17 * scale,
          (index % 2) * 0.045 * scale,
        ],
        rotation: [0.08, side * 0.7, side * 0.62],
      },
    );
    vine.add(leaf);
  }
  return vine;
}

function createNotebook(accent, scale = 1, open = false) {
  const notebook = new THREE.Group();
  if (open) {
    for (const side of [-1, 1]) {
      addRoundedBox(
        notebook,
        [0.34 * scale, 0.035 * scale, 0.5 * scale],
        materials.pageEdge,
        [side * 0.18 * scale, 0, 0],
        [0, 0, side * 0.045],
        0.024 * scale,
      );
      addRoundedBox(
        notebook,
        [0.32 * scale, 0.018 * scale, 0.47 * scale],
        materials.paper,
        [side * 0.18 * scale, 0.028 * scale, 0],
        [0, 0, side * 0.045],
        0.02 * scale,
      );
    }
    addCylinder(
      notebook,
      [0.014 * scale, 0.014 * scale],
      0.47 * scale,
      accent,
      [0, 0.04 * scale, 0],
      [Math.PI / 2, 0, 0],
      10,
    );
  } else {
    addRoundedBox(
      notebook,
      [0.62 * scale, 0.055 * scale, 0.46 * scale],
      materials.pageEdge,
      [0, 0, 0],
      [0, 0, 0],
      0.03 * scale,
    );
    addRoundedBox(
      notebook,
      [0.65 * scale, 0.035 * scale, 0.48 * scale],
      accent,
      [0, 0.045 * scale, 0],
      [0, 0, 0],
      0.035 * scale,
    );
    addRoundedBox(
      notebook,
      [0.045 * scale, 0.08 * scale, 0.48 * scale],
      materials.leather,
      [-0.29 * scale, 0.035 * scale, 0],
      [0, 0, 0],
      0.015 * scale,
    );
  }
  return notebook;
}

function createDeskLamp(accentIndex) {
  const lamp = new THREE.Group();
  const accent = stationAccentMaterials[accentIndex];
  const glow = stationGlowMaterials[accentIndex];

  addCylinder(lamp, [0.24, 0.3], 0.08, accent, [0, 0.04, 0], [0, 0, 0], 32);
  addCylinder(lamp, [0.065, 0.065], 0.72, accent, [0, 0.42, 0], [0, 0, 0], 28);
  lamp.add(
    mesh(sphereGeometry(0.085, 20, 14), materials.metal, {
      position: [0, 0.72, 0],
    }),
  );
  addCylinder(
    lamp,
    [0.052, 0.052],
    0.42,
    accent,
    [0.18, 0.79, 0],
    [0, 0, Math.PI / 2],
    24,
  );
  lamp.add(
    mesh(sphereGeometry(0.072, 20, 14), materials.metal, {
      position: [0.39, 0.79, 0],
    }),
  );
  addCylinder(
    lamp,
    [0.045, 0.045],
    0.18,
    accent,
    [0.39, 0.69, 0],
    [0, 0, 0],
    24,
  );
  lamp.add(
    mesh(domeGeometry(0.23), accent, {
      position: [0.39, 0.55, 0],
      scale: [1, 0.72, 1],
    }),
  );
  const innerGlow = mesh(circleGeometry(0.18, 40), glow, {
    position: [0.39, 0.545, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  lamp.add(innerGlow);
  const bulb = mesh(sphereGeometry(0.075, 24, 16), glow, {
    position: [0.39, 0.51, 0],
  });
  lamp.add(bulb);
  lamp.add(
    mesh(sphereGeometry(0.055, 18, 12), accent, {
      position: [0.39, 0.81, 0],
    }),
  );

  const light = new THREE.PointLight(
    palette.stationAccents[accentIndex],
    3.2,
    1.75,
    2,
  );
  light.position.set(0.39, 0.49, 0);
  light.name = `DeskLampLight-${accentIndex + 1}`;
  lamp.add(light);
  return lamp;
}

function createWorkstation(index, angle) {
  const station = new THREE.Group();
  station.name = `Workstation-${index + 1}`;
  const accent = stationAccentMaterials[index];

  addRoundedBox(
    station,
    [3.1, 1.22, 0.3],
    materials.stoneLight,
    [0, 0.77, 0.82],
    [0, 0, 0],
    0.1,
  );
  addRoundedBox(
    station,
    [0.32, 1.02, 1.44],
    materials.stoneTop,
    [-1.4, 0.66, 0.23],
    [0, 0, 0],
    0.08,
  );
  addRoundedBox(
    station,
    [0.32, 1.02, 1.44],
    materials.stoneTop,
    [1.4, 0.66, 0.23],
    [0, 0, 0],
    0.08,
  );
  addRoundedBox(
    station,
    [2.82, 0.1, 0.34],
    materials.stoneEdge,
    [0, 1.42, 0.82],
    [0, 0, 0],
    0.045,
  );
  for (const x of [-1.04, 0, 1.04]) {
    addRoundedBox(
      station,
      [0.92, 0.16, 0.42],
      x === 0 ? materials.stoneTopWarm : materials.stoneTop,
      [x, 1.47 + (x === 0 ? 0.018 : 0), 0.82],
      [0, x * 0.018, 0],
      0.06,
    );
  }
  for (const x of [-1.4, 1.4]) {
    addRoundedBox(
      station,
      [0.42, 0.14, 0.72],
      materials.stoneTopWarm,
      [x, 1.19, 0.2],
      [0, 0, 0],
      0.06,
    );
  }

  addRoundedBox(
    station,
    [2.48, 0.18, 1.18],
    materials.furniture,
    [0, 0.88, 0],
    [0, 0, 0],
    0.08,
  );
  for (const x of [-1.02, 1.02]) {
    addRoundedBox(
      station,
      [0.18, 0.76, 0.82],
      materials.furnitureEdge,
      [x, 0.45, 0.04],
      [0, 0, 0],
      0.05,
    );
  }

  const primaryNotebook = createNotebook(accent, 1, index % 3 === 0);
  primaryNotebook.position.set(-0.16, 1.02, -0.06);
  primaryNotebook.rotation.y = 0.06;
  station.add(primaryNotebook);

  const stackedNotebook = createNotebook(accent, 0.72, false);
  stackedNotebook.position.set(0.58, 1.04, 0.3);
  stackedNotebook.rotation.y = -0.08;
  station.add(stackedNotebook);

  addRoundedBox(
    station,
    [0.5, 0.32, 0.035],
    materials.furnitureEdge,
    [0.55, 0.6, -0.59],
    [0, 0, 0],
    0.025,
  );
  addRoundedBox(
    station,
    [0.42, 0.03, 0.018],
    materials.stoneLight,
    [0.55, 0.6, -0.614],
    [0, 0, 0],
    0.008,
  );

  const lamp = createDeskLamp(index);
  lamp.position.set(-0.8, 0.99, 0.2);
  station.add(lamp);

  const deskPlant = createPlant(0.45, false);
  deskPlant.position.set(0.9, 0.98, -0.08);
  station.add(deskPlant);

  const chair = new THREE.Group();
  addContactShadow(chair, 0.72, [0, 0.012, 0], 0.72);
  addRoundedBox(chair, [0.78, 0.18, 0.68], accent, [0, 0.55, 0], [0, 0, 0], 0.12);
  addRoundedBox(chair, [0.78, 0.68, 0.16], accent, [0, 0.92, 0.28], [-0.1, 0, 0], 0.12);
  addRoundedBox(
    chair,
    [0.56, 0.42, 0.035],
    stationGlowMaterials[index],
    [0, 0.92, 0.18],
    [-0.1, 0, 0],
    0.025,
  );
  for (const x of [-0.28, 0.28]) {
    addRoundedBox(
      chair,
      [0.055, 0.48, 0.055],
      materials.metal,
      [x, 0.76, 0.22],
      [-0.1, 0, 0],
      0.018,
    );
  }
  addCylinder(chair, [0.07, 0.07], 0.48, materials.furnitureEdge, [0, 0.28, 0], [0, 0, 0], 24);
  addCylinder(chair, [0.14, 0.14], 0.08, materials.furnitureEdge, [0, 0.08, 0], [0, 0, 0], 28);
  for (let casterIndex = 0; casterIndex < 5; casterIndex += 1) {
    const casterAngle = (casterIndex / 5) * Math.PI * 2;
    addRoundedBox(
      chair,
      [0.075, 0.055, 0.37],
      materials.furnitureEdge,
      [Math.sin(casterAngle) * 0.17, 0.055, Math.cos(casterAngle) * 0.17],
      [0, casterAngle, 0],
      0.025,
    );
    chair.add(
      mesh(sphereGeometry(0.06, 16, 10), materials.eye, {
        position: [
          Math.sin(casterAngle) * 0.39,
          0.035,
          Math.cos(casterAngle) * 0.39,
        ],
        scale: [1, 0.62, 1],
      }),
    );
  }
  chair.position.set(0, 0, -1.04);
  station.add(chair);

  const planter = createPlant(index === 1 ? 1.05 : 0.72, index === 1);
  planter.position.set(1.13, 0.04, 0.92);
  station.add(planter);

  const sidePlanter = new THREE.Group();
  addRoundedBox(
    sidePlanter,
    [0.42, 0.42, 1.05],
    materials.stoneLight,
    [0, 0.2, 0],
    [0, 0, 0],
    0.07,
  );
  for (const z of [-0.31, 0, 0.31]) {
    const greenery = createPlant(0.54, false, false);
    greenery.position.set(0, 0.31, z);
    sidePlanter.add(greenery);
  }
  sidePlanter.position.set(-1.58, 0.08, 0.22);
  station.add(sidePlanter);

  addContactShadow(station, 1.55, [0, 0.215, -0.08], 0.56);
  station.position.set(Math.sin(angle) * 5.15, 0.22, Math.cos(angle) * 5.15);
  station.rotation.y = angle;
  return station;
}

function addFace(person, height) {
  const eyeY = height + 0.06;
  for (const x of [-0.105, 0.105]) {
    const eye = mesh(sphereGeometry(0.047, 18, 12), materials.eye, {
      position: [x, eyeY, -0.345],
      scale: [0.68, 1, 0.48],
    });
    person.add(eye);
  }
  const nose = mesh(sphereGeometry(0.045, 14, 10), materials.skin, {
    position: [0, height - 0.01, -0.37],
    scale: [0.75, 0.65, 0.85],
  });
  person.add(nose);
  for (const x of [-0.345, 0.345]) {
    person.add(
      mesh(sphereGeometry(0.07, 18, 12), materials.skinLight, {
        position: [x, height, -0.015],
        scale: [0.52, 0.84, 0.52],
      }),
    );
  }
  for (const x of [-0.16, 0.16]) {
    person.add(
      mesh(sphereGeometry(0.028, 12, 8), materials.cheek, {
        position: [x, height - 0.075, -0.374],
        scale: [1.2, 0.65, 0.45],
      }),
    );
  }
  addRoundedBox(
    person,
    [0.095, 0.014, 0.018],
    materials.hair,
    [0, height - 0.145, -0.382],
    [0, 0, 0],
    0.006,
  );
}

function addBeanie(person, accent, darkAccent, pom = true) {
  addCylinder(person, [0.34, 0.37], 0.18, accent, [0, 1.86, 0], [0, 0, 0], 40);
  const crown = mesh(sphereGeometry(0.34, 36, 22), accent, {
    position: [0, 1.95, 0],
    scale: [1, 0.72, 1],
  });
  person.add(crown);
  person.add(
    mesh(torusGeometry(0.355, 0.025, 12, 56), darkAccent, {
      position: [0, 1.84, 0],
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 1, 0.8],
    }),
  );
  for (const [x, z] of [
    [-0.18, -0.21],
    [0.18, -0.21],
    [-0.18, 0.21],
    [0.18, 0.21],
  ]) {
    person.add(
      mesh(capsuleGeometry(0.012, 0.2), darkAccent, {
        position: [x, 1.99, z],
        rotation: [z * 0.52, 0, -x * 0.52],
      }),
    );
  }
  if (pom) {
    person.add(
      mesh(sphereGeometry(0.11, 24, 16), accent, {
        position: [0, 2.18, 0],
        scale: [1.08, 0.95, 1.08],
      }),
    );
  }
}

function addCap(person, accent, darkAccent) {
  addCylinder(person, [0.34, 0.37], 0.14, accent, [0, 1.88, 0], [0, 0, 0], 40);
  const crown = mesh(sphereGeometry(0.34, 36, 22), accent, {
    position: [0, 1.95, 0.02],
    scale: [1, 0.66, 1],
  });
  person.add(crown);
  addRoundedBox(
    person,
    [0.39, 0.055, 0.22],
    accent,
    [0, 1.87, -0.35],
    [-0.08, 0, 0],
    0.035,
  );
  person.add(
    mesh(torusGeometry(0.35, 0.022, 12, 56), darkAccent, {
      position: [0, 1.86, 0.02],
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 1, 0.8],
    }),
  );
  person.add(
    mesh(sphereGeometry(0.045, 18, 12), darkAccent, {
      position: [0, 2.14, 0.01],
    }),
  );
}

function addHair(person, style, hairMaterial = materials.hair) {
  const back = mesh(sphereGeometry(0.36, 36, 22), hairMaterial, {
    position: [0, 1.72, 0.08],
    scale: [1.02, 1.05, 0.92],
  });
  person.add(back);
  for (let index = 0; index < 5; index += 1) {
    const x = (index - 2) * 0.115;
    person.add(
      mesh(sphereGeometry(0.105, 20, 14), hairMaterial, {
        position: [x, 1.88 - Math.abs(index - 2) * 0.018, -0.285],
        scale: [0.82, 0.78 + (index % 2) * 0.12, 0.48],
      }),
    );
  }
  for (const x of [-0.28, 0.28]) {
    person.add(
      mesh(capsuleGeometry(0.058, 0.2), hairMaterial, {
        position: [x, 1.64, -0.08],
        rotation: [0.08, 0, x > 0 ? -0.1 : 0.1],
      }),
    );
  }

  if (style === "bun") {
    person.add(
      mesh(sphereGeometry(0.18, 24, 16), hairMaterial, {
        position: [0, 1.93, 0.31],
      }),
    );
  } else if (style === "pony") {
    person.add(
      mesh(capsuleGeometry(0.1, 0.38), hairMaterial, {
        position: [0.18, 1.35, 0.2],
        rotation: [0.18, 0, -0.22],
      }),
    );
    person.add(
      mesh(sphereGeometry(0.085, 18, 12), hairMaterial, {
        position: [0.18, 1.57, 0.2],
      }),
    );
  }
}

function createPerson(index, angle) {
  const person = new THREE.Group();
  person.name = `Member-${index + 1}`;
  const accent = personAccentMaterials[index];
  const darkAccent = personAccentDarkMaterials[index];
  const positionRadius = index % 2 === 0 ? 2.05 : 2.2;

  addCylinder(person, [0.29, 0.33], 0.62, accent, [0, 1.08, 0], [0, 0, 0], 32);
  addRoundedBox(
    person,
    [0.48, 0.54, 0.42],
    materials.cloth,
    [0, 1.18, -0.1],
    [0, 0, 0],
    0.12,
  );
  for (const x of [-0.135, 0.135]) {
    addRoundedBox(
      person,
      [0.23, 0.48, 0.035],
      x < 0 ? accent : darkAccent,
      [x, 1.18, -0.325],
      [0, 0, 0],
      0.035,
    );
    addRoundedBox(
      person,
      [0.16, 0.11, 0.025],
      materials.cloth,
      [x, 1.02, -0.35],
      [0, 0, x * 0.24],
      0.025,
    );
  }
  addRoundedBox(
    person,
    [0.036, 0.42, 0.025],
    materials.furnitureEdge,
    [0, 1.18, -0.32],
    [0, 0, 0],
    0.01,
  );
  for (const x of [-0.08, 0.08]) {
    addCylinder(
      person,
      [0.012, 0.012],
      0.22,
      materials.furnitureEdge,
      [x, 1.34, -0.34],
      [0, 0, 0],
      10,
    );
    person.add(
      mesh(sphereGeometry(0.024, 12, 8), materials.furnitureEdge, {
        position: [x, 1.22, -0.34],
      }),
    );
  }
  person.add(
    mesh(torusGeometry(0.25, 0.045, 7, 24), accent, {
      position: [0, 1.43, -0.01],
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 0.72, 1],
    }),
  );
  person.add(
    mesh(capsuleGeometry(0.085, 0.37), accent, {
      position: [-0.35, 1.1, 0],
      rotation: [0, 0, -0.1],
    }),
  );
  person.add(
    mesh(capsuleGeometry(0.085, 0.37), accent, {
      position: [0.35, 1.1, 0],
      rotation: [0, 0, 0.1],
    }),
  );
  for (const x of [-0.35, 0.35]) {
    addCylinder(
      person,
      [0.096, 0.096],
      0.11,
      darkAccent,
      [x, 0.89, -0.005],
      [0, 0, 0],
      24,
    );
  }
  person.add(
    mesh(sphereGeometry(0.105, 24, 16), materials.skinLight, {
      position: [-0.36, 0.79, -0.02],
      scale: [0.86, 1.08, 0.82],
    }),
  );
  person.add(
    mesh(sphereGeometry(0.105, 24, 16), materials.skinLight, {
      position: [0.36, 0.79, -0.02],
      scale: [0.86, 1.08, 0.82],
    }),
  );

  for (const x of [-0.17, 0.17]) {
    addRoundedBox(
      person,
      [0.24, 0.54, 0.28],
      materials.furnitureEdge,
      [x, 0.46, 0],
      [0, 0, 0],
      0.09,
    );
    addRoundedBox(
      person,
      [0.19, 0.08, 0.25],
      materials.stoneEdge,
      [x, 0.28, -0.035],
      [0, 0, 0],
      0.04,
    );
    addRoundedBox(
      person,
      [0.29, 0.14, 0.42],
      materials.eye,
      [x, 0.15, -0.08],
      [0, 0, 0],
      0.08,
    );
    addRoundedBox(
      person,
      [0.3, 0.045, 0.38],
      materials.leather,
      [x, 0.08, -0.075],
      [0, 0, 0],
      0.025,
    );
  }

  const head = mesh(sphereGeometry(0.38, 40, 28), materials.skin, {
    position: [0, 1.7, 0],
    scale: [0.98, 1.02, 0.95],
  });
  person.add(head);
  addFace(person, 1.7);

  if (index === 0) {
    addCap(person, accent, darkAccent);
  } else if (index === 1 || index === 5) {
    addBeanie(person, accent, darkAccent, true);
  } else if (index === 2) {
    addHair(person, "short");
  } else if (index === 3) {
    addHair(person, "bun", darkAccent);
  } else {
    addHair(person, "bun");
  }

  addContactShadow(person, 0.48, [0, 0.16, 0.03], 0.86);
  person.position.set(
    Math.sin(angle) * positionRadius,
    0.25,
    Math.cos(angle) * positionRadius,
  );
  person.rotation.y = angle;
  person.scale.setScalar(1.2);
  return person;
}

function createPlatform() {
  const platform = new THREE.Group();
  platform.name = "CircularWorkspace";

  addCylinder(
    platform,
    [6.55, 6.9],
    1.25,
    materials.stoneEdge,
    [0, -0.52, 0],
    [0, 0, 0],
    96,
  );
  addCylinder(
    platform,
    [6.5, 6.55],
    0.34,
    materials.stoneTop,
    [0, 0.25, 0],
    [0, 0, 0],
    96,
  );
  platform.add(
    mesh(torusGeometry(6.36, 0.075, 10, 96), materials.stoneLight, {
      position: [0, 0.42, 0],
      rotation: [Math.PI / 2, 0, 0],
      name: "PlatformRim",
    }),
  );

  for (let index = 0; index < 42; index += 1) {
    const angleJitter = ((((index * 29) % 11) - 5) / 5) * 0.022;
    const angle = (index / 42) * Math.PI * 2 + angleJitter;
    const width = 0.88 + ((index * 17) % 7) * 0.045;
    const height = 0.92 + ((index * 13) % 5) * 0.1;
    const depth = 0.72 + ((index * 11) % 5) * 0.045;
    const radius = 6.66 + (((index * 7) % 5) - 2) * 0.045;
    const rock = mesh(
      facetedRockGeometry(index),
      index % 3 === 0 ? materials.rockFacetLight : materials.rockFacet,
      {
        position: [
          Math.sin(angle) * radius,
          -0.53 - ((index % 4) * 0.07),
          Math.cos(angle) * radius,
        ],
        rotation: [
          0.04 * ((index % 3) - 1),
          angle + angleJitter * 2,
          0.035 * ((index % 5) - 2),
        ],
        scale: [width, height, depth],
      },
    );
    platform.add(rock);
  }

  for (let index = 0; index < 34; index += 1) {
    const angle = (index / 34) * Math.PI * 2;
    const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));
    if (Math.abs(normalized) < 0.23) continue;
    addRoundedBox(
      platform,
      [0.74 + (index % 3) * 0.05, 0.22, 0.5],
      index % 4 === 0 ? materials.stoneTopWarm : materials.stoneLight,
      [Math.sin(angle) * 6.38, 0.3, Math.cos(angle) * 6.38],
      [0, angle, (index % 3 - 1) * 0.018],
      0.07,
    );
  }

  let tileIndex = 0;
  const floorMaterials = [
    materials.stoneTop,
    materials.stoneTopWarm,
    materials.stoneTopCool,
  ];
  for (let row = -3; row <= 3; row += 1) {
    for (let column = -3; column <= 3; column += 1) {
      const x = column * 1.78 + (Math.abs(row) % 2 ? 0.89 : 0);
      const z = row * 1.55;
      if (Math.hypot(x, z) > 5.72) continue;
      const tile = mesh(
        floorTileGeometry(1.04, tileIndex % 17),
        floorMaterials[tileIndex % floorMaterials.length],
        {
          position: [x, 0.445 + (tileIndex % 3) * 0.002, z],
          rotation: [-Math.PI / 2, (tileIndex % 5 - 2) * 0.008, 0],
          name: `FloorTile-${tileIndex + 1}`,
        },
      );
      tile.castShadow = false;
      platform.add(tile);
      tileIndex += 1;
    }
  }

  for (const [z, y, width] of [
    [6.25, 0.42, 2.1],
    [6.63, 0.25, 1.88],
    [7.0, 0.08, 1.62],
  ]) {
    addRoundedBox(
      platform,
      [width, 0.26, 0.54],
      materials.stoneLight,
      [0, y, z],
      [0, 0, 0],
      0.09,
    );
  }

  for (const degrees of [-142, -80, -24, 42, 104, 160]) {
    const angle = THREE.MathUtils.degToRad(degrees);
    const vine = createShrub(0.64);
    vine.position.set(Math.sin(angle) * 6.72, -0.2, Math.cos(angle) * 6.72);
    vine.rotation.z = Math.sin(angle) * 0.45;
    platform.add(vine);
  }

  for (const [x, z, rotation] of [
    [-4.65, 5.85, -0.24],
    [4.72, 5.78, 0.2],
    [-5.55, 3.72, -0.36],
    [5.68, 3.4, 0.32],
    [-3.08, 6.2, -0.18],
    [3.25, 6.15, 0.17],
  ]) {
    const cascade = createVine(0.86, 8);
    cascade.position.set(x, -0.1, z);
    cascade.rotation.z = rotation;
    platform.add(cascade);
  }

  return platform;
}

function createCenterpiece() {
  const center = new THREE.Group();
  center.name = "ConversationCore";
  addContactShadow(center, 1.22, [0, 0.432, 0], 1.08);
  addCylinder(center, [1.0, 1.08], 0.68, materials.stoneLight, [0, 0.58, 0], [0, 0, 0], 64);
  addCylinder(center, [1.06, 1.1], 0.1, materials.stoneTopCool, [0, 0.31, 0], [0, 0, 0], 64);
  center.add(
    mesh(torusGeometry(0.94, 0.045, 14, 80), materials.stoneTopWarm, {
      position: [0, 0.9, 0],
      rotation: [Math.PI / 2, 0, 0],
    }),
  );
  addCylinder(center, [0.9, 0.95], 0.12, materials.warm, [0, 0.96, 0], [0, 0, 0], 64);
  addRoundedBox(
    center,
    [0.28, 0.72, 0.28],
    materials.furnitureEdge,
    [0, 1.16, 0.22],
    [0.28, 0, 0],
    0.05,
  );

  const tablet = new THREE.Group();
  tablet.name = "ConversationTablet";
  addRoundedBox(
    tablet,
    [1.34, 0.19, 0.96],
    materials.furnitureEdge,
    [0, 0, 0],
    [0, 0, 0],
    0.12,
  );
  addRoundedBox(
    tablet,
    [1.1, 0.035, 0.74],
    materials.screen,
    [0, 0.11, 0],
    [0, 0, 0],
    0.09,
  );
  addRoundedBox(
    tablet,
    [0.98, 0.02, 0.62],
    stationGlowMaterials[5],
    [0, 0.135, 0],
    [0, 0, 0],
    0.075,
  );
  addRoundedBox(
    tablet,
    [0.48, 0.045, 0.28],
    materials.cream,
    [0, 0.158, -0.03],
    [0, 0, 0],
    0.08,
  );
  addRoundedBox(
    tablet,
    [0.13, 0.035, 0.13],
    materials.cream,
    [0.17, 0.16, 0.17],
    [0, Math.PI / 4, 0],
    0.025,
  );
  tablet.position.set(0, 1.55, 0.02);
  tablet.rotation.x = 0.7;
  center.add(tablet);

  const glow = new THREE.PointLight(0xffb354, 1.4, 3.5, 2);
  glow.position.set(0, 1.86, 0.2);
  glow.name = "ConversationGlow";
  center.add(glow);
  return { center, tablet };
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.name = "MoebiusTeamDiorama";
  scene.userData = {
    source: "GPT Image hidden-side turnaround plus supplied front reference",
    interaction: "limited orbit, zoom and six member hotspots",
    generatedBy: "scripts/generate-team-diorama.mjs",
  };

  const root = new THREE.Group();
  root.name = "TeamDiorama";
  root.add(createPlatform());

  const stationAngles = [-150, -90, -30, 30, 90, 150].map((degrees) =>
    THREE.MathUtils.degToRad(degrees),
  );
  stationAngles.forEach((angle, index) => root.add(createWorkstation(index, angle)));

  stationAngles.forEach((angle, index) => {
    const person = createPerson(index, angle);
    root.add(person);
  });

  const topPlant = createPlant(1.48, true);
  topPlant.position.set(0, 0.43, -5.35);
  root.add(topPlant);

  const leftPlant = createPlant(1.18, true);
  leftPlant.position.set(-5.72, 0.43, 0.55);
  root.add(leftPlant);

  for (const degrees of [-120, -60, 60, 120, 180]) {
    const angle = THREE.MathUtils.degToRad(degrees);
    const shrub = createShrub(0.94 + (Math.abs(degrees) % 90) * 0.002);
    shrub.position.set(Math.sin(angle) * 5.95, 0.42, Math.cos(angle) * 5.95);
    root.add(shrub);
  }

  const { center } = createCenterpiece();
  root.add(center);
  scene.add(root);

  return scene;
}

function optimizeSceneMeshes(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  const buckets = new Map();

  scene.traverse((object) => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    meshes.push(object);
    const key = [
      object.geometry.uuid,
      object.material.uuid,
      object.castShadow ? "cast" : "no-cast",
      object.receiveShadow ? "receive" : "no-receive",
      object.renderOrder,
    ].join(":");
    if (!buckets.has(key)) {
      buckets.set(key, {
        geometry: object.geometry,
        material: object.material,
        matrices: [],
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        renderOrder: object.renderOrder,
      });
    }
    buckets.get(key).matrices.push(object.matrixWorld.clone());
  });

  meshes.forEach((object) => object.parent?.remove(object));

  let instancedIndex = 0;
  for (const bucket of buckets.values()) {
    let surface;
    if (bucket.matrices.length === 1) {
      surface = new THREE.Mesh(bucket.geometry, bucket.material);
      surface.matrix.copy(bucket.matrices[0]);
      surface.matrix.decompose(surface.position, surface.quaternion, surface.scale);
    } else {
      surface = new THREE.InstancedMesh(
        bucket.geometry,
        bucket.material,
        bucket.matrices.length,
      );
      bucket.matrices.forEach((matrix, index) => surface.setMatrixAt(index, matrix));
      surface.instanceMatrix.needsUpdate = true;
    }
    surface.name = `DioramaSurface-${++instancedIndex}`;
    surface.castShadow = bucket.castShadow;
    surface.receiveShadow = bucket.receiveShadow;
    surface.renderOrder = bucket.renderOrder;
    scene.add(surface);
  }
}

const scene = buildScene();
optimizeSceneMeshes(scene);
const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, {
  binary: true,
  includeCustomExtensions: true,
  onlyVisible: true,
  trs: true,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, Buffer.from(result));

const stats = await fs.stat(outputPath);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      bytes: stats.size,
      mebibytes: Number((stats.size / 1024 / 1024).toFixed(2)),
      meshes: scene.getObjectsByProperty("isMesh", true).length,
      lights: scene.getObjectsByProperty("isLight", true).length,
      animations: 0,
    },
    null,
    2,
  ),
);
