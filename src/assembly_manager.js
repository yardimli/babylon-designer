import { TransformNode, Quaternion, Vector3, Color3, StandardMaterial } from "@babylonjs/core";
import { scene, resetAxisIndicator, getUniqueId } from "./assembly_scene.js";
import { setupGizmos, disposeGizmos } from "./assembly_gizmoControl.js";
import { updatePropertyEditor } from "./assembly_propertyEditor.js";
import { refreshSceneGraph } from "./assembly_treeViewManager.js";
import { createLight } from "./assembly_lightManager.js";
import { createTransformNode } from "./assembly_transformNodeManager.js";
import { createPrimitive, createShapeMesh } from "./assembly_ui.js"; // Updated import
import { clearShadowManagers } from "./assembly_shadowManager.js";
import { setupHistory, recordState } from "./assembly_historyManager.js";
import { selectNode } from "./assembly_selectionManager.js";
import { getLoadedMaterialFiles, loadMaterialFile, clearMaterialManager } from "./assembly_materialManager.js";

let currentFileName = null;
let isModified = false;
const STORAGE_KEY_LAST_ASSEMBLY = "bd_last_assembly";

const statusBarText = document.getElementById("status-text");
const saveLoadModal = document.getElementById("save_load_modal");
const assemblyListContainer = document.getElementById("assembly-list");
const saveNameInput = document.getElementById("save-assembly-name");

export function setupAssemblyManager() {
	updateStatus();
	document.getElementById("btn-menu-save").onclick = () => handleSaveAction();
	document.getElementById("btn-menu-load").onclick = () => openLoadModal();
	document.getElementById("btn-menu-new").onclick = () => createNewAssembly();
	document.getElementById("btn-modal-save").onclick = () => {
		const name = saveNameInput.value.trim();
		if (name) saveAssemblyInternal(name);
	};

	setupHistory(serializeAssembly, loadAssemblyData);

	// Auto-load last part set
	const lastFile = localStorage.getItem(STORAGE_KEY_LAST_ASSEMBLY);
	if (lastFile) {
		console.log("Restoring last part set:", lastFile);
		loadAssemblyInternal(lastFile);
	}
}

export function markModified() {
	if (!isModified) {
		isModified = true;
		updateStatus();
	}
}

function updateStatus() {
	const file = currentFileName || "Untitled Set";
	const mod = isModified ? "*" : "";
	if (statusBarText) statusBarText.innerText = `${file}${mod}`;
}

// --- Importing Scenes ---

export async function importSceneAsAsset(filename, position = Vector3.Zero(), savedId = null) {
	try {
		const res = await fetch(`/api/parts?file=${filename}`);
		const result = await res.json();

		if (!result.success) {
			console.error("Failed to load part file:", filename);
			return;
		}

		const data = result.data;

		// 1. Create Root Node for this Scene Instance
		const baseId = savedId || filename.replace(".json", "_inst");
		const instanceId = getUniqueId(scene, baseId);

		const rootNode = new TransformNode(instanceId, scene);
		rootNode.position = position;
		rootNode.metadata = {
			isAssemblyRoot: true,
			isTransformNode: true,
			sourceFile: filename,
			sortIndex: 0
		};

		// 2. Load Materials
		if (data.materialFiles) {
			for (const matFile of data.materialFiles) {
				await loadMaterialFile(matFile);
			}
		}

		// 3. Reconstruct Hierarchy with Prefixing
		const idMap = new Map();
		const nameMap = new Map();
		const prefix = instanceId + "_";

		const p = (id) => id ? prefix + id : null;

		// Transform Nodes
		if (data.transformNodes) {
			data.transformNodes.forEach(nodeData => {
				const newId = p(nodeData.id);
				const node = new TransformNode(newId, scene);
				node.name = nodeData.name;
				node.position.set(nodeData.position.x, nodeData.position.y, nodeData.position.z);
				node.rotationQuaternion = new Quaternion(nodeData.rotation.x, nodeData.rotation.y, nodeData.rotation.z, nodeData.rotation.w);
				node.scaling.set(nodeData.scaling.x, nodeData.scaling.y, nodeData.scaling.z);

				node.metadata = { isTransformNode: true, isInternal: true };
				idMap.set(nodeData.id, node);
				if (nodeData.name) nameMap.set(nodeData.name, node);

				// NEW: Apply visibility from source file
				if (nodeData.visible !== undefined) node.setEnabled(nodeData.visible);
			});
		}

		// Lights
		if (data.lights) {
			data.lights.forEach(lightData => {
				const newId = p(lightData.id);
				const lightDataClone = { ...lightData, id: newId };
				const proxy = createLight(lightData.type, lightDataClone, scene);
				if (proxy) {
					proxy.parent = rootNode;
					proxy.metadata.isInternal = true;
					proxy.isPickable = false;
					idMap.set(lightData.id, proxy);
					if (lightData.name) nameMap.set(lightData.name, proxy);

					// NEW: Apply visibility from source file
					if (lightData.visible !== undefined) proxy.setEnabled(lightData.visible);
				}
			});
		}

		// Meshes
		if (data.meshes) {
			data.meshes.forEach(meshData => {
				const meshDataClone = { ...meshData, id: p(meshData.id) };
				let mesh;

				// NEW: Check for Shape vs Primitive
				if (meshData.isShape) {
					mesh = createShapeMesh(meshData.shapeData, meshData.shapeName || meshData.name, meshDataClone);
				} else {
					mesh = createPrimitive(meshData.type, meshDataClone);
				}

				if (mesh) {
					if (meshData.materialId) {
						const mat = scene.getMaterialByID(meshData.materialId);
						if (mat) mesh.material = mat;
					}
					// Ensure metadata exists and mark as internal
					if (!mesh.metadata) mesh.metadata = {};
					mesh.metadata.isInternal = true;

					idMap.set(meshData.id, mesh);
					if (meshData.name) nameMap.set(meshData.name, mesh);

					// NEW: Apply visibility from source file
					if (meshData.visible !== undefined) mesh.setEnabled(meshData.visible);
				}
			});
		}

		// 4. Restore Parenting
		const restoreParents = (list) => {
			if (!list) return;
			list.forEach(d => {
				const child = idMap.get(d.id);
				if (child) {
					if (d.parentId) {
						let parent = idMap.get(d.parentId);
						if (!parent) parent = nameMap.get(d.parentId);

						if (parent) child.parent = parent;
						else child.parent = rootNode;
					} else {
						child.parent = rootNode;
					}
				}
			});
		};

		restoreParents(data.transformNodes);
		restoreParents(data.lights);
		restoreParents(data.meshes);

		markModified();
		refreshSceneGraph();
		recordState();

		return rootNode;

	} catch (e) {
		console.error("Error importing part:", e);
	}
}


// --- Saving / Loading Assemblies ---

function serializeAssembly() {
	const data = {
		version: 1.1, // Bumped version
		type: "assembly",
		scenes: [],
		lights: []
	};

	// 1. Serialize Imported Scenes (Roots)
	scene.transformNodes.forEach(node => {
		if (node.metadata && node.metadata.isAssemblyRoot) {

			let rot = { x: 0, y: 0, z: 0, w: 1 };
			if (node.rotationQuaternion) {
				rot = { x: node.rotationQuaternion.x, y: node.rotationQuaternion.y, z: node.rotationQuaternion.z, w: node.rotationQuaternion.w };
			} else {
				const q = Quaternion.FromEulerVector(node.rotation);
				rot = { x: q.x, y: q.y, z: q.z, w: q.w };
			}

			data.scenes.push({
				id: node.id,
				sourceFile: node.metadata.sourceFile,
				position: { x: node.position.x, y: node.position.y, z: node.position.z },
				rotation: rot,
				scaling: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
				name: node.name,
				// NEW: Save visibility of the whole part set root
				visible: node.isEnabled()
			});
		}
	});

	// 2. Serialize Local Lights
	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isLightProxy && !mesh.metadata.isInternal) {
			const light = scene.getLightByID(mesh.metadata.lightId);
			if (light) {
				data.lights.push({
					id: light.id,
					type: mesh.metadata.lightType,
					position: { x: light.position.x, y: light.position.y, z: light.position.z },
					direction: light.direction ? { x: light.direction.x, y: light.direction.y, z: light.direction.z } : null,
					intensity: light.intensity,
					diffuse: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b },
					name: mesh.name,
					parentId: light.parent ? light.parent.id : null,
					// NEW: Save visibility
					visible: mesh.isEnabled()
				});
			}
		}
	});

	return data;
}

async function saveAssemblyInternal(name) {
	const data = serializeAssembly();
	try {
		const response = await fetch('/api/assemblies', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name, data: data })
		});

		const result = await response.json();
		if (result.success) {
			currentFileName = result.filename;
			localStorage.setItem(STORAGE_KEY_LAST_ASSEMBLY, currentFileName);
			isModified = false;
			updateStatus();
			saveLoadModal.close();
		} else {
			alert("Error saving: " + result.error);
		}
	} catch (e) {
		console.error(e);
		alert("Failed to connect.");
	}
}

export async function loadAssemblyData(data) {
	createNewAssembly();

	// 1. Load Scenes
	if (data.scenes) {
		for (const s of data.scenes) {
			// Pass s.id as savedId to ensure ID stability for parenting
			const root = await importSceneAsAsset(s.sourceFile, Vector3.Zero(), s.id);
			if (root) {
				root.name = s.name;
				root.position.set(s.position.x, s.position.y, s.position.z);
				root.rotationQuaternion = new Quaternion(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
				root.scaling.set(s.scaling.x, s.scaling.y, s.scaling.z);
				// NEW: Restore visibility of the whole part set root
				if (s.visible !== undefined) root.setEnabled(s.visible);
			}
		}
	}

	// 2. Load Lights
	if (data.lights) {
		data.lights.forEach(l => {
			const proxy = createLight(l.type, l, scene);
			if (proxy) {
				if (l.parentId) {
					const parent = scene.getMeshByID(l.parentId) ||
						scene.getTransformNodeByID(l.parentId) ||
						scene.getLightByID(l.parentId);

					if (parent) {
						proxy.parent = parent;
						const light = scene.getLightByID(proxy.metadata.lightId);
						if (light) light.parent = parent;
					}
				}
				// NEW: Restore visibility
				if (l.visible !== undefined) proxy.setEnabled(l.visible);
			}
		});
	}

	refreshSceneGraph();
}

async function loadAssemblyInternal(filename) {
	try {
		const response = await fetch(`/api/assemblies?file=${filename}`);
		const result = await response.json();

		if (!result.success) {
			if (filename === localStorage.getItem(STORAGE_KEY_LAST_ASSEMBLY)) {
				localStorage.removeItem(STORAGE_KEY_LAST_ASSEMBLY);
			}
			alert("Could not load file.");
			return;
		}

		await loadAssemblyData(result.data);

		currentFileName = filename;
		localStorage.setItem(STORAGE_KEY_LAST_ASSEMBLY, currentFileName);
		isModified = false;
		updateStatus();
		saveLoadModal.close();
	} catch (e) {
		console.error(e);
		alert("Error parsing JSON.");
	}
}

function createNewAssembly() {
	currentFileName = null;
	localStorage.removeItem(STORAGE_KEY_LAST_ASSEMBLY);
	isModified = false;

	disposeGizmos();
	clearShadowManagers();
	clearMaterialManager();
	selectNode(null);

	const toDispose = [];
	scene.meshes.forEach(m => {
		if (m.name !== "previewSphere" && m.name !== "hdrSkyBox" && !m.name.startsWith("gizmo")) {
			toDispose.push(m);
		}
	});
	scene.transformNodes.forEach(t => {
		if (t.name !== "axisRoot") toDispose.push(t);
	});
	scene.lights.forEach(l => {
		if (l.name !== "hemiLight") toDispose.push(l);
	});

	toDispose.forEach(n => n.dispose());

	setupGizmos(scene);
	updateStatus();
	updatePropertyEditor([]);
	refreshSceneGraph();
}

// ... UI Helpers (handleSaveAction, openSaveModal, etc) ...
function handleSaveAction() {
	if (currentFileName) saveAssemblyInternal(currentFileName.replace(".json", ""));
	else openSaveModal();
}

function openSaveModal() {
	populateAssemblyList("save");
	saveNameInput.value = "";
	document.getElementById("modal-title").innerText = "Save Assembly";
	document.getElementById("btn-modal-save").classList.remove("hidden");
	saveLoadModal.showModal();
}

function openLoadModal() {
	populateAssemblyList("load");
	document.getElementById("modal-title").innerText = "Load Assembly";
	document.getElementById("btn-modal-save").classList.add("hidden");
	saveLoadModal.showModal();
}

async function populateAssemblyList(mode) {
	assemblyListContainer.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/assemblies');
		const data = await res.json();
		assemblyListContainer.innerHTML = "";
		if (!data.files || data.files.length === 0) {
			assemblyListContainer.innerHTML = "<p class='text-sm opacity-50'>No part sets found.</p>";
			return;
		}
		data.files.forEach(file => {
			const row = document.createElement("div");
			row.className = "flex justify-between items-center bg-base-200 p-2 rounded hover:bg-base-300 cursor-pointer";
			const span = document.createElement("span");
			span.innerText = file;
			span.onclick = () => {
				if (mode === "load") loadAssemblyInternal(file);
				else saveNameInput.value = file.replace(".json", "");
			};
			const btnDelete = document.createElement("button");
			btnDelete.className = "btn btn-xs btn-error btn-outline";
			btnDelete.innerText = "X";
			btnDelete.onclick = async (e) => {
				e.stopPropagation();
				if (confirm(`Delete "${file}"?`)) {
					await fetch(`/api/assemblies?file=${file}`, { method: 'DELETE' });
					populateAssemblyList(mode);
				}
			};
			row.appendChild(span);
			row.appendChild(btnDelete);
			assemblyListContainer.appendChild(row);
		});
	} catch (e) {
		assemblyListContainer.innerHTML = "<p class='text-error'>Failed to fetch part sets.</p>";
	}
}