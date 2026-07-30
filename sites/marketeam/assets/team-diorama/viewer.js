import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const canvas = document.querySelector("#diorama-canvas");
const stage = document.querySelector("#scene");
const hotspotElements = [...document.querySelectorAll("[data-member]")];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const defaultCameraPosition = new THREE.Vector3(0, 12.6, 16.8);
const defaultTarget = new THREE.Vector3(0, 0.34, 0);
const focusTarget = defaultTarget.clone();
let cameraGoal = null;
let loadedScene = null;
let composer = null;
let renderer = null;
let camera = null;
let controls = null;

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: new URLSearchParams(location.search).has("capture"),
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x0d0c0d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0c0d);
  scene.fog = new THREE.FogExp2(0x0d0c0d, 0.014);

  const ambient = new THREE.AmbientLight(0x8d8587, 0.62);
  scene.add(ambient);

  const hemisphere = new THREE.HemisphereLight(0xfff0de, 0x171318, 1.02);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xffd9b3, 2.15);
  key.position.set(-6.5, 12.5, 9.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 36;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.026;
  key.shadow.blurSamples = 8;
  key.shadow.radius = 3;
  scene.add(key);

  const coolFill = new THREE.DirectionalLight(0x93bee0, 0.46);
  coolFill.position.set(8, 5.5, 3);
  scene.add(coolFill);

  const rim = new THREE.DirectionalLight(0xe4a5d6, 0.34);
  rim.position.set(-3, 6, -9);
  scene.add(rim);

  return scene;
}

function buildCameraAndControls() {
  const aspect = Math.max(stage.clientWidth / stage.clientHeight, 0.5);
  const viewHeight = 13;
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
  camera.zoom = 0.98;
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
  ambientOcclusion.minDistance = 0.002;
  ambientOcclusion.maxDistance = 0.085;
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
        modelMaterial.envMapIntensity = 0.54;
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
  const viewHeight = matchMedia("(max-width: 760px)").matches ? 17 : 13;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.setSize(width, height, false);
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
  updateHotspots();
  composer.render();
}

async function init() {
  try {
    buildRenderer();
    const scene = buildScene();
    buildCameraAndControls();
    buildPostProcessing(scene);
    resize();

    const gltf = await new GLTFLoader().loadAsync(
      "./assets/team-diorama/team-workspace.glb",
    );
    loadedScene = gltf.scene;
    tuneModel(loadedScene);
    scene.add(loadedScene);

    renderer.setAnimationLoop(renderFrame);
    dispatch("diorama-ready");
  } catch (error) {
    console.error("Unable to initialize the 3D team diorama.", error);
    dispatch("diorama-error", { message: String(error) });
  }
}

window.__diorama = {
  focus(position) {
    focusTarget.set(position[0] * 0.24, 0.46, position[2] * 0.24);
  },
  reset() {
    focusTarget.copy(defaultTarget);
    cameraGoal = defaultCameraPosition.clone();
    if (camera) {
      camera.zoom = 0.98;
      camera.updateProjectionMatrix();
    }
  },
};

window.addEventListener("resize", resize);
init();
