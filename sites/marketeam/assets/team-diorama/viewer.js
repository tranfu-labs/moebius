import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const canvas = document.querySelector("#diorama-canvas");
const stage = document.querySelector("#scene");
const hotspotElements = [...document.querySelectorAll("[data-member]")];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const captureRequested = new URLSearchParams(location.search).has("capture");
const assetVersion = "80-precision-7";

const defaultCameraPosition = new THREE.Vector3(0, 9.1, 18.2);
const defaultTarget = new THREE.Vector3(0, 0.34, 0);
const focusTarget = defaultTarget.clone();
let cameraGoal = null;
let loadedScene = null;
let composer = null;
let renderer = null;
let camera = null;
let controls = null;
let capturedFrames = 0;

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: captureRequested,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x0d0c0d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0c0d);
  scene.fog = new THREE.FogExp2(0x0d0c0d, 0.014);
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  scene.environment = environmentGenerator.fromScene(roomEnvironment, 0.04).texture;
  scene.environmentIntensity = 0.3;
  roomEnvironment.dispose();
  environmentGenerator.dispose();

  const ambient = new THREE.AmbientLight(0x9b9395, 0.42);
  scene.add(ambient);

  const hemisphere = new THREE.HemisphereLight(0xfff0de, 0x1d181a, 0.72);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xffd9b3, 1.58);
  key.position.set(-7.5, 16.5, 10.5);
  key.castShadow = true;
  const shadowMapSize = matchMedia("(max-width: 760px)").matches ? 2048 : 4096;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 36;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.026;
  key.shadow.blurSamples = 16;
  key.shadow.radius = 4;
  scene.add(key);

  const coolFill = new THREE.DirectionalLight(0x93bee0, 0.34);
  coolFill.position.set(8, 5.5, 3);
  scene.add(coolFill);

  const rim = new THREE.DirectionalLight(0xe4a5d6, 0.28);
  rim.position.set(-3, 6, -9);
  scene.add(rim);

  return scene;
}

function buildCameraAndControls() {
  const aspect = Math.max(stage.clientWidth / stage.clientHeight, 0.5);
  const viewHeight = 13.9;
  camera = new THREE.OrthographicCamera(
    (-viewHeight * aspect) / 2,
    (viewHeight * aspect) / 2,
    viewHeight / 2,
    -viewHeight / 2,
    0.1,
    100,
  );
  camera.position.copy(defaultCameraPosition);
  camera.lookAt(defaultTarget);
  camera.zoom = 1;
  camera.updateProjectionMatrix();

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minAzimuthAngle = THREE.MathUtils.degToRad(-22);
  controls.maxAzimuthAngle = THREE.MathUtils.degToRad(22);
  controls.minPolarAngle = THREE.MathUtils.degToRad(48);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(64);
  controls.minZoom = 0.82;
  controls.maxZoom = 1.28;
  controls.zoomSpeed = 0.72;
  controls.rotateSpeed = 0.58;
  controls.target.copy(defaultTarget);
  controls.addEventListener("start", () => {
    cameraGoal = null;
    focusTarget.copy(controls.target);
  });
  controls.update();
}

function buildPostProcessing(scene) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const ambientOcclusion = new SSAOPass(
    scene,
    camera,
    stage.clientWidth,
    stage.clientHeight,
  );
  ambientOcclusion.kernelRadius = 12;
  ambientOcclusion.minDistance = 0.0015;
  ambientOcclusion.maxDistance = 0.11;
  composer.addPass(ambientOcclusion);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(stage.clientWidth, stage.clientHeight),
    0.2,
    0.36,
    1.08,
  );
  bloom.threshold = 1.08;
  bloom.strength = 0.2;
  bloom.radius = 0.38;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass(stage.clientWidth, stage.clientHeight));
}

function tuneModel(root) {
  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      const modelMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      modelMaterials.forEach((modelMaterial) => {
        if (!modelMaterial) return;
        modelMaterial.envMapIntensity = 0.35;
        modelMaterial.needsUpdate = true;
      });
    }

    if (object.isPointLight) {
      object.intensity *= 1.05;
      object.distance *= 1.08;
      object.decay = 2;
      object.castShadow = false;
    }
  });
}

function resize() {
  if (!renderer || !camera || !composer) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const aspect = Math.max(width / height, 0.5);
  const viewHeight = matchMedia("(max-width: 760px)").matches ? 17.6 : 13.9;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  const pixelRatio = Math.min(
    devicePixelRatio,
    matchMedia("(max-width: 760px)").matches ? 1.5 : 2,
  );
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
}

function updateHotspots() {
  if (!camera || !loadedScene) return;
  const bounds = canvas.getBoundingClientRect();
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);

  hotspotElements.forEach((element) => {
    const position = element.dataset.position.split(",").map(Number);
    const world = new THREE.Vector3(position[0], position[1], position[2]);
    const toPoint = world.clone().sub(camera.position).normalize();
    const projected = world.clone().project(camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      cameraDirection.dot(toPoint) > 0.35;

    element.hidden = !visible;
    if (!visible) return;
    element.style.left = `${(projected.x * 0.5 + 0.5) * bounds.width}px`;
    element.style.top = `${(-projected.y * 0.5 + 0.5) * bounds.height}px`;
  });
}

function renderFrame() {
  if (!composer || !controls) return;
  const easing = reducedMotion.matches ? 1 : 0.09;
  controls.target.lerp(focusTarget, easing);
  if (cameraGoal) {
    camera.position.lerp(cameraGoal, easing);
    if (camera.position.distanceTo(cameraGoal) < 0.015) cameraGoal = null;
  }
  controls.update();
  if (captureRequested) {
    canvas.dataset.cameraState = JSON.stringify({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      zoom: camera.zoom,
      frustum: [camera.left, camera.right, camera.top, camera.bottom],
    });
  }
  updateHotspots();
  composer.render();
  if (
    captureRequested &&
    loadedScene &&
    !canvas.dataset.capture &&
    capturedFrames++ >= 2
  ) {
    canvas.dataset.capture = canvas.toDataURL("image/png");
    dispatch("diorama-capture-ready");
  }
}

async function init() {
  try {
    buildRenderer();
    const scene = buildScene();
    buildCameraAndControls();
    buildPostProcessing(scene);
    resize();

    const gltf = await new GLTFLoader().loadAsync(
      `./assets/team-diorama/team-workspace.glb?v=${assetVersion}`,
    );
    loadedScene = gltf.scene;
    tuneModel(loadedScene);
    if (captureRequested) {
      const bounds = new THREE.Box3().setFromObject(loadedScene);
      canvas.dataset.modelBounds = JSON.stringify({
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        center: bounds.getCenter(new THREE.Vector3()).toArray(),
        size: bounds.getSize(new THREE.Vector3()).toArray(),
      });
    }
    scene.add(loadedScene);

    renderer.setAnimationLoop(renderFrame);
    dispatch("diorama-ready");
  } catch (error) {
    console.error("Unable to initialize the 3D team diorama.", error);
    dispatch("diorama-error", { message: String(error) });
  }
}

window.__diorama = {
  debug() {
    return {
      camera: camera?.position.toArray(),
      target: controls?.target.toArray(),
      zoom: camera?.zoom,
      frustum: camera
        ? {
            left: camera.left,
            right: camera.right,
            top: camera.top,
            bottom: camera.bottom,
          }
        : null,
    };
  },
  focus(position) {
    focusTarget.set(position[0] * 0.24, 0.46, position[2] * 0.24);
  },
  reset() {
    focusTarget.copy(defaultTarget);
    cameraGoal = defaultCameraPosition.clone();
    if (camera) {
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
  },
};

window.addEventListener("resize", resize);
init();
