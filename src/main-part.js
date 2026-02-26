import { createPart } from "./part.js";
import { setupUI } from "./part_ui.js";
import { setupGizmos } from "./part_gizmoControl.js";
import { setupMaterialManager } from "./part_materialManager.js";
import { setupSceneManager } from "./part_manager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createPart(canvas);

setupGizmos(scene);
setupUI();
setupMaterialManager();
setupSceneManager();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
