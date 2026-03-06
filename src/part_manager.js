import { Quaternion, Color3, Color4 } from "@babylonjs/core";
import { part, resetAxisIndicator, camera } from "./part.js";
import { setupGizmos, disposeGizmos } from "./part_gizmoControl.js";
import { refreshPartGraph } from "./part_treeViewManager.js";
import { createPrimitive, createShapeMesh } from "./part_ui.js";
import { createLight } from "./part_lightManager.js";
import { createTransformNode } from "./part_transformNodeManager.js";
import { clearShadowManagers } from "./part_shadowManager.js";
import { setupHistory } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { getLoadedMaterialFiles, loadMaterialFile, clearMaterialManager } from "./part_materialManager.js";
import { updateCSG, getNegativeMaterial } from "./part_csgManager.js";
import { loadMeshFile } from "./part_meshManager.js";

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
	const hemiLight = part.getLightByName("hemiLight");

	// Modified: Save colors as RGB objects instead of Hex strings
	const sceneSettings = {
		clearColor: { r: part.clearColor.r, g: part.clearColor.g, b: part.clearColor.b },
		ambientIntensity: hemiLight ? hemiLight.intensity : 1,
		diffuseColor: hemiLight ? { r: hemiLight.diffuse.r, g: hemiLight.diffuse.g, b: hemiLight.diffuse.b } : { r: 1, g: 1, b: 1 },
		groundColor: hemiLight ? { r: hemiLight.groundColor.r, g: hemiLight.groundColor.g, b: hemiLight.groundColor.b } : { r: 0, g: 0, b: 0 }
	};

	const cameraSettings = camera ? {
		alpha: camera.alpha,
		beta: camera.beta,
		radius: camera.radius,
		target: { x: camera.target.x, y: camera.target.y, z: camera.target.z }
	} : null;

	const data = {
		version: 1.7,
		sceneSettings: sceneSettings,
		cameraSettings: cameraSettings,
		materialFiles: getLoadedMaterialFiles(),
		lights: [],
		meshes: [],
		transformNodes:[]
	};

	// Helper to check if a node is a child of an imported mesh
	const isChildOfImportedMesh = (node) => {
		let parent = node.parent;
		while (parent) {
			if (parent.metadata && parent.metadata.isMesh) return true;
			parent = parent.parent;
		}
		return false;
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
					isLocked: mesh.metadata.isLocked || false
				});
			}
		}
	});

	part.transformNodes.forEach(node => {
		if (node.metadata && node.metadata.isInternal) return;

		// Skip nodes that are part of an imported mesh hierarchy
		if (isChildOfImportedMesh(node)) return;

		// Handle Imported Mesh Roots (GLTF __root__ is often a TransformNode or Mesh)
		if (node.metadata && node.metadata.isMesh) {
			saveMeshNode(node, data);
			return;
		}

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
				isLocked: node.metadata.isLocked || false
			});
		}
	});

	part.meshes.forEach(mesh => {
		// Skip internal or children of imported meshes
		if (isChildOfImportedMesh(mesh)) return;

		// Handle Imported Mesh Roots (if they are Meshes)
		if (mesh.metadata && mesh.metadata.isMesh) {
			saveMeshNode(mesh, data);
			return;
		}

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
				isLocked: mesh.metadata.isLocked || false
			};

			if (mesh.metadata.isPrimitive) {
				meshData.isPrimitive = true;
				meshData.type = mesh.metadata.type;
			} else if (mesh.metadata.isShape) {
				meshData.isShape = true;
				meshData.shapeName = mesh.metadata.shapeName;
				meshData.shapeFilename = mesh.metadata.shapeFilename;
			}

			data.meshes.push(meshData);
		}
	});

	return data;
}

// Helper to save common properties for imported meshes
function saveMeshNode(node, data) {
	let rot = { x: 0, y: 0, z: 0, w: 1 };
	if (node.rotationQuaternion) {
		rot = { x: node.rotationQuaternion.x, y: node.rotationQuaternion.y, z: node.rotationQuaternion.z, w: node.rotationQuaternion.w };
	} else {
		const q = Quaternion.FromEulerVector(node.rotation);
		rot = { x: q.x, y: q.y, z: q.z, w: q.w };
	}

	data.meshes.push({
		isImportedMesh: true,
		id: node.id,
		name: node.name,
		meshFilename: node.metadata.meshFilename,
		position: { x: node.position.x, y: node.position.y, z: node.position.z },
		rotation: rot,
		scaling: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
		parentId: node.parent ? node.parent.id : null,
		castShadows: node.metadata.castShadows || false,
		sortIndex: node.metadata.sortIndex || 0,
		visible: node.isEnabled(),
		isLocked: node.metadata.isLocked || false
	});
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

	const toDispose =[];
	part.meshes.forEach(m => {
		if (m.name === "previewSphere") return;
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy || m.metadata.isCSGResult || m.metadata.isMesh)) toDispose.push(m);
	});
	part.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && (t.metadata.isTransformNode || t.metadata.isMesh)) toDispose.push(t);
	});
	part.lights.forEach(l => {
		if (l.name !== "hemiLight" && l.name !== "light") toDispose.push(l);
	});

	toDispose.forEach(n => n.dispose());

	const matsToDispose = part.materials.filter(m => m.name !== "default material" && m.name !== "lightMat" && m.name !== "previewMat" && m.name !== "transformNodeMat" && m.name !== "negativeMat");
	matsToDispose.forEach(m => m.dispose());

	const idMap = new Map();

	// Added: Restore scene settings
	if (data.sceneSettings) {
		if (data.sceneSettings.clearColor) {
			// Modified: Handle Object {r,g,b} or legacy Hex string
			if (typeof data.sceneSettings.clearColor === "string") {
				const c3 = Color3.FromHexString(data.sceneSettings.clearColor);
				part.clearColor = new Color4(c3.r, c3.g, c3.b, 1);
			} else {
				const cc = data.sceneSettings.clearColor;
				part.clearColor = new Color4(cc.r, cc.g, cc.b, 1);
			}
		}
		const hemiLight = part.getLightByName("hemiLight");
		if (hemiLight) {
			if (data.sceneSettings.ambientIntensity !== undefined) hemiLight.intensity = data.sceneSettings.ambientIntensity;

			// Modified: Load diffuseColor (Object) or fallback to ambientDiffuse (Hex)
			if (data.sceneSettings.diffuseColor) {
				const dc = data.sceneSettings.diffuseColor;
				hemiLight.diffuse = new Color3(dc.r, dc.g, dc.b);
			} else if (data.sceneSettings.ambientDiffuse) {
				hemiLight.diffuse = Color3.FromHexString(data.sceneSettings.ambientDiffuse);
			}

			// Modified: Load groundColor (Object) or fallback to ambientGround (Hex)
			if (data.sceneSettings.groundColor) {
				const gc = data.sceneSettings.groundColor;
				hemiLight.groundColor = new Color3(gc.r, gc.g, gc.b);
			} else if (data.sceneSettings.ambientGround) {
				hemiLight.groundColor = Color3.FromHexString(data.sceneSettings.ambientGround);
			}
		}
	}

	// Added: Restore camera settings
	if (data.cameraSettings && camera) {
		camera.alpha = data.cameraSettings.alpha;
		camera.beta = data.cameraSettings.beta;
		camera.radius = data.cameraSettings.radius;
		if (data.cameraSettings.target) {
			camera.target.set(data.cameraSettings.target.x, data.cameraSettings.target.y, data.cameraSettings.target.z);
		}
	}

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
					node.metadata.isLocked = nodeData.isLocked || false;
				}
				if (nodeData.visible !== undefined) node.setEnabled(nodeData.visible);
			}
		});
	}

	if (data.meshes) {
		// Modified: Use for...of loop to handle async shape loading
		for (const meshData of data.meshes) {
			let mesh;
			if (meshData.isImportedMesh) {
				// Load GLTF/GLB
				mesh = await loadMeshFile(meshData.meshFilename, meshData);
			} else if (meshData.isPrimitive) {
				mesh = createPrimitive(meshData.type, meshData);
			} else if (meshData.isShape) {
				// Modified: Load shape from file if filename exists
				if (meshData.shapeFilename) {
					try {
						const res = await fetch(`/api/shapes?file=${meshData.shapeFilename}`);
						const json = await res.json();
						if (json.success) {
							mesh = createShapeMesh(json.data, meshData.shapeName, meshData);
							// Ensure filename is preserved in metadata
							if (mesh && mesh.metadata) mesh.metadata.shapeFilename = meshData.shapeFilename;
						} else {
							console.warn("Shape file not found:", meshData.shapeFilename);
						}
					} catch (e) {
						console.error("Error loading shape:", e);
					}
				} else if (meshData.shapeData) {
					// Fallback for legacy files containing raw data
					mesh = createShapeMesh(meshData.shapeData, meshData.shapeName, meshData);
				}
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
					mesh.metadata.isLocked = meshData.isLocked || false;
					if (meshData.shapeFilename) mesh.metadata.shapeFilename = meshData.shapeFilename; // Ensure it sticks
				}
				if (meshData.visible !== undefined) mesh.setEnabled(meshData.visible);
			}
		}
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
					proxy.metadata.isLocked = lightData.isLocked || false;
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
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape || m.metadata.isLightProxy || m.metadata.isTransformNodeProxy || m.metadata.isCSGResult || m.metadata.isMesh)) m.dispose();
	});
	part.transformNodes.forEach(t => {
		if (t.name !== "axisRoot" && t.metadata && (t.metadata.isTransformNode || t.metadata.isMesh)) t.dispose();
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
