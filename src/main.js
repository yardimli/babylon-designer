import { createScene } from "./scene.js";
import { setupUI } from "./ui.js";
import { setupGizmos } from "./gizmoControl.js";
import { setupMaterialManager } from "./materialManager.js"; // Changed
import { setupSceneManager } from "./sceneManager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createScene(canvas);

setupGizmos(scene);
setupUI();
setupMaterialManager(); // Changed
setupSceneManager();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
