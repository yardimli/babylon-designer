import { Vector3, Color3, Quaternion, PBRMaterial } from "@babylonjs/core";
import { scene, resetAxisIndicator, getSkipMaterialNames, getUniqueId } from "./scene.js";
import { setupGizmos, disposeGizmos } from "./gizmoControl.js";
import { updatePropertyEditor, refreshSceneGraph } from "./propertyEditor.js";
import { createPrimitive } from "./ui.js";
import { createLight } from "./lightManager.js";
import { createTransformNode } from "./transformNodeManager.js";
import { clearShadowManagers } from "./shadowManager.js";

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
		version: 1.1,
		materials: [],
		lights: [],
		meshes: [],
		transformNodes: []
	};
	
	const skipNames = getSkipMaterialNames();
	
	// -- Save Materials --
	scene.materials.forEach(mat => {
		if (skipNames.includes(mat.name) || mat.name.startsWith("preview")) return;
		
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
					diffuse: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b },
					parentId: light.parent ? (light.parent.name || light.parent.id) : null
				});
			}
		}
	});
	
	// -- Save TransformNodes --
	scene.transformNodes.forEach(node => {
		if (node.metadata && node.metadata.isTransformNode) {
			let rot = { x: 0, y: 0, z: 0, w: 1 };
			if (node.rotationQuaternion) {
				rot = { x: node.rotationQuaternion.x, y: node.rotationQuaternion.y, z: node.rotationQuaternion.z, w: node.rotationQuaternion.w };
			} else {
				const q = Quaternion.FromEulerVector(node.rotation);
				rot = { x: q.x, y: q.y, z: q.z, w: q.w };
			}
			
			data.transformNodes.push({
				id: node.id,
				name: node.name,
				position: { x: node.position.x, y: node.position.y, z: node.position.z },
				rotation: rot,
				scaling: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
				parentId: node.parent ? (node.parent.name || node.parent.id) : null
			});
		}
	});
	
	// -- Save Primitives --
	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isPrimitive) {
			let rot = { x: 0, y: 0, z: 0, w: 1 };
			if (mesh.rotationQuaternion) {
				rot = { x: mesh.rotationQuaternion.x, y: mesh.rotationQuaternion.y, z: mesh.rotationQuaternion.z, w: mesh.rotationQuaternion.w };
			} else {
				const q = Quaternion.FromEulerVector(mesh.rotation);
				rot = { x: q.x, y: q.y, z: q.z, w: q.w };
			}
			
			const pivot = mesh.getPivotPoint();
			
			data.meshes.push({
				id: mesh.id,
				name: mesh.name,
				type: mesh.metadata.type,
				position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
				rotation: rot,
				scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z },
				pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
				materialId: mesh.material ? mesh.material.id : null,
				parentId: mesh.parent ? (mesh.parent.name || mesh.parent.id) : null,
				receiveShadows: mesh.receiveShadows,
				castShadows: mesh.metadata.castShadows || false
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
		clearShadowManagers();
		
		const toDispose = [];
		scene.meshes.forEach(m => {
			if (m.name === "previewSphere") return;
			if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy)) toDispose.push(m);
		});
		scene.transformNodes.forEach(t => {
			if (t.name === "axisRoot") return;
			if (t.metadata && t.metadata.isTransformNode) toDispose.push(t);
		});
		scene.lights.forEach(l => {
			if (l.name !== "hemiLight" && l.name !== "light") toDispose.push(l);
		});
		
		toDispose.forEach(n => n.dispose());
		
		const matsToDispose = scene.materials.filter(m => m.name !== "default material" && m.name !== "lightMat" && m.name !== "previewMat" && m.name !== "transformNodeMat");
		matsToDispose.forEach(m => m.dispose());
		
		// Map to store original ID -> new Unique ID (in case of conflict in file or with system)
		const idMap = new Map();
		
		// 2. Reconstruct Materials
		if (data.materials) {
			data.materials.forEach(matData => {
				const mat = new PBRMaterial(matData.name, scene);
				mat.id = matData.id; // Materials usually don't have hierarchy parents, so ID conflict is less critical for parenting, but good to be safe.
				mat.albedoColor = new Color3(...matData.albedo);
				mat.emissiveColor = new Color3(...matData.emissive);
				mat.metallic = matData.metallic;
				mat.roughness = matData.roughness;
				mat.alpha = matData.alpha;
			});
		}
		
		// 3. Reconstruct TransformNodes
		if (data.transformNodes) {
			data.transformNodes.forEach(nodeData => {
				const node = createTransformNode(nodeData, scene);
				if (node) {
					// Store mapping if ID changed (createTransformNode uses getUniqueId internally)
					idMap.set(nodeData.id, node.id);
				}
			});
		}
		
		// 4. Reconstruct Lights
		if (data.lights) {
			data.lights.forEach(lightData => {
				const proxy = createLight(lightData.type, lightData, scene);
				if (proxy) {
					// The proxy metadata holds the light ID
					const light = scene.getLightByID(proxy.metadata.lightId);
					if (light) {
						idMap.set(lightData.id, light.id);
					}
				}
			});
		}
		
		// 5. Reconstruct Meshes
		if (data.meshes) {
			data.meshes.forEach(meshData => {
				const mesh = createPrimitive(meshData.type, meshData);
				if (mesh) {
					idMap.set(meshData.id, mesh.id);
					
					if (meshData.materialId) {
						const mat = scene.getMaterialByID(meshData.materialId);
						if (mat) mesh.material = mat;
					}
					mesh.receiveShadows = !!meshData.receiveShadows;
				}
			});
		}
		
		// 6. Restore Hierarchy (Parenting)
		// Helper to find parent by name or ID, checking the ID map first
		const findParent = (idOrName) => {
			if (!idOrName) return null;
			
			// Check if we have a mapped ID for this parent
			const mappedId = idMap.get(idOrName) || idOrName;
			
			return scene.getMeshByName(mappedId) ||
				scene.getMeshByID(mappedId) ||
				scene.getTransformNodeByName(mappedId) ||
				scene.getTransformNodeByID(mappedId) ||
				scene.getLightByName(mappedId) ||
				scene.getLightByID(mappedId);
		};
		
		// Apply parenting for all types
		if (data.transformNodes) {
			data.transformNodes.forEach(d => {
				if (d.parentId) {
					const childId = idMap.get(d.id) || d.id;
					const child = scene.getTransformNodeByID(childId);
					const parent = findParent(d.parentId);
					if (child && parent) child.parent = parent;
				}
			});
		}
		if (data.lights) {
			data.lights.forEach(d => {
				if (d.parentId) {
					const childId = idMap.get(d.id) || d.id;
					const child = scene.getLightByID(childId);
					const parent = findParent(d.parentId);
					if (child && parent) child.parent = parent;
				}
			});
		}
		if (data.meshes) {
			data.meshes.forEach(d => {
				if (d.parentId) {
					const childId = idMap.get(d.id) || d.id;
					const child = scene.getMeshByID(childId);
					const parent = findParent(d.parentId);
					if (child && parent) child.parent = parent;
				}
			});
		}
		
		setupGizmos(scene);
		resetAxisIndicator();
		currentFileName = filename;
		isModified = false;
		updateStatus();
		refreshSceneGraph();
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
	clearShadowManagers();
	
	scene.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy)) m.dispose();
	});
	scene.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && t.metadata.isTransformNode) t.dispose();
	});
	scene.lights.forEach(l => {
		if (l.name !== "hemiLight") l.dispose();
	});
	
	setupGizmos(scene);
	updateStatus();
	updatePropertyEditor(null);
	refreshSceneGraph();
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
