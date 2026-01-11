import { SceneSerializer, SceneLoader } from "@babylonjs/core";
import { scene, engine } from "./scene.js";
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
			saveLoadModal.close();
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
	statusBarText.innerText = `${file}${mod}`;
}

function handleSaveAction() {
	if (currentFileName) {
		// If we already have a filename, save directly
		saveSceneInternal(currentFileName);
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

function saveSceneInternal(name) {
	// 1. Serialize Scene
	// We exclude the camera/light if we want to keep the default ones,
	// but for a full save, we serialize everything.
	// Note: Gizmos are usually not serialized by default if they are internal.
	const serializedScene = SceneSerializer.Serialize(scene);
	const jsonString = JSON.stringify(serializedScene);
	
	// 2. Save to "Disk" (LocalStorage for this demo)
	localStorage.setItem(`scene_${name}`, jsonString);
	
	// 3. Update State
	currentFileName = name;
	isModified = false;
	updateStatus();
	
	console.log(`Scene "${name}" saved.`);
}

function loadSceneInternal(name) {
	const jsonString = localStorage.getItem(`scene_${name}`);
	if (!jsonString) return;
	
	// 1. Clear current scene meshes/lights (keep camera if desired, but easiest to clear all)
	// We need to keep the engine running.
	scene.dispose();
	
	// 2. Re-create basic scene structure or load directly
	// Since scene.dispose() kills the scene object, we need to recreate the scene object
	// or use the SceneLoader to load into a new scene.
	// However, our architecture exports 'scene' from scene.js.
	// To keep it simple, we will clear the meshes instead of disposing the whole scene object.
	
	// Hard reset: Reload page? No, that's bad UX.
	// Soft reset:
	while (scene.meshes.length > 0) {
		scene.meshes[0].dispose();
	}
	while (scene.lights.length > 0) {
		scene.lights[0].dispose();
	}
	while (scene.materials.length > 0) {
		// Keep default if needed, but usually safe to clear
		if (scene.materials[0].name !== "default material") {
			scene.materials[0].dispose();
		} else {
			break; // prevent infinite loop if default persists
		}
	}
	
	// 3. Load
	SceneLoader.Append("", "data:" + jsonString, scene, () => {
		// Callback when loaded
		currentFileName = name;
		isModified = false;
		updateStatus();
		
		// Re-attach gizmos logic since old manager might be detached
		setupGizmos(scene);
		
		// Reset editor
		updatePropertyEditor(null);
	});
	
	saveLoadModal.close();
}

function createNewScene() {
	if (isModified && !confirm("Unsaved changes will be lost. Continue?")) return;
	
	currentFileName = null;
	isModified = false;
	
	// Clear Scene
	while (scene.meshes.length > 0) scene.meshes[0].dispose();
	// Re-add default light if needed, or let user add one.
	// For this demo, let's keep the scene empty.
	
	updateStatus();
	updatePropertyEditor(null);
}

function populateSceneList(mode) {
	sceneListContainer.innerHTML = "";
	
	// Look in LocalStorage for keys starting with "scene_"
	const files = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key.startsWith("scene_")) {
			files.push(key.replace("scene_", ""));
		}
	}
	
	if (files.length === 0) {
		sceneListContainer.innerHTML = "<p class='text-sm opacity-50'>No scenes found in storage.</p>";
		return;
	}
	
	files.forEach(file => {
		const row = document.createElement("div");
		row.className = "flex justify-between items-center bg-base-200 p-2 rounded hover:bg-base-300 cursor-pointer";
		
		const span = document.createElement("span");
		span.innerText = file;
		span.onclick = () => {
			if (mode === "load") loadSceneInternal(file);
			else {
				saveNameInput.value = file; // Fill input for overwrite
			}
		};
		
		const btnDelete = document.createElement("button");
		btnDelete.className = "btn btn-xs btn-error btn-outline";
		btnDelete.innerText = "X";
		btnDelete.onclick = (e) => {
			e.stopPropagation();
			if(confirm(`Delete "${file}"?`)) {
				localStorage.removeItem(`scene_${file}`);
				populateSceneList(mode);
			}
		};
		
		row.appendChild(span);
		row.appendChild(btnDelete);
		sceneListContainer.appendChild(row);
	});
}
