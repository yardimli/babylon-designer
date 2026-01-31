import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera, Color4, MeshBuilder, StandardMaterial, Color3, DynamicTexture, Viewport } from "@babylonjs/core";

export let engine;
export let scene;
export let camera;
export let axisScene;
export let axisCamera;

export function createScene(canvas) {
	engine = new Engine(canvas, true);
	scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
	
	// Camera
	camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;
	
	// Remove vertical rotation limits (allows infinite tumbling)
	camera.lowerBetaLimit = null;
	camera.upperBetaLimit = null;
	
	// Base Light
	const light = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
	light.intensity = 0.7;
	
	engine.runRenderLoop(() => {
		scene.render();
	});
	
	// --- Axis Indicator Setup ---
	// createAxisScene();
	
	window.addEventListener("resize", () => {
		engine.resize();
	});
	
	return scene;
}

function createAxisScene() {
	axisScene = new Scene(engine);
	axisScene.autoClear = false;
	
	// Axis Camera (Syncs with main camera)
	axisCamera = new ArcRotateCamera("axisCam", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), axisScene);
	axisCamera.viewport = new Viewport(0, 0.85, 0.15, 0.15); // Top Left
	
	// Create Axes
	createAxisGizmo(axisScene);
}

function createAxisGizmo(scene) {
	const makeArrow = (name, color, rotation) => {
		// Cylinder (Line)
		const tube = MeshBuilder.CreateCylinder(name + "_tube", { height: 2, diameter: 0.15 }, scene);
		tube.position.y = 1;
		
		// Cone (Tip)
		const cone = MeshBuilder.CreateCylinder(name + "_cone", { diameterTop: 0, diameterBottom: 0.4, height: 0.5 }, scene);
		cone.position.y = 2.25;
		
		// Merge
		cone.parent = tube;
		
		// Material
		const mat = new StandardMaterial(name + "_mat", scene);
		mat.emissiveColor = color;
		mat.disableLighting = true;
		tube.material = mat;
		cone.material = mat;
		
		// Rotation wrapper
		const wrapper = MeshBuilder.CreateBox(name + "_wrapper", { size: 0.01 }, scene);
		wrapper.isVisible = false;
		tube.parent = wrapper;
		
		wrapper.rotation = rotation;
		return { wrapper, tip: cone };
	};
	
	// X Axis (Red)
	const xArrow = makeArrow("axisX", new Color3(1, 0, 0), new Vector3(0, 0, -Math.PI / 2));
	addLabel(scene, "X", xArrow.tip, "red");
	
	// Y Axis (Green)
	const yArrow = makeArrow("axisY", new Color3(0, 1, 0), new Vector3(0, 0, 0));
	addLabel(scene, "Y", yArrow.tip, "green");
	
	// Z Axis (Blue)
	const zArrow = makeArrow("axisZ", new Color3(0, 0.5, 1), new Vector3(Math.PI / 2, 0, 0));
	addLabel(scene, "Z", zArrow.tip, "#3388ff");
	
	// Center
	const center = MeshBuilder.CreateSphere("center", { diameter: 0.3 }, scene);
	const cMat = new StandardMaterial("centerMat", scene);
	cMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
	cMat.disableLighting = true;
	center.material = cMat;
}

function addLabel(scene, text, parent, colorName) {
	const plane = MeshBuilder.CreatePlane("label_" + text, { size: 1.2 }, scene);
	plane.parent = parent;
	plane.position.y += 0.8;
	plane.billboardMode = 7; // BILLBOARDMODE_ALL
	
	const dt = new DynamicTexture("dt_" + text, { width: 64, height: 64 }, scene);
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

export function updateAxisScene() {
	if (axisCamera && camera) {
		axisCamera.alpha = camera.alpha;
		axisCamera.beta = camera.beta;
	}
}
