import { Vector3, Color3, Quaternion, PBRMaterial } from "@babylonjs/core";
import { scene } from "./scene.js";
import { setupGizmos, disposeGizmos } from "./gizmoControl.js";
import { updatePropertyEditor, refreshSceneGraph } from "./propertyEditor.js";
import { createPrimitive } from "./ui.js";
import { createLight } from "./lightManager.js";

let currentFileName = null;
let isModified = false;

const statusBarText = document.getElementById("status-text");
const saveLoadModal = document.getElementById("save_load_modal");
const sceneListContainer = document.getElementById("scene-list");
const saveNameInput = document.getElementById("save-scene-name");

export function setupSceneManager() {
	updateStatus();
	document.getElementById("btn-menu-save").onclick = () => handleSaveAction();
	document.getElementById("btn-menu-load").onclick = () => openLoadModal();
	document.getElementById("btn-menu-new").onclick = () => createNewScene();
	document.getElementById("btn-modal-save").onclick = () => {
		const name = saveNameInput.value.trim();
		if (name) saveSceneInternal(name);
	};
}

export function markModified() {
	if (!isModified) {
		isModified = true;
		updateStatus();
	}
}

function updateStatus() {
	const file = currentFileName || "Untitled";
	const mod = isModified ? "*" : "";
	if (statusBarText) statusBarText.innerText = `${file}${mod}`;
}

function handleSaveAction() {
	if (currentFileName) saveSceneInternal(currentFileName.replace(".json", ""));
	else openSaveModal();
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
	document.getElementById("btn-modal-save").classList.add("hidden");
	saveLoadModal.showModal();
}

// ==========================================
// CUSTOM SAVE LOGIC
// ==========================================
async function saveSceneInternal(name) {
	// 1. Build Simple JSON Object
	const data = {
		version: 1.0,
		materials: [],
		lights: [],
		meshes: []
	};
	
	// -- Save Materials --
	scene.materials.forEach(mat => {
		// Skip default or gizmo materials
		if (mat.name === "default material" || mat.name === "lightMat" || mat.name.startsWith("preview")) return;
		
		const matData = {
			id: mat.id,
			name: mat.name,
			albedo: mat.albedoColor.asArray(),
			emissive: mat.emissiveColor.asArray(),
			metallic: mat.metallic || 0,
			roughness: mat.roughness || 1,
			alpha: mat.alpha || 1
		};
		data.materials.push(matData);
	});
	
	// -- Save Lights --
	// We iterate Meshes to find Light Proxies, then get the linked light
	// (Or iterate lights directly, but we want to ensure we only save user lights)
	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isLightProxy) {
			const light = scene.getLightByID(mesh.metadata.lightId);
			if (light) {
				data.lights.push({
					id: light.id,
					type: mesh.metadata.lightType,
					position: { x: light.position.x, y: light.position.y, z: light.position.z },
					direction: light.direction ? { x: light.direction.x, y: light.direction.y, z: light.direction.z } : null,
					intensity: light.intensity,
					diffuse: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b }
				});
			}
		}
	});
	
	// -- Save Primitives --
	scene.meshes.forEach(mesh => {
		// Only save meshes we marked as primitives
		if (mesh.metadata && mesh.metadata.isPrimitive) {
			// Get Rotation (Prefer Quaternion)
			let rot = { x: 0, y: 0, z: 0, w: 1 };
			if (mesh.rotationQuaternion) {
				rot = { x: mesh.rotationQuaternion.x, y: mesh.rotationQuaternion.y, z: mesh.rotationQuaternion.z, w: mesh.rotationQuaternion.w };
			} else {
				// Convert Euler to Quat for consistency
				const q = Quaternion.FromEulerVector(mesh.rotation);
				rot = { x: q.x, y: q.y, z: q.z, w: q.w };
			}
			
			data.meshes.push({
				id: mesh.id,
				type: mesh.metadata.type, // "Cube", "Sphere", etc.
				position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
				rotation: rot,
				scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z },
				materialId: mesh.material ? mesh.material.id : null,
				parentId: mesh.parent ? mesh.parent.name : null // Simple parent by name/id
			});
		}
	});
	
	// 2. Send to Backend
	try {
		const response = await fetch('/api/scenes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name, data: data })
		});
		
		const result = await response.json();
		if (result.success) {
			currentFileName = result.filename;
			isModified = false;
			updateStatus();
			saveLoadModal.close();
			console.log(`Scene saved (Size: ${JSON.stringify(data).length} bytes)`);
		} else {
			alert("Error saving: " + result.error);
		}
	} catch (e) {
		console.error(e);
		alert("Failed to connect.");
	}
}

// ==========================================
// CUSTOM LOAD LOGIC
// ==========================================
async function loadSceneInternal(filename) {
	try {
		const response = await fetch(`/api/scenes?file=${filename}`);
		const result = await response.json();
		
		if (!result.success) {
			alert("Could not load file.");
			return;
		}
		
		const data = result.data;
		
		// 1. Clear Scene
		disposeGizmos();
		updatePropertyEditor(null);
		
		// Dispose all user meshes and lights.
		// Keep camera and hemispheric light (if you want base lighting).
		// We filter by checking if they are our created objects.
		const toDispose = [];
		scene.meshes.forEach(m => {
			if (m.name === "previewSphere") return; // Keep material editor preview
			if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy)) toDispose.push(m);
		});
		// Also clean up lights linked to proxies
		scene.lights.forEach(l => {
			if (l.name !== "hemiLight" && l.name !== "light") toDispose.push(l); // Keep base lights
		});
		
		toDispose.forEach(n => n.dispose());
		
		// Clear Materials (except default)
		const matsToDispose = scene.materials.filter(m => m.name !== "default material" && m.name !== "lightMat" && m.name !== "previewMat");
		matsToDispose.forEach(m => m.dispose());
		
		// 2. Reconstruct Materials
		if (data.materials) {
			data.materials.forEach(matData => {
				const mat = new PBRMaterial(matData.name, scene);
				mat.id = matData.id;
				mat.albedoColor = new Color3(...matData.albedo);
				mat.emissiveColor = new Color3(...matData.emissive);
				mat.metallic = matData.metallic;
				mat.roughness = matData.roughness;
				mat.alpha = matData.alpha;
			});
		}
		
		// 3. Reconstruct Lights
		if (data.lights) {
			data.lights.forEach(lightData => {
				createLight(lightData.type, lightData, scene);
			});
		}
		
		// 4. Reconstruct Meshes
		if (data.meshes) {
			data.meshes.forEach(meshData => {
				const mesh = createPrimitive(meshData.type, meshData);
				
				// Re-link Material
				if (meshData.materialId) {
					const mat = scene.getMaterialByID(meshData.materialId);
					if (mat) mesh.material = mat;
				}
			});
			
			// Pass 2: Parenting (done after all meshes exist)
			data.meshes.forEach(meshData => {
				if (meshData.parentId) {
					const child = scene.getMeshByID(meshData.id);
					const parent = scene.getMeshByName(meshData.parentId) || scene.getMeshByID(meshData.parentId);
					// Use direct assignment (child.parent =) instead of setParent().
					// setParent() preserves absolute world position (recalculating local),
					// but our saved data already contains local coordinates relative to the parent.
					if (child && parent) child.parent = parent;
				}
			});
		}
		
		// Finish
		setupGizmos(scene);
		currentFileName = filename;
		isModified = false;
		updateStatus();
		refreshSceneGraph(); // Update tree
		saveLoadModal.close();
		
	} catch (e) {
		console.error(e);
		alert("Error parsing custom JSON.");
	}
}

function createNewScene() {
	if (isModified && !confirm("Unsaved changes will be lost. Continue?")) return;
	
	currentFileName = null;
	isModified = false;
	
	disposeGizmos();
	
	// Quick Clear
	scene.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy)) m.dispose();
	});
	scene.lights.forEach(l => {
		if (l.name !== "hemiLight") l.dispose();
	});
	
	setupGizmos(scene);
	updateStatus();
	updatePropertyEditor(null);
	refreshSceneGraph(); // Update tree
}

async function populateSceneList(mode) {
	sceneListContainer.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/scenes');
		const data = await res.json();
		sceneListContainer.innerHTML = "";
		if (!data.files || data.files.length === 0) {
			sceneListContainer.innerHTML = "<p class='text-sm opacity-50'>No scenes found.</p>";
			return;
		}
		data.files.forEach(file => {
			const row = document.createElement("div");
			row.className = "flex justify-between items-center bg-base-200 p-2 rounded hover:bg-base-300 cursor-pointer";
			const span = document.createElement("span");
			span.innerText = file;
			span.onclick = () => {
				if (mode === "load") loadSceneInternal(file);
				else saveNameInput.value = file.replace(".json", "");
			};
			const btnDelete = document.createElement("button");
			btnDelete.className = "btn btn-xs btn-error btn-outline";
			btnDelete.innerText = "X";
			btnDelete.onclick = async (e) => {
				e.stopPropagation();
				if (confirm(`Delete "${file}"?`)) {
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
