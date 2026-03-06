import { SceneLoader, Quaternion } from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Ensure GLTF loader is registered
import { part, getUniqueId } from "./part.js";
import { markModified } from "./part_manager.js";
import { recordState } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { refreshPartGraph } from "./part_treeViewManager.js";
import { updateCSG } from "./part_csgManager.js";
import { setShadowCaster } from "./part_shadowManager.js";

export function setupMeshManager() {
	const btnImport = document.getElementById("btn-import-mesh");
	const modal = document.getElementById("import_mesh_modal");
	const listContainer = document.getElementById("import-mesh-list");
	const btnRefresh = document.getElementById("btn-refresh-meshes");

	if (btnImport) {
		btnImport.onclick = () => {
			refreshServerMeshList(listContainer, modal);
			modal.showModal();
		};
	}

	if (btnRefresh) {
		btnRefresh.onclick = () => {
			refreshServerMeshList(listContainer, modal);
		};
	}
}

async function refreshServerMeshList(container, modal) {
	container.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/meshes');
		const data = await res.json();
		container.innerHTML = "";

		if (!data.files || data.files.length === 0) {
			container.innerHTML = "<p class='text-sm opacity-50'>No meshes found in /meshes folder.</p>";
			return;
		}

		data.files.forEach(file => {
			const btn = document.createElement("button");
			btn.className = "btn btn-xs btn-ghost justify-start font-normal normal-case text-left w-full";
			btn.innerText = file;
			btn.onclick = async () => {
				await loadMeshFile(file);
				modal.close();
			};
			container.appendChild(btn);
		});

	} catch (e) {
		console.error(e);
		container.innerHTML = "<p class='text-error'>Connection failed.</p>";
	}
}

// Function to load a mesh into the scene
// savedState is provided when loading from a saved JSON part file
export async function loadMeshFile(filename, savedState = null) {
	try {
		// ImportMeshAsync loads the file and adds it to the scene
		// We use "" as the mesh name to load all meshes in the file
		const result = await SceneLoader.ImportMeshAsync("", "/meshes/", filename, part);

		if (!result.meshes || result.meshes.length === 0) return null;

		// GLTF usually has a __root__ node. We use this as our main handle.
		const root = result.meshes[0];

		// Generate a unique ID for the root
		const baseId = savedState ? savedState.id : filename.replace(/\./g, "_");
		const id = getUniqueId(part, baseId);

		root.id = id;
		root.name = savedState ? savedState.name : id;

		// Tag metadata
		if (!root.metadata) root.metadata = {};
		root.metadata.isMesh = true;
		root.metadata.meshFilename = filename;
		root.metadata.castShadows = true; // Default to true

		// Apply Saved State (Transform, etc.)
		if (savedState) {
			root.position.set(savedState.position.x, savedState.position.y, savedState.position.z);

			if (savedState.rotation.w !== undefined) {
				if (!root.rotationQuaternion) root.rotationQuaternion = new Quaternion();
				root.rotationQuaternion.set(savedState.rotation.x, savedState.rotation.y, savedState.rotation.z, savedState.rotation.w);
			} else {
				// Fallback if Euler was saved (though GLTF root usually uses Quaternion)
				root.rotationQuaternion = Quaternion.FromEulerAngles(savedState.rotation.x, savedState.rotation.y, savedState.rotation.z);
			}

			root.scaling.set(savedState.scaling.x, savedState.scaling.y, savedState.scaling.z);

			if (savedState.visible !== undefined) root.setEnabled(savedState.visible);
			if (savedState.isLocked) root.metadata.isLocked = true;

			// Restore Shadow Casting
			if (savedState.castShadows !== undefined) {
				root.metadata.castShadows = savedState.castShadows;
			}
		} else {
			// New Import defaults
			root.position.y = 0;
		}

		// Post-process children
		result.meshes.forEach(m => {
			// Ensure all sub-meshes cast shadows if the root says so
			if (m !== root) {
				// We don't want sub-meshes to be individually selectable in the graph usually,
				// but for now, we leave them as is. The selectionManager will handle picking logic.
				m.isPickable = true;

				// Apply shadow settings
				setShadowCaster(m, root.metadata.castShadows);
			}
		});

		// If it's a new import, select it and record state
		if (!savedState) {
			selectNode(root);
			updateCSG();
			markModified();
			refreshPartGraph();
			recordState();
		}

		return root;

	} catch (e) {
		console.error("Failed to load mesh:", filename, e);
		alert(`Failed to load mesh: ${filename}`);
		return null;
	}
}
