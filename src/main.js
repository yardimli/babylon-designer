import { createScene } from "./scene.js";
import { setupUI } from "./ui.js";
import { setupGizmos } from "./gizmoControl.js";
import { setupMaterialEditor } from "./materialEditor.js";
import { setupSceneManager } from "./sceneManager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createScene(canvas);

setupGizmos(scene);
setupUI();
setupMaterialEditor();
setupSceneManager();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
