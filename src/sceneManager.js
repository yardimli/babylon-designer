import { SceneSerializer, SceneLoader } from "@babylonjs/core";
import { scene } from "./scene.js";
import { setupGizmos } from "./gizmoControl.js";
import { updatePropertyEditor } from "./propertyEditor.js";

let currentFileName = null;
let isModified = false;

// DOM Elements
const statusBarText = document.getElementById("status-text");
const saveLoadModal = document.getElementById("save_load_modal");
const sceneListContainer = document.getElementById("scene-list");
const saveNameInput = document.getElementById("save-scene-name");

export function setupSceneManager() {
	updateStatus();
	
	// -- Event Listeners for Menu Buttons --
	document.getElementById("btn-menu-save").onclick = () => handleSaveAction();
	document.getElementById("btn-menu-load").onclick = () => openLoadModal();
	document.getElementById("btn-menu-new").onclick = () => createNewScene();
	
	// -- Modal Actions --
	document.getElementById("btn-modal-save").onclick = () => {
		const name = saveNameInput.value.trim();
		if (name) {
			saveSceneInternal(name);
		}
	};
}

/**
 * Marks the scene as modified.
 * Should be called whenever a mesh is added, removed, or transformed.
 */
export function markModified() {
	if (!isModified) {
		isModified = true;
		updateStatus();
	}
}

function updateStatus() {
	const file = currentFileName || "Untitled";
	const mod = isModified ? "*" : "";
	if (statusBarText) {
		statusBarText.innerText = `${file}${mod}`;
	}
}

function handleSaveAction() {
	if (currentFileName) {
		// If we already have a filename, save directly without modal
		saveSceneInternal(currentFileName.replace(".json", ""));
	} else {
		// Otherwise open "Save As" dialog
		openSaveModal();
	}
}

function openSaveModal() {
	populateSceneList("save");
	saveNameInput.value = "";
	document.getElementById("modal-title").innerText = "Save Scene";
	document.getElementById("btn-modal-save").classList.remove("hidden");
	saveLoadModal.showModal();
}

function openLoadModal() {
	populateSceneList("load");
	document.getElementById("modal-title").innerText = "Load Scene";
	document.getElementById("btn-modal-save").classList.add("hidden"); // Hide save button in load mode
	saveLoadModal.showModal();
}

async function saveSceneInternal(name) {
	// 1. Serialize Scene
	const serializedScene = SceneSerializer.Serialize(scene);
	
	// 2. Send to Backend
	try {
		const response = await fetch('/api/scenes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: name,
				data: serializedScene
			})
		});
		
		const result = await response.json();
		
		if (result.success) {
			currentFileName = result.filename;
			isModified = false;
			updateStatus();
			saveLoadModal.close();
			console.log(`Scene saved to scenes/${result.filename}`);
		} else {
			alert("Error saving scene: " + result.error);
		}
	} catch (e) {
		console.error(e);
		alert("Failed to connect to server.");
	}
}

async function loadSceneInternal(filename) {
	try {
		const response = await fetch(`/api/scenes?file=${filename}`);
		const result = await response.json();
		
		if (!result.success) {
			alert("Could not load file.");
			return;
		}
		
		const jsonData = result.data;
		
		// 1. Clear current scene
		scene.dispose();
		
		// Note: scene.dispose() destroys the scene object. We must recreate it or clear contents.
		// However, since 'scene' is exported as a const from scene.js, we can't reassign it easily.
		// Better approach: Clear meshes/lights/materials.
		
		// Actually, let's use the internal clear loop to avoid breaking references
		// But SceneLoader.Append works best on an existing scene.
		
		// Hard Reset Strategy:
		// Since we cannot re-assign the exported 'scene' variable, we clear the engine's scene manually?
		// Or simpler: Clear arrays.
		while (scene.meshes.length > 0) scene.meshes[0].dispose();
		while (scene.lights.length > 0) scene.lights[0].dispose();
		while (scene.materials.length > 0) {
			if (scene.materials[0].name !== "default material") scene.materials[0].dispose();
			else break;
		}
		
		// 2. Load
		// We use 'data:' URI scheme for the JSON string to use SceneLoader
		const dataString = "data:" + JSON.stringify(jsonData);
		
		SceneLoader.Append("", dataString, scene, () => {
			currentFileName = filename;
			isModified = false;
			updateStatus();
			
			// Re-setup gizmos as the old manager is likely invalid or empty
			setupGizmos(scene);
			updatePropertyEditor(null);
			
			saveLoadModal.close();
		});
		
	} catch (e) {
		console.error(e);
		alert("Error loading scene.");
	}
}

function createNewScene() {
	if (isModified && !confirm("Unsaved changes will be lost. Continue?")) return;
	
	currentFileName = null;
	isModified = false;
	
	// Clear Scene
	while (scene.meshes.length > 0) scene.meshes[0].dispose();
	while (scene.lights.length > 0) scene.lights[0].dispose();
	
	updateStatus();
	updatePropertyEditor(null);
}

async function populateSceneList(mode) {
	sceneListContainer.innerHTML = "<span class='loading loading-spinner'></span>";
	
	try {
		const res = await fetch('/api/scenes');
		const data = await res.json();
		
		sceneListContainer.innerHTML = "";
		
		if (!data.files || data.files.length === 0) {
			sceneListContainer.innerHTML = "<p class='text-sm opacity-50'>No scenes found in /scenes folder.</p>";
			return;
		}
		
		data.files.forEach(file => {
			const row = document.createElement("div");
			row.className = "flex justify-between items-center bg-base-200 p-2 rounded hover:bg-base-300 cursor-pointer";
			
			const span = document.createElement("span");
			span.innerText = file;
			span.onclick = () => {
				if (mode === "load") loadSceneInternal(file);
				else {
					saveNameInput.value = file.replace(".json", "");
				}
			};
			
			const btnDelete = document.createElement("button");
			btnDelete.className = "btn btn-xs btn-error btn-outline";
			btnDelete.innerText = "X";
			btnDelete.onclick = async (e) => {
				e.stopPropagation();
				if(confirm(`Delete "${file}"?`)) {
					await fetch(`/api/scenes?file=${file}`, { method: 'DELETE' });
					populateSceneList(mode);
				}
			};
			
			row.appendChild(span);
			row.appendChild(btnDelete);
			sceneListContainer.appendChild(row);
		});
		
	} catch (e) {
		sceneListContainer.innerHTML = "<p class='text-error'>Failed to fetch scenes.</p>";
	}
}
