import { createScene } from "./sceneset_scene.js"; // Updated
import { setupSceneSetUI } from "./sceneSetUI.js";
import { setupGizmos } from "./sceneset_gizmoControl.js"; // Updated
import { setupMaterialManager } from "./sceneset_materialManager.js"; // Updated
import { setupSceneSetManager } from "./sceneset_manager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createScene(canvas);

setupGizmos(scene);
setupMaterialManager();
setupSceneSetManager();
setupSceneSetUI();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
