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
  stone: 0x393331,
  stoneTop: 0x4b4340,
  stoneEdge: 0x2d2728,
  stoneLight: 0x5b504b,
  furniture: 0x50443f,
  furnitureEdge: 0x2c2626,
  skin: 0xd9955e,
  hair: 0x2e201a,
  cream: 0xe6d8bd,
  cloth: 0xbfb2a0,
  paper: 0xeadfc9,
  warm: 0xf4b55f,
  green: 0x49603d,
  leafDark: 0x2e442e,
  floorSeam: 0x403735,
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
  });
}

const materials = {
  stone: material(palette.stone, { roughness: 0.92 }),
  stoneTop: material(palette.stoneTop, { roughness: 0.86 }),
  stoneEdge: material(palette.stoneEdge, { roughness: 0.95 }),
  stoneLight: material(palette.stoneLight, { roughness: 0.9 }),
  furniture: material(palette.furniture, { roughness: 0.8 }),
  furnitureEdge: material(palette.furnitureEdge, { roughness: 0.88 }),
  skin: material(palette.skin, { roughness: 0.74 }),
  hair: material(palette.hair, { roughness: 0.9 }),
  cream: material(palette.cream, { roughness: 0.72 }),
  cloth: material(palette.cloth, { roughness: 0.86 }),
  paper: material(palette.paper, { roughness: 0.82 }),
  warm: material(palette.warm, {
    roughness: 0.62,
    emissive: palette.warm,
    emissiveIntensity: 0.36,
  }),
  screen: material(0xa56031, {
    roughness: 0.4,
    emissive: 0xf08b35,
    emissiveIntensity: 0.58,
  }),
  green: material(palette.green, { roughness: 0.94 }),
  leafDark: material(palette.leafDark, { roughness: 0.96 }),
  floorSeam: material(palette.floorSeam, { roughness: 0.96 }),
  eye: material(0x181313, { roughness: 0.8 }),
};

const stationAccentMaterials = palette.stationAccents.map((color) =>
  material(color, { roughness: 0.72 }),
);
const stationGlowMaterials = palette.stationAccents.map((color) =>
  material(color, {
    roughness: 0.42,
    emissive: color,
    emissiveIntensity: 0.65,
  }),
);
const personAccentMaterials = palette.personAccents.map((color) =>
  material(color, { roughness: 0.72 }),
);

const geometryCache = new Map();

function cachedGeometry(key, create) {
  if (!geometryCache.has(key)) {
    geometryCache.set(key, create());
  }
  return geometryCache.get(key);
}

function roundedBoxGeometry(width, height, depth, radius = 0.08) {
  const key = `rounded:${width}:${height}:${depth}:${radius}`;
  return cachedGeometry(
    key,
    () => new RoundedBoxGeometry(width, height, depth, 2, radius),
  );
}

function cylinderGeometry(radiusTop, radiusBottom, height, segments = 16) {
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

function sphereGeometry(radius, widthSegments = 16, heightSegments = 10) {
  const key = `sphere:${radius}:${widthSegments}:${heightSegments}`;
  return cachedGeometry(
    key,
    () => new THREE.SphereGeometry(radius, widthSegments, heightSegments),
  );
}

function capsuleGeometry(radius, length) {
  const key = `capsule:${radius}:${length}`;
  return cachedGeometry(
    key,
    () => new THREE.CapsuleGeometry(radius, length, 4, 10),
  );
}

function torusGeometry(radius, tube, radialSegments = 8, tubularSegments = 48) {
  const key = `torus:${radius}:${tube}:${radialSegments}:${tubularSegments}`;
  return cachedGeometry(
    key,
    () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments),
  );
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

function createPlant(scale = 1, tall = false) {
  const plant = new THREE.Group();
  addCylinder(
    plant,
    [0.22 * scale, 0.18 * scale],
    0.34 * scale,
    materials.furnitureEdge,
    [0, 0.17 * scale, 0],
    [0, 0, 0],
    12,
  );
  addCylinder(
    plant,
    [0.19 * scale, 0.17 * scale],
    0.04 * scale,
    materials.stoneTop,
    [0, 0.35 * scale, 0],
    [0, 0, 0],
    12,
  );

  const leafCount = tall ? 8 : 6;
  for (let index = 0; index < leafCount; index += 1) {
    const angle = (index / leafCount) * Math.PI * 2;
    const height = tall
      ? (0.45 + (index % 3) * 0.2) * scale
      : (0.43 + (index % 2) * 0.1) * scale;
    const leaf = mesh(
      sphereGeometry(tall ? 0.19 * scale : 0.14 * scale, 10, 6),
      index % 2 ? materials.green : materials.leafDark,
      {
        position: [
          Math.sin(angle) * 0.12 * scale,
          height,
          Math.cos(angle) * 0.12 * scale,
        ],
        rotation: [Math.sin(angle) * 0.42, angle, Math.cos(angle) * 0.42],
        scale: tall ? [0.58, 1.7, 0.42] : [0.75, 1.25, 0.55],
      },
    );
    plant.add(leaf);
  }
  return plant;
}

function createVine(scale = 1, length = 7) {
  const vine = new THREE.Group();
  for (let index = 0; index < length; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const leaf = mesh(
      sphereGeometry(0.12 * scale, 10, 6),
      index % 3 === 0 ? materials.green : materials.leafDark,
      {
        position: [
          side * (0.05 + (index % 3) * 0.035) * scale,
          -index * 0.17 * scale,
          (index % 2) * 0.045 * scale,
        ],
        rotation: [0.25, side * 0.55, side * 0.28],
        scale: [1.25, 0.62, 0.52],
      },
    );
    vine.add(leaf);
  }
  return vine;
}

function createDeskLamp(accentIndex) {
  const lamp = new THREE.Group();
  const accent = stationAccentMaterials[accentIndex];
  const glow = stationGlowMaterials[accentIndex];

  addCylinder(lamp, [0.24, 0.3], 0.08, accent, [0, 0.04, 0], [0, 0, 0], 16);
  addCylinder(lamp, [0.055, 0.055], 0.72, accent, [0, 0.42, 0], [0, 0, 0], 10);
  addCylinder(
    lamp,
    [0.045, 0.045],
    0.48,
    accent,
    [0.16, 0.77, 0],
    [0, 0, Math.PI / 2],
    10,
  );
  addCylinder(
    lamp,
    [0.2, 0.1],
    0.24,
    glow,
    [0.38, 0.74, 0],
    [0, 0, Math.PI / 2],
    16,
  );
  const bulb = mesh(sphereGeometry(0.09, 12, 8), glow, {
    position: [0.5, 0.72, 0],
  });
  lamp.add(bulb);

  const light = new THREE.PointLight(
    palette.stationAccents[accentIndex],
    0.42,
    1.75,
    2,
  );
  light.position.set(0.52, 0.68, 0);
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

  addRoundedBox(
    station,
    [0.78, 0.045, 0.56],
    accent,
    [-0.18, 0.995, -0.08],
    [0, 0.06, 0],
    0.035,
  );
  addRoundedBox(
    station,
    [0.64, 0.09, 0.38],
    materials.paper,
    [0.15, 1.04, 0.2],
    [0, -0.06, 0],
    0.03,
  );
  addRoundedBox(
    station,
    [0.52, 0.07, 0.32],
    accent,
    [0.52, 1.04, 0.31],
    [0, -0.08, 0],
    0.025,
  );

  const lamp = createDeskLamp(index);
  lamp.position.set(-0.8, 0.99, 0.2);
  station.add(lamp);

  const deskPlant = createPlant(0.45, false);
  deskPlant.position.set(0.9, 0.98, -0.08);
  station.add(deskPlant);

  const chair = new THREE.Group();
  addRoundedBox(chair, [0.78, 0.18, 0.68], accent, [0, 0.55, 0], [0, 0, 0], 0.12);
  addRoundedBox(chair, [0.78, 0.68, 0.16], accent, [0, 0.92, 0.28], [-0.1, 0, 0], 0.12);
  addCylinder(chair, [0.07, 0.07], 0.48, materials.furnitureEdge, [0, 0.28, 0], [0, 0, 0], 10);
  addCylinder(chair, [0.34, 0.34], 0.07, materials.furnitureEdge, [0, 0.04, 0], [0, 0, 0], 10);
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
    const greenery = createPlant(0.42, false);
    greenery.position.set(0, 0.38, z);
    sidePlanter.add(greenery);
  }
  sidePlanter.position.set(-1.58, 0.08, 0.22);
  station.add(sidePlanter);

  station.position.set(Math.sin(angle) * 5.15, 0.22, Math.cos(angle) * 5.15);
  station.rotation.y = angle;
  return station;
}

function addFace(person, height) {
  const eyeY = height + 0.06;
  for (const x of [-0.105, 0.105]) {
    const eye = mesh(sphereGeometry(0.035, 8, 6), materials.eye, {
      position: [x, eyeY, -0.286],
      scale: [0.72, 1, 0.55],
    });
    person.add(eye);
  }
  const nose = mesh(sphereGeometry(0.045, 8, 6), materials.skin, {
    position: [0, height - 0.01, -0.31],
    scale: [0.75, 0.65, 0.85],
  });
  person.add(nose);
}

function addBeanie(person, accent, pom = true) {
  addCylinder(person, [0.31, 0.34], 0.18, accent, [0, 1.86, 0], [0, 0, 0], 16);
  const crown = mesh(sphereGeometry(0.3, 16, 8), accent, {
    position: [0, 1.95, 0],
    scale: [1, 0.72, 1],
  });
  person.add(crown);
  if (pom) {
    person.add(
      mesh(sphereGeometry(0.105, 10, 7), accent, {
        position: [0, 2.18, 0],
      }),
    );
  }
}

function addCap(person, accent) {
  addCylinder(person, [0.31, 0.34], 0.14, accent, [0, 1.88, 0], [0, 0, 0], 16);
  const crown = mesh(sphereGeometry(0.3, 16, 8), accent, {
    position: [0, 1.95, 0.02],
    scale: [1, 0.66, 1],
  });
  person.add(crown);
  addRoundedBox(
    person,
    [0.34, 0.055, 0.2],
    accent,
    [0, 1.87, -0.3],
    [-0.08, 0, 0],
    0.035,
  );
}

function addHair(person, style) {
  const back = mesh(sphereGeometry(0.32, 16, 10), materials.hair, {
    position: [0, 1.72, 0.08],
    scale: [1.02, 1.05, 0.92],
  });
  person.add(back);

  if (style === "bun") {
    person.add(
      mesh(sphereGeometry(0.18, 12, 8), materials.hair, {
        position: [0, 1.91, 0.27],
      }),
    );
  } else if (style === "pony") {
    person.add(
      mesh(capsuleGeometry(0.1, 0.38), materials.hair, {
        position: [0.18, 1.35, 0.2],
        rotation: [0.18, 0, -0.22],
      }),
    );
  }
}

function createPerson(index, angle) {
  const person = new THREE.Group();
  person.name = `Member-${index + 1}`;
  const accent = personAccentMaterials[index];
  const positionRadius = index % 2 === 0 ? 2.05 : 2.2;

  addCylinder(person, [0.29, 0.33], 0.62, accent, [0, 1.08, 0], [0, 0, 0], 14);
  addRoundedBox(
    person,
    [0.48, 0.54, 0.42],
    materials.cloth,
    [0, 1.18, -0.1],
    [0, 0, 0],
    0.12,
  );
  addRoundedBox(
    person,
    [0.036, 0.42, 0.025],
    materials.furnitureEdge,
    [0, 1.18, -0.32],
    [0, 0, 0],
    0.01,
  );
  person.add(
    mesh(torusGeometry(0.25, 0.045, 7, 24), accent, {
      position: [0, 1.43, -0.01],
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 0.72, 1],
    }),
  );
  addRoundedBox(
    person,
    [0.14, 0.56, 0.17],
    accent,
    [-0.35, 1.1, 0],
    [0, 0, -0.1],
    0.07,
  );
  addRoundedBox(
    person,
    [0.14, 0.56, 0.17],
    accent,
    [0.35, 1.1, 0],
    [0, 0, 0.1],
    0.07,
  );
  person.add(
    mesh(sphereGeometry(0.105, 10, 7), materials.skin, {
      position: [-0.36, 0.79, -0.02],
    }),
  );
  person.add(
    mesh(sphereGeometry(0.105, 10, 7), materials.skin, {
      position: [0.36, 0.79, -0.02],
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
      [0.29, 0.14, 0.42],
      materials.eye,
      [x, 0.15, -0.08],
      [0, 0, 0],
      0.08,
    );
  }

  const head = mesh(sphereGeometry(0.34, 18, 12), materials.skin, {
    position: [0, 1.7, 0],
    scale: [0.96, 1.02, 0.93],
  });
  person.add(head);
  addFace(person, 1.7);

  if (index === 0 || index === 5) {
    addCap(person, accent);
  } else if (index === 1 || index === 4) {
    addBeanie(person, accent, true);
  } else if (index === 2) {
    addHair(person, "bun");
  } else {
    addHair(person, "pony");
  }

  person.position.set(
    Math.sin(angle) * positionRadius,
    0.25,
    Math.cos(angle) * positionRadius,
  );
  person.rotation.y = angle;
  person.scale.setScalar(1.12);
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
    48,
  );
  addCylinder(
    platform,
    [6.5, 6.55],
    0.34,
    materials.stoneTop,
    [0, 0.25, 0],
    [0, 0, 0],
    48,
  );
  platform.add(
    mesh(torusGeometry(6.36, 0.14, 8, 64), materials.stoneLight, {
      position: [0, 0.42, 0],
      rotation: [Math.PI / 2, 0, 0],
      name: "PlatformRim",
    }),
  );

  for (let index = 0; index < 36; index += 1) {
    const angle = (index / 36) * Math.PI * 2;
    const width = 0.72 + ((index * 17) % 7) * 0.04;
    const height = 0.82 + ((index * 13) % 5) * 0.08;
    const depth = 0.58 + ((index * 11) % 5) * 0.04;
    const rock = mesh(
      roundedBoxGeometry(width, height, depth, 0.16),
      index % 3 === 0 ? materials.stone : materials.stoneEdge,
      {
        position: [
          Math.sin(angle) * 6.62,
          -0.58 - ((index % 3) * 0.08),
          Math.cos(angle) * 6.62,
        ],
        rotation: [0.05 * (index % 2), angle, 0.03 * ((index % 3) - 1)],
      },
    );
    platform.add(rock);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    addRoundedBox(
      platform,
      [0.014, 0.014, 3.6],
      materials.floorSeam,
      [Math.sin(angle) * 3.7, 0.435, Math.cos(angle) * 3.7],
      [0, angle, 0],
      0.006,
    );
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
    const vine = createPlant(0.42, false);
    vine.position.set(Math.sin(angle) * 6.72, -0.2, Math.cos(angle) * 6.72);
    vine.rotation.z = Math.sin(angle) * 0.45;
    platform.add(vine);
  }

  for (const [x, z, rotation] of [
    [-4.65, 5.85, -0.24],
    [4.72, 5.78, 0.2],
    [-5.55, 3.72, -0.36],
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
  addCylinder(center, [1.0, 1.08], 0.68, materials.stoneLight, [0, 0.58, 0], [0, 0, 0], 32);
  addCylinder(center, [0.9, 0.95], 0.12, materials.warm, [0, 0.96, 0], [0, 0, 0], 32);
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
    [0.5, 0.04, 0.3],
    materials.cream,
    [0, 0.142, -0.03],
    [0, 0, 0],
    0.08,
  );
  addRoundedBox(
    tablet,
    [0.13, 0.035, 0.13],
    materials.cream,
    [0.18, 0.145, 0.18],
    [0, Math.PI / 4, 0],
    0.025,
  );
  tablet.position.set(0, 1.55, 0.02);
  tablet.rotation.x = 0.7;
  center.add(tablet);

  const glow = new THREE.PointLight(0xffb354, 0.58, 3.5, 2);
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

  const { center } = createCenterpiece();
  root.add(center);
  scene.add(root);

  return scene;
}

const scene = buildScene();
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
