import { Quaternion, PBRMaterial, Color3 } from "@babylonjs/core";
import { part, resetAxisIndicator, getSkipMaterialNames } from "./part.js";
import { setupGizmos, disposeGizmos } from "./part_gizmoControl.js";
import { updatePropertyEditor } from "./part_propertyEditor.js";
import { refreshSceneGraph } from "./part_treeViewManager.js";
import { createPrimitive } from "./part_ui.js";
import { createLight } from "./part_lightManager.js";
import { createTransformNode } from "./part_transformNodeManager.js";
import { clearShadowManagers } from "./part_shadowManager.js";
import { setupHistory } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { getLoadedMaterialFiles, loadMaterialFile, clearMaterialManager } from "./part_materialManager.js";

let currentFileName = null;
let isModified = false;
const STORAGE_KEY_LAST_SCENE = "bd_last_scene";

const statusBarText = document.getElementById("status-text");
const saveLoadModal = document.getElementById("save_load_modal");
const sceneListContainer = document.getElementById("part-list");
const saveNameInput = document.getElementById("save-part-name");

export function setupSceneManager() {
	updateStatus();
	document.getElementById("btn-menu-save").onclick = () => handleSaveAction();
	document.getElementById("btn-menu-load").onclick = () => openLoadModal();
	document.getElementById("btn-menu-new").onclick = () => createNewScene();
	document.getElementById("btn-modal-save").onclick = () => {
		const name = saveNameInput.value.trim();
		if (name) saveSceneInternal(name);
	};

	setupHistory(serializeScene, loadSceneData);

	// Auto-load last part
	const lastFile = localStorage.getItem(STORAGE_KEY_LAST_SCENE);
	if (lastFile) {
		console.log("Restoring last part:", lastFile);
		loadSceneInternal(lastFile);
	}
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

export function serializeScene() {
	const data = {
		version: 1.4, // Bumped version
		materialFiles: getLoadedMaterialFiles(),
		lights: [],
		meshes: [],
		transformNodes: []
	};

	part.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isLightProxy) {
			const light = part.getLightByID(mesh.metadata.lightId);
			if (light) {
				data.lights.push({
					id: light.id,
					type: mesh.metadata.lightType,
					position: { x: light.position.x, y: light.position.y, z: light.position.z },
					direction: light.direction ? { x: light.direction.x, y: light.direction.y, z: light.direction.z } : null,
					intensity: light.intensity,
					diffuse: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b },
					parentId: light.parent ? light.parent.id : null,
					sortIndex: mesh.metadata.sortIndex || 0,
					// NEW: Save visibility
					visible: mesh.isEnabled()
				});
			}
		}
	});

	part.transformNodes.forEach(node => {
		if (node.metadata && node.metadata.isInternal) return;

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
				parentId: node.parent ? node.parent.id : null,
				sortIndex: node.metadata.sortIndex || 0,
				// NEW: Save visibility
				visible: node.isEnabled()
			});
		}
	});

	part.meshes.forEach(mesh => {
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
				parentId: mesh.parent ? mesh.parent.id : null,
				receiveShadows: mesh.receiveShadows,
				castShadows: mesh.metadata.castShadows || false,
				sortIndex: mesh.metadata.sortIndex || 0,
				// NEW: Save visibility
				visible: mesh.isEnabled()
			});
		}
	});

	return data;
}

async function saveSceneInternal(name) {
	const data = serializeScene();
	try {
		const response = await fetch('/api/scenes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name, data: data })
		});

		const result = await response.json();
		if (result.success) {
			currentFileName = result.filename;
			localStorage.setItem(STORAGE_KEY_LAST_SCENE, currentFileName);
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

export async function loadSceneData(data) {
	disposeGizmos();
	selectNode(null);
	clearShadowManagers();
	clearMaterialManager();

	const toDispose = [];
	part.meshes.forEach(m => {
		if (m.name === "previewSphere") return;
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy)) toDispose.push(m);
	});
	part.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && t.metadata.isTransformNode) toDispose.push(t);
	});
	part.lights.forEach(l => {
		if (l.name !== "hemiLight" && l.name !== "light") toDispose.push(l);
	});

	toDispose.forEach(n => n.dispose());

	const matsToDispose = part.materials.filter(m => m.name !== "default material" && m.name !== "lightMat" && m.name !== "previewMat" && m.name !== "transformNodeMat");
	matsToDispose.forEach(m => m.dispose());

	const idMap = new Map();

	if (data.materialFiles) {
		for (const filename of data.materialFiles) {
			await loadMaterialFile(filename);
		}
	}

	if (data.transformNodes) {
		data.transformNodes.forEach(nodeData => {
			const node = createTransformNode(nodeData, part);
			if (node) {
				idMap.set(nodeData.id, node.id);
				if (node.metadata) node.metadata.sortIndex = nodeData.sortIndex || 0;
				// NEW: Restore visibility
				if (nodeData.visible !== undefined) node.setEnabled(nodeData.visible);
			}
		});
	}

	if (data.lights) {
		data.lights.forEach(lightData => {
			const proxy = createLight(lightData.type, lightData, part);
			if (proxy) {
				const light = part.getLightByID(proxy.metadata.lightId);
				if (light) {
					idMap.set(lightData.id, light.id);
				}
				if (proxy.metadata) proxy.metadata.sortIndex = lightData.sortIndex || 0;
				// NEW: Restore visibility (on proxy, which propagates to light via logic if needed, but setEnabled works on nodes)
				if (lightData.visible !== undefined) proxy.setEnabled(lightData.visible);
			}
		});
	}

	if (data.meshes) {
		data.meshes.forEach(meshData => {
			const mesh = createPrimitive(meshData.type, meshData);
			if (mesh) {
				idMap.set(meshData.id, mesh.id);
				if (meshData.materialId) {
					const mat = part.getMaterialByID(meshData.materialId);
					if (mat) mesh.material = mat;
				}
				mesh.receiveShadows = !!meshData.receiveShadows;
				if (mesh.metadata) mesh.metadata.sortIndex = meshData.sortIndex || 0;
				// NEW: Restore visibility
				if (meshData.visible !== undefined) mesh.setEnabled(meshData.visible);
			}
		});
	}

	// 4. Restore Hierarchy
	const findParent = (idOrName) => {
		if (!idOrName) return null;
		const mappedId = idMap.get(idOrName) || idOrName;

		return part.getMeshByID(mappedId) ||
			part.getTransformNodeByID(mappedId) ||
			part.getLightByID(mappedId) ||
			part.getMeshByName(mappedId) ||
			part.getTransformNodeByName(mappedId) ||
			part.getLightByName(mappedId);
	};

	const restoreParents = (list) => {
		if (!list) return;
		list.forEach(d => {
			if (d.parentId) {
				const childId = idMap.get(d.id) || d.id;
				let child = part.getMeshByID(childId) || part.getTransformNodeByID(childId) || part.getLightByID(childId);
				const parent = findParent(d.parentId);
				if (child && parent) child.parent = parent;
			}
		});
	};

	restoreParents(data.transformNodes);
	restoreParents(data.lights);
	restoreParents(data.meshes);

	setupGizmos(part);
	resetAxisIndicator();
	refreshSceneGraph();
}

async function loadSceneInternal(filename) {
	try {
		const response = await fetch(`/api/scenes?file=${filename}`);
		const result = await response.json();

		if (!result.success) {
			// If auto-load fails (e.g. file deleted), clear storage
			if (filename === localStorage.getItem(STORAGE_KEY_LAST_SCENE)) {
				localStorage.removeItem(STORAGE_KEY_LAST_SCENE);
			}
			alert("Could not load file.");
			return;
		}

		await loadSceneData(result.data);

		currentFileName = filename;
		localStorage.setItem(STORAGE_KEY_LAST_SCENE, currentFileName);
		isModified = false;
		updateStatus();
		saveLoadModal.close();
	} catch (e) {
		console.error(e);
		alert("Error parsing part JSON.");
	}
}

function createNewScene() {
	if (isModified && !confirm("Unsaved changes will be lost. Continue?")) return;

	currentFileName = null;
	localStorage.removeItem(STORAGE_KEY_LAST_SCENE);
	isModified = false;

	disposeGizmos();
	clearShadowManagers();
	clearMaterialManager();
	selectNode(null);

	part.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy)) m.dispose();
	});
	part.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && t.metadata.isTransformNode) t.dispose();
	});
	part.lights.forEach(l => {
		if (l.name !== "hemiLight") l.dispose();
	});

	part.materials.forEach(m => {
		if (m.metadata && m.metadata.isExternal) m.dispose();
	});

	setupGizmos(part);
	updateStatus();
	updatePropertyEditor([]);
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