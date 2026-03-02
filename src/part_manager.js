import { Quaternion, StandardMaterial, Color3 } from "@babylonjs/core";
import { part, resetAxisIndicator, getSkipMaterialNames } from "./part.js";
import { setupGizmos, disposeGizmos } from "./part_gizmoControl.js";
import { updatePropertyEditor } from "./part_propertyEditor.js";
import { refreshPartGraph } from "./part_treeViewManager.js";
import { createPrimitive, createShapeMesh } from "./part_ui.js";
import { createLight } from "./part_lightManager.js";
import { createTransformNode } from "./part_transformNodeManager.js";
import { clearShadowManagers } from "./part_shadowManager.js";
import { setupHistory } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { getLoadedMaterialFiles, loadMaterialFile, clearMaterialManager } from "./part_materialManager.js";
import { updateCSG, getNegativeMaterial } from "./part_csgManager.js";

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
	document.getElementById("btn-menu-save-as").onclick = () => handleSaveAsAction();
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

function handleSaveAsAction() {
	openSaveModal(currentFileName);
}

function openSaveModal(prefillName = null) {
	populateSceneList("save");
	saveNameInput.value = prefillName ? prefillName.replace(".json", "") : "";
	document.getElementById("modal-title").innerText = "Save Part";
	document.getElementById("btn-modal-save").classList.remove("hidden");
	saveLoadModal.showModal();
}

function openLoadModal() {
	populateSceneList("load");
	document.getElementById("modal-title").innerText = "Load Part";
	document.getElementById("btn-modal-save").classList.add("hidden");
	saveLoadModal.showModal();
}

export function serializeScene() {
	const data = {
		version: 1.5,
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
					angle: light.angle !== undefined ? light.angle : null,
					exponent: light.exponent !== undefined ? light.exponent : null,
					intensity: light.intensity,
					diffuse: { r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b },
					parentId: light.parent ? light.parent.id : null,
					sortIndex: mesh.metadata.sortIndex || 0,
					visible: mesh.isEnabled(),
					isLocked: mesh.metadata.isLocked || false // Added
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
				visible: node.isEnabled(),
				isLocked: node.metadata.isLocked || false // Added
			});
		}
	});

	part.meshes.forEach(mesh => {
		if (mesh.metadata && (mesh.metadata.isPrimitive || mesh.metadata.isShape)) {
			let rot = { x: 0, y: 0, z: 0, w: 1 };
			if (mesh.rotationQuaternion) {
				rot = { x: mesh.rotationQuaternion.x, y: mesh.rotationQuaternion.y, z: mesh.rotationQuaternion.z, w: mesh.rotationQuaternion.w };
			} else {
				const q = Quaternion.FromEulerVector(mesh.rotation);
				rot = { x: q.x, y: q.y, z: q.z, w: q.w };
			}

			const pivot = mesh.getPivotPoint();

			let uScale = 1;
			let vScale = 1;
			if (mesh.material) {
				const tex = mesh.material.diffuseTexture || mesh.material.bumpTexture;
				if (tex) {
					uScale = tex.uScale;
					vScale = tex.vScale;
				}
			}

			const meshData = {
				id: mesh.id,
				name: mesh.name,
				position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
				rotation: rot,
				scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z },
				pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
				materialId: mesh.material ? mesh.material.id : null,
				uScale: uScale,
				vScale: vScale,
				parentId: mesh.parent ? mesh.parent.id : null,
				receiveShadows: mesh.receiveShadows,
				castShadows: mesh.metadata.castShadows || false,
				sortIndex: mesh.metadata.sortIndex || 0,
				visible: mesh.isEnabled(),
				isNegative: mesh.metadata.isNegative || false,
				originalMaterialId: mesh.metadata.originalMaterialId || null,
				isLocked: mesh.metadata.isLocked || false // Added
			};

			if (mesh.metadata.isPrimitive) {
				meshData.isPrimitive = true;
				meshData.type = mesh.metadata.type;
			} else if (mesh.metadata.isShape) {
				meshData.isShape = true;
				meshData.shapeData = mesh.metadata.shapeData;
				meshData.shapeName = mesh.metadata.shapeName;
			}

			data.meshes.push(meshData);
		}
	});

	return data;
}

async function saveSceneInternal(name) {
	const data = serializeScene();
	try {
		const response = await fetch('/api/parts', {
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
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy || m.metadata.isCSGResult)) toDispose.push(m);
	});
	part.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && t.metadata.isTransformNode) toDispose.push(t);
	});
	part.lights.forEach(l => {
		if (l.name !== "hemiLight" && l.name !== "light") toDispose.push(l);
	});

	toDispose.forEach(n => n.dispose());

	const matsToDispose = part.materials.filter(m => m.name !== "default material" && m.name !== "lightMat" && m.name !== "previewMat" && m.name !== "transformNodeMat" && m.name !== "negativeMat");
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
				if (node.metadata) {
					node.metadata.sortIndex = nodeData.sortIndex || 0;
					node.metadata.isLocked = nodeData.isLocked || false; // Added
				}
				if (nodeData.visible !== undefined) node.setEnabled(nodeData.visible);
			}
		});
	}

	if (data.meshes) {
		data.meshes.forEach(meshData => {
			let mesh;
			if (meshData.isPrimitive) {
				mesh = createPrimitive(meshData.type, meshData);
			} else if (meshData.isShape) {
				mesh = createShapeMesh(meshData.shapeData, meshData.shapeName, meshData);
			}

			if (mesh) {
				idMap.set(meshData.id, mesh.id);

				if (meshData.isNegative) {
					mesh.metadata.isNegative = true;
					mesh.metadata.originalMaterialId = meshData.originalMaterialId;
				}

				if (meshData.materialId) {
					const mat = part.getMaterialByID(meshData.materialId);
					if (mat) {
						if (meshData.isNegative) {
							mesh.metadata.originalMaterialId = mat.id;
						} else {
							mesh.material = mat;
						}
						if (meshData.uScale !== undefined && meshData.vScale !== undefined) {
							if (mat.diffuseTexture) {
								mat.diffuseTexture.uScale = meshData.uScale;
								mat.diffuseTexture.vScale = meshData.vScale;
							}
							if (mat.bumpTexture) {
								mat.bumpTexture.uScale = meshData.uScale;
								mat.bumpTexture.vScale = meshData.vScale;
							}
						}
					}
				}

				if (meshData.isNegative) {
					mesh.material = getNegativeMaterial(part);
				}

				mesh.receiveShadows = !!meshData.receiveShadows;
				if (mesh.metadata) {
					mesh.metadata.sortIndex = meshData.sortIndex || 0;
					mesh.metadata.isLocked = meshData.isLocked || false; // Added
				}
				if (meshData.visible !== undefined) mesh.setEnabled(meshData.visible);
			}
		});
	}

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
	restoreParents(data.meshes);

	if (data.lights) {
		data.lights.forEach(lightData => {
			if (lightData.type === "directional") return;

			const proxy = createLight(lightData.type, lightData, part);
			if (proxy) {
				const light = part.getLightByID(proxy.metadata.lightId);
				if (light) {
					idMap.set(lightData.id, light.id);
				}
				if (proxy.metadata) {
					proxy.metadata.sortIndex = lightData.sortIndex || 0;
					proxy.metadata.isLocked = lightData.isLocked || false; // Added
				}
				if (lightData.visible !== undefined) proxy.setEnabled(lightData.visible);
			}
		});
	}
	restoreParents(data.lights);

	setupGizmos(part);
	resetAxisIndicator();
	updateCSG();
	refreshPartGraph();
}

async function loadSceneInternal(filename) {
	try {
		const response = await fetch(`/api/parts?file=${filename}`);
		const result = await response.json();

		if (!result.success) {
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
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy || m.metadata.isCSGResult)) m.dispose();
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
	refreshPartGraph();
}

async function populateSceneList(mode) {
	sceneListContainer.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/parts');
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
					await fetch(`/api/parts?file=${file}`, { method: 'DELETE' });
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