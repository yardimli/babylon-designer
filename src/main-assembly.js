import { createScene } from "./assembly_scene.js";
import { setupAssemblyUI } from "./assembly_ui.js";
import { setupGizmos } from "./assembly_gizmoControl.js";
import { setupMaterialManager } from "./assembly_materialManager.js";
import { setupAssemblyManager } from "./assembly_manager.js";
import { setupAlignmentManager } from "./assembly_alignmentManager.js";

// Initialize
const canvas = document.getElementById("renderCanvas");
const scene = createScene(canvas);

setupGizmos(scene);
setupMaterialManager();
setupAssemblyManager();
setupAlignmentManager();
setupAssemblyUI();

// Start loop
scene.getEngine().runRenderLoop(() => {
	scene.render();
});
