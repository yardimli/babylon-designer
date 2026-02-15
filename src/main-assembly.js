import { createScene } from "./assembly_scene.js"; // Updated
import { setupAssemblyUI } from "./assemblyUI.js";
import { setupGizmos } from "./assembly_gizmoControl.js"; // Updated
import { setupMaterialManager } from "./assembly_materialManager.js"; // Updated
import { setupAssemblyManager } from "./assembly_manager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createScene(canvas);

setupGizmos(scene);
setupMaterialManager();
setupAssemblyManager();
setupAssemblyUI();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
