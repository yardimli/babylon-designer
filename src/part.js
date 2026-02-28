import {
	Engine,
	Scene,
	Vector3,
	HemisphericLight,
	ArcRotateCamera,
	Color4,
	MeshBuilder,
	StandardMaterial,
	Color3,
	DynamicTexture,
	TransformNode,
	Matrix,
	Quaternion
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

export let engine;
export let part;
export let camera;

let axisObserver = null;

export function getSkipMaterialNames() {

	const skipMaterialNames = [
		"default material", "lightMat", "transformNodeMat",
		"gizmo_axisX_mat", "gizmo_axisY_mat", "gizmo_axisZ_mat",
		"centerMat", "labelMat_X", "labelMat_Y", "labelMat_Z",
		"negativeMat" // Added to prevent exporting the internal CSG material
	];

	return skipMaterialNames;
}

// Helper to ensure unique IDs across the part
export function getUniqueId(scene, baseId) {
	let id = baseId;
	let counter = 1;

	// Check Meshes, Lights, TransformNodes, and Materials
	const exists = (i) =>
		scene.getMeshByID(i) ||
		scene.getTransformNodeByID(i) ||
		scene.getLightByID(i) ||
		scene.getMaterialByID(i);

	while (exists(id)) {
		id = `${baseId}_${counter}`;
		counter++;
	}
	return id;
}

export function createPart(canvas) {
	engine = new Engine(canvas, true, { stencil: true });
	part = new Scene(engine);
	part.setRenderingAutoClearDepthStencil(1, false, true, false)

	//part.debugLayer.show();
	part.clearColor = new Color4(0.1, 0.1, 0.1, 1);
	part.createDefaultEnvironment({ createGround: false, createSkybox: false });

	// Ensure rendering group 1 clears depth so the axis draws on top of the part
	// part.setRenderingAutoClearDepthStencil(1, true, false, false);

	// Camera
	camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), part);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;

	// Remove vertical rotation limits (allows infinite tumbling)
	camera.lowerBetaLimit = null;
	camera.upperBetaLimit = null;

	// Base Light
	const light = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), part);
	light.intensity = 1;

	// --- Axis Indicator Setup (In-Scene) ---
	createAxisIndicator(part);

	engine.runRenderLoop(() => {
		part.render();
	});

	window.addEventListener("resize", () => {
		engine.resize();
	});

	return part;
}

// Exported function to reset the axis indicator (used when loading parts)
export function resetAxisIndicator() {
	if (!part) return;

	// 1. Cleanup Observer
	if (axisObserver) {
		part.onBeforeRenderObservable.remove(axisObserver);
		axisObserver = null;
	}

	// 2. Dispose Mesh Hierarchy
	const oldRoot = part.getTransformNodeByName("axisRoot");
	if (oldRoot) {
		oldRoot.dispose();
	}

	// 3. Dispose Materials
	const matNames = [
		"gizmo_axisX_mat", "gizmo_axisY_mat", "gizmo_axisZ_mat",
		"centerMat", "labelMat_X", "labelMat_Y", "labelMat_Z"
	];
	matNames.forEach(name => {
		const m = part.getMaterialByName(name);
		if (m) m.dispose();
	});

	// 4. Dispose Textures (DynamicTextures for labels)
	const texNames = ["dt_X", "dt_Y", "dt_Z"];
	texNames.forEach(name => {
		const t = part.textures.find(tex => tex.name === name);
		if (t) t.dispose();
	});

	// 5. Recreate
	createAxisIndicator(part);
}

function createAxisIndicator(scene) {
	// Ensure no duplicate observer if called directly
	if (axisObserver) {
		scene.onBeforeRenderObservable.remove(axisObserver);
		axisObserver = null;
	}

	// Create a root node for the axis
	const axisRoot = new TransformNode("axisRoot", scene);

	// Scale it down to look like a UI element
	axisRoot.scaling = new Vector3(0.15, 0.15, 0.15);

	// Helper to create arrows
	const makeArrow = (name, color, rotation) => {
		// Cylinder (Line)
		const tube = MeshBuilder.CreateCylinder(name + "_tube", {height: 2, diameter: 0.15}, scene);
		tube.position.y = 1;

		// Cone (Tip)
		const cone = MeshBuilder.CreateCylinder(name + "_cone", {diameterTop: 0, diameterBottom: 0.4, height: 0.5}, scene);
		cone.position.y = 1.25;

		// Merge
		cone.parent = tube;

		// Material
		const mat = new StandardMaterial(name + "_mat", scene);
		mat.emissiveColor = color;
		mat.disableLighting = true;
		tube.material = mat;
		cone.material = mat;

		// Settings for Overlay
		tube.renderingGroupId = 1;
		cone.renderingGroupId = 1;
		tube.isPickable = false;
		cone.isPickable = false;

		// Rotation wrapper
		const wrapper = new TransformNode(name + "_wrapper", scene);
		tube.parent = wrapper;
		wrapper.parent = axisRoot;

		wrapper.rotation = rotation;
		return {wrapper, tip: cone};
	};

	// X Axis (Red)
	const xArrow = makeArrow("gizmo_axisX", new Color3(1, 0, 0), new Vector3(0, 0, -Math.PI / 2));
	addLabel(scene, "X", xArrow.tip, "red", axisRoot);

	// Y Axis (Green)
	const yArrow = makeArrow("gizmo_axisY", new Color3(0, 1, 0), new Vector3(0, 0, 0));
	addLabel(scene, "Y", yArrow.tip, "green", axisRoot);

	// Z Axis (Blue)
	const zArrow = makeArrow("gizmo_axisZ", new Color3(0, 0.5, 1), new Vector3(Math.PI / 2, 0, 0));
	addLabel(scene, "Z", zArrow.tip, "#3388ff", axisRoot);

	// Center
	const center = MeshBuilder.CreateSphere("gizmo_center", {diameter: 0.6}, scene);
	const cMat = new StandardMaterial("centerMat", scene);
	cMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
	cMat.disableLighting = true;
	center.material = cMat;
	center.parent = axisRoot;
	center.renderingGroupId = 1;
	center.isPickable = false;

	// Update Position Loop
	axisObserver = scene.onBeforeRenderObservable.add(() => {
		if (!camera) return;

		// Position the axis in the top-left corner relative to the camera
		// We use createPickingRay to find a world position corresponding to screen coordinates
		const padding = 60; // Pixels from top-left
		const distance = 6; // Distance from camera (must be within clip planes)

		// Create a ray from screen coordinate (padding, padding)
		// Note: createPickingRay uses the camera's current transform
		const ray = scene.createPickingRay(padding, padding * 2, Matrix.Identity(), camera);

		// Place axisRoot along the ray
		axisRoot.position = ray.origin.add(ray.direction.scale(distance));

		// Force rotation to Identity (World Aligned)
		// Since the position is locked to the camera's screen-space,
		// keeping rotation as Identity makes it appear to rotate opposite to camera.
		axisRoot.rotationQuaternion = Quaternion.Identity();
	});
}

function addLabel(scene, text, parent, colorName) {
	const plane = MeshBuilder.CreatePlane("gizmo_label_" + text, {size: 1.2}, scene);
	plane.parent = parent;
	plane.position.y += 0.8;
	plane.billboardMode = 7; // BILLBOARDMODE_ALL
	plane.renderingGroupId = 1;
	plane.isPickable = false;

	const dt = new DynamicTexture("dt_" + text, {width: 64, height: 64}, scene);
	dt.hasAlpha = true;
	const ctx = dt.getContext();
	ctx.clearRect(0, 0, 64, 64);
	ctx.font = "bold 48px monospace";
	ctx.fillStyle = colorName;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 32, 32);
	dt.update();

	const mat = new StandardMaterial("labelMat_" + text, scene);
	mat.diffuseTexture = dt;
	mat.emissiveColor = Color3.White();
	mat.disableLighting = true;
	mat.useAlphaFromDiffuseTexture = true;
	plane.material = mat;
}