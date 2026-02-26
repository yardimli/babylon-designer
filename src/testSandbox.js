import {
	Engine,
	Scene,
	Vector3,
	Color3,
	MeshBuilder,
	HemisphericLight,
	SpotLight,
	ArcRotateCamera,
	StandardMaterial,
	Texture,
	ShadowGenerator
} from '@babylonjs/core';
import earcut from 'earcut'; // Required for polygon extrusion
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

// Initialize canvas and engine
const canvas = document.getElementById('renderCanvas');
const engine = new Engine(canvas, true);

async function initScene () {
	const scene = new Scene(engine);
	//scene.debugLayer.show();
	scene.clearColor = new Color3(0.1, 0.1, 0.1);
	scene.createDefaultEnvironment({ createGround: false, createSkybox: false });

	// Add a camera to view the scene
	const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 12, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;

	// 1. Create the plane (wall)
	const wall = MeshBuilder.CreatePlane('wall', { width: 10, height: 5 }, scene);
	wall.position.z = 0; // Move wall back slightly so text sits in front
	wall.receiveShadows = true; // Enable the wall to receive shadows

	// 2. Create the material
	const brickMaterial = new StandardMaterial('brickMat', scene);

	// 3. Assign textures (Using BabylonJS public playground textures for the sandbox)
	brickMaterial.diffuseTexture = new Texture('textures/brick.jpg', scene); // diffuse -> albedo
	brickMaterial.bumpTexture = new Texture('textures/brick_normal.png', scene); // Normal Map
	brickMaterial.useParallax = true;
	brickMaterial.useParallaxOcclusion = true;
	brickMaterial.parallaxScaleBias = 0.5;
	brickMaterial.bumpTexture.level = 1; // Strength of the normal map effect

	brickMaterial.specularPower = 128;

	// 4. Apply material to the plane
	wall.material = brickMaterial;
	const scaleX = 4; // Repeat 4 times horizontally
	const scaleY = 2; // Repeat 2 times vertically

	// Apply to Albedo (Diffuse)
	brickMaterial.diffuseTexture.uScale = scaleX;
	brickMaterial.diffuseTexture.vScale = scaleY;

	// Apply to Normal Map (must match!)
	brickMaterial.bumpTexture.uScale = scaleX;
	brickMaterial.bumpTexture.vScale = scaleY;

	// 5. Create rotating text object
	// Fetch standard font data required for MeshBuilder.CreateText
	const fontUrl = 'https://assets.babylonjs.com/fonts/Droid Sans_Regular.json';
	const response = await fetch(fontUrl);
	const fontData = await response.json();

	// Generate the 3D text mesh
	const textMesh = MeshBuilder.CreateText('text', 'ABC', fontData, {
		size: 0.5,
		resolution: 64,
		depth: 0.5
	}, scene, earcut);

	// Position the text mesh in front of the wall
	textMesh.position.x = 0; // Offset to center the text visually
	textMesh.position.y = 0;
	textMesh.position.z = -3;

	// Add a bright  material to the text so it stands out
	const textMat = new StandardMaterial('textMat', scene);
	textMat.albedoColor = new Color3(1, 0.6, 0); // Orange color
	textMesh.material = textMat;

	// ==========================================
	// Add a static cube to the left of the text
	// ==========================================
	const staticCube = MeshBuilder.CreateBox('staticCube', { size: 1 }, scene);

	// Position the cube to the left (negative X) and at the same depth as the text
	staticCube.position.x = -2.5;
	staticCube.position.y = 0;
	staticCube.position.z = -3;

	// Give the cube a distinct material (e.g., Blue)
	const cubeMat = new StandardMaterial('cubeMat', scene);
	cubeMat.albedoColor = new Color3(0.2, 0.5, 1); // Blue color
	staticCube.material = cubeMat;

	// Add ambient light to illuminate the scene generally
	const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
	ambientLight.intensity = 0.5;

	// SpotLight
	// Parameters: name, position, direction, angle (cone size), exponent (decay speed), scene
	const spotLight = new SpotLight(
		'spotLight',
		new Vector3(0, 0, -10), // Positioned in front of the text
		new Vector3(0, 0, 1),  // Pointing towards the wall (+Z direction)
		Math.PI / 2,           // 90-degree cone angle to cover the text
		2,                     // Light decay exponent
		scene
	);
	spotLight.intensity = 1;

	// ==========================================
	//  Add a proxy sphere where the light is
	// ==========================================
	const lightProxy = MeshBuilder.CreateSphere('lightProxy', { diameter: 0.5 }, scene);
	lightProxy.position = spotLight.position; // Bind to the spotlight's position

	// Give it an emissive material so it looks like a glowing lightbulb
	const proxyMat = new StandardMaterial('proxyMat', scene);
	proxyMat.emissiveColor = new Color3(1, 1, 0.8); // Pale yellow glow
	proxyMat.disableLighting = true; // Prevent it from being shaded by other lights
	lightProxy.material = proxyMat;
	// ==========================================

	// Setup shadow generator using the spotlight
	const shadowGenerator = new ShadowGenerator(1024, spotLight);
	shadowGenerator.useBlurExponentialShadowMap = true;
	shadowGenerator.blurKernel = 32;

	// Make the cube cast a shadow onto the wall as well
	shadowGenerator.addShadowCaster(staticCube);
	// ==========================================
	// Make the text cast a shadow onto the wall
	shadowGenerator.addShadowCaster(textMesh);

	// Animation loop for continuous rotation
	scene.onBeforeRenderObservable.add(() => {
		// Rotate text object on Y and X axes
		textMesh.rotation.y += 0.01;
		textMesh.rotation.x = Math.sin(Date.now() * 0.002) * 0.2; // Slight wobble
	});

	// Run render loop
	engine.runRenderLoop(() => {
		scene.render();
	});

	// Handle window resize gracefully
	window.addEventListener('resize', () => {
		engine.resize();
	});
}

// Boot up the sandbox scene
initScene();