import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera, Color4 } from "@babylonjs/core";

export let engine;
export let scene;
export let camera;

export function createScene(canvas) {
	engine = new Engine(canvas, true);
	scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
	
	// Camera
	camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;
	
	// Base Light
	const light = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
	light.intensity = 0.7;
	
	engine.runRenderLoop(() => {
		scene.render();
	});
	
	window.addEventListener("resize", () => {
		engine.resize();
	});
	
	return scene;
}
