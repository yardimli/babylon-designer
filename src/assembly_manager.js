import { TransformNode, Quaternion, Vector3, Color3, Color4, StandardMaterial, Mesh, SceneLoader } from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Enable GLTF/GLB loader
import { scene, camera, resetAxisIndicator, getUniqueId, engine } from "./assembly_scene.js";
import { setupGizmos, disposeGizmos } from "./assembly_gizmoControl.js";
import { updatePropertyEditor } from "./assembly_propertyEditor.js";
import { refreshSceneGraph } from "./assembly_treeViewManager.js";
import { createLight } from "./assembly_lightManager.js";
import { createTransformNode } from "./assembly_transformNodeManager.js";
import { createPrimitive, createShapeMesh } from "./assembly_primitives.js";
import { clearShadowManagers, setShadowCaster } from "./assembly_shadowManager.js";
import { setupHistory, recordState } from "./assembly_historyManager.js";
import { selectNode } from "./assembly_selectionManager.js";
import { getLoadedMaterialFiles, loadMaterialFile, clearMaterialManager } from "./assembly_materialManager.js";
import { updateCSG, getNegativeMaterial } from "./assembly_csgManager.js";

let currentFileName = null;
let isModified = false;
const STORAGE_KEY_LAST_ASSEMBLY = "bd_last_assembly";

const statusBarText = document.getElementById("status-text");
const statFps = document.getElementById("stat-fps");
const statMeshes = document.getElementById("stat-meshes");
const statVerts = document.getElementById("stat-verts");
const statMem = document.getElementById("stat-mem");

const saveLoadModal = document.getElementById("save_load_modal");
const assemblyListContainer = document.getElementById("assembly-list");
const saveNameInput = document.getElementById("save-assembly-name");

export function setupAssemblyManager() {
	updateStatus();
	document.getElementById("btn-menu-save").onclick = () => handleSaveAction();
	document.getElementById("btn-menu-save-as").onclick = () => handleSaveAsAction();
	document.getElementById("btn-menu-load").onclick = () => openLoadModal();
	document.getElementById("btn-menu-new").onclick = () => createNewAssembly(true); // Pass true to reset camera and settings
	document.getElementById("btn-modal-save").onclick = () => {
		const name = saveNameInput.value.trim();
		if (name) saveAssemblyInternal(name);
	};

	setupHistory(serializeAssembly, loadAssemblyData);
	startStatsUpdater();

	// Auto-load last part set
	const lastFile = localStorage.getItem(STORAGE_KEY_LAST_ASSEMBLY);
	if (lastFile) {
		console.log("Restoring last part set:", lastFile);
		loadAssemblyInternal(lastFile);
	}
}

function startStatsUpdater() {
	setInterval(() => {
		if (!engine) return;
		if (statFps) statFps.innerText = engine.getFps().toFixed(0) + " FPS";
		if (scene) {
			if (statMeshes) statMeshes.innerText = scene.meshes.length + " Meshes";
			if (statVerts) statVerts.innerText = (scene.totalVertices || 0).toLocaleString() + " Verts";
		}
		if (statMem && window.performance && window.performance.memory) {
			const mem = Math.round(window.performance.memory.usedJSHeapSize / 1048576);
			statMem.innerText = mem + " MB";
		}
	}, 1000);
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

		// Calculate Sort Index (Append to end)
		let maxIndex = 0;
		scene.transformNodes.forEach(n => {
			if (n.metadata && n.metadata.isAssemblyRoot) {
				const idx = n.metadata.sortIndex || 0;
				if (idx > maxIndex) maxIndex = idx;
			}
		});

		const rootNode = new TransformNode(instanceId, scene);
		rootNode.position = position;
		rootNode.metadata = {
			isAssemblyRoot: true,
			isTransformNode: true,
			sourceFile: filename,
			sortIndex: maxIndex + 100 // Default to end of list
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

					if (lightData.visible !== undefined) proxy.setEnabled(lightData.visible);
				}
			});
		}

		// Meshes
		if (data.meshes) {
			// Changed to for...of loop to handle async shape loading
			for (const meshData of data.meshes) {
				const meshDataClone = { ...meshData, id: p(meshData.id) };
				let mesh;

				// Handle Imported Mesh (GLTF/GLB)
				if (meshData.isImportedMesh && meshData.meshFilename) {
					try {
						// Import mesh from file
						const importResult = await SceneLoader.ImportMeshAsync("", "/meshes/", meshData.meshFilename, scene);

						if (importResult.meshes.length > 0) {
							mesh = importResult.meshes[0]; // The root of the imported GLTF

							// Configure Root
							mesh.id = meshDataClone.id;
							mesh.name = meshData.name;

							// Apply Transform
							mesh.position.set(meshData.position.x, meshData.position.y, meshData.position.z);
							if (meshData.rotation.w !== undefined) {
								if (!mesh.rotationQuaternion) mesh.rotationQuaternion = new Quaternion();
								mesh.rotationQuaternion.set(meshData.rotation.x, meshData.rotation.y, meshData.rotation.z, meshData.rotation.w);
							} else {
								mesh.rotationQuaternion = Quaternion.FromEulerAngles(meshData.rotation.x, meshData.rotation.y, meshData.rotation.z);
							}
							mesh.scaling.set(meshData.scaling.x, meshData.scaling.y, meshData.scaling.z);

							// Apply Metadata
							if (!mesh.metadata) mesh.metadata = {};
							mesh.metadata.isInternal = true; // Hide from tree
							mesh.metadata.isMesh = true; // Mark as imported mesh
							mesh.metadata.meshFilename = meshData.meshFilename;

							// Apply Material to children if specified (overriding GLB materials)
							if (meshData.materialId) {
								const mat = scene.getMaterialByID(meshData.materialId);
								if (mat) {
									mesh.material = mat;
									mesh.getChildMeshes().forEach(c => c.material = mat);
								}
							}

							// Apply Shadows
							if (meshData.castShadows) {
								setShadowCaster(mesh, true);
								mesh.getChildMeshes().forEach(c => setShadowCaster(c, true));
							}

							// Mark children as internal and pickable
							importResult.meshes.forEach(m => {
								if (m !== mesh) {
									if (!m.metadata) m.metadata = {};
									m.metadata.isInternal = true;
									m.isPickable = true; // Allow picking to bubble up
								}
							});
						}
					} catch (e) {
						console.error("Failed to load imported mesh:", meshData.meshFilename, e);
					}
				}
				else if (meshData.isShape) {
					// Check for shapeFilename reference (New System)
					if (meshData.shapeFilename) {
						try {
							const res = await fetch(`/api/shapes?file=${meshData.shapeFilename}`);
							const json = await res.json();
							if (json.success) {
								mesh = createShapeMesh(json.data, meshData.shapeName || meshData.name, meshDataClone);
								// Preserve filename in metadata
								if (mesh && mesh.metadata) mesh.metadata.shapeFilename = meshData.shapeFilename;
							} else {
								console.warn("Shape file not found:", meshData.shapeFilename);
							}
						} catch (e) {
							console.error("Error loading shape:", e);
						}
					}
					// Fallback to embedded shapeData (Legacy)
					else if (meshData.shapeData) {
						mesh = createShapeMesh(meshData.shapeData, meshData.shapeName || meshData.name, meshDataClone);
					}
				} else {
					mesh = createPrimitive(meshData.type, meshDataClone);
				}

				if (mesh) {
					if (meshData.isNegative) {
						mesh.metadata.isNegative = true;
						mesh.metadata.originalMaterialId = meshData.originalMaterialId;
					}

					if (meshData.materialId && !meshData.isImportedMesh) {
						const mat = scene.getMaterialByID(meshData.materialId);
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
						mesh.material = getNegativeMaterial(scene);
					}

					if (!mesh.metadata) mesh.metadata = {};
					mesh.metadata.isInternal = true;

					idMap.set(meshData.id, mesh);
					if (meshData.name) nameMap.set(meshData.name, mesh);

					if (meshData.visible !== undefined) mesh.setEnabled(meshData.visible);

					// Freeze world matrix for performance on static parts, unless it's a hierarchy (like GLTF)
					if (!meshData.isImportedMesh) {
						mesh.freezeWorldMatrix();
					}

				}
			}
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

		updateCSG();

		// 5. Merge Meshes for the imported part
		// Note: We skip merging for imported GLTF meshes to preserve their structure/materials
		let merge_meshes = true;
		if (merge_meshes) {
			const allChildMeshes = rootNode.getChildMeshes(false);
			const meshesToMerge = [];
			const meshesToDispose =[];

			allChildMeshes.forEach(m => {
				if (m.metadata && m.metadata.isLightProxy) return;

				// Skip imported GLTF hierarchies from merging
				let isImported = false;
				let check = m;
				while(check) {
					if (check.metadata && check.metadata.isMesh) {
						isImported = true;
						break;
					}
					check = check.parent;
				}
				if (isImported) return;

				if (m.isVisible && m.isEnabled()) {
					meshesToMerge.push(m);
				} else {
					meshesToDispose.push(m);
				}
			});

			if (meshesToMerge.length > 0) {
				const merged = Mesh.MergeMeshes(meshesToMerge, false, true, undefined, false, true);
				if (merged) {
					merged.name = rootNode.name + "_visuals";
					merged.metadata = { isInternal: true };
					merged.setParent(rootNode);

					merged.receiveShadows = true;
					setShadowCaster(merged, true);

					merged.isPickable = true;
				}
			}

			// Only dispose primitives that were merged. Don't touch GLTF meshes.
			[...meshesToMerge, ...meshesToDispose].forEach(m => {
				if (!m.isDisposed()) m.dispose();
			});
		}

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
		version: 1.2, // Bumped version for scene settings
		type: "assembly",
		scenes: [],
		lights:[],
		sceneSettings: {}
	};

	// Save Scene Settings
	if (scene.clearColor) {
		data.sceneSettings.clearColor = { r: scene.clearColor.r, g: scene.clearColor.g, b: scene.clearColor.b };
	}
	const hemiLight = scene.getLightByName("hemiLight");
	if (hemiLight) {
		data.sceneSettings.ambientIntensity = hemiLight.intensity;
		data.sceneSettings.diffuseColor = { r: hemiLight.diffuse.r, g: hemiLight.diffuse.g, b: hemiLight.diffuse.b };
		data.sceneSettings.groundColor = { r: hemiLight.groundColor.r, g: hemiLight.groundColor.g, b: hemiLight.groundColor.b };
	}

	const roots = scene.transformNodes.filter(node => node.metadata && node.metadata.isAssemblyRoot);
	roots.sort((a, b) => (a.metadata.sortIndex || 0) - (b.metadata.sortIndex || 0));

	roots.forEach(node => {
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
			visible: node.isEnabled(),
			sortIndex: node.metadata.sortIndex,
			isLocked: node.metadata.isLocked || false
		});
	});

	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isLightProxy && !mesh.metadata.isInternal) {
			const light = scene.getLightByID(mesh.metadata.lightId);
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
					name: mesh.name,
					parentId: light.parent ? light.parent.id : null,
					visible: mesh.isEnabled(),
					isLocked: mesh.metadata.isLocked || false
				});
			}
		}
	});

	return data;
}

async function saveAssemblyInternal(name) {
	const data = serializeAssembly();

	// Inject camera state for file saving only (not for undo/redo history)
	if (camera) {
		data.camera = {
			alpha: camera.alpha,
			beta: camera.beta,
			radius: camera.radius,
			target: { x: camera.target.x, y: camera.target.y, z: camera.target.z }
		};
	}

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
	createNewAssembly(false); // Pass false to avoid resetting camera/settings on undo

	// 1. Load Scenes
	if (data.scenes) {
		for (const s of data.scenes) {
			const root = await importSceneAsAsset(s.sourceFile, Vector3.Zero(), s.id);
			if (root) {
				root.name = s.name;
				root.position.set(s.position.x, s.position.y, s.position.z);
				root.rotationQuaternion = new Quaternion(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
				root.scaling.set(s.scaling.x, s.scaling.y, s.scaling.z);
				if (s.visible !== undefined) root.setEnabled(s.visible);
				if (s.sortIndex !== undefined) root.metadata.sortIndex = s.sortIndex;
				if (s.isLocked !== undefined) root.metadata.isLocked = s.isLocked;
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
				if (l.visible !== undefined) proxy.setEnabled(l.visible);
				if (l.isLocked !== undefined) proxy.metadata.isLocked = l.isLocked;
			}
		});
	}

	// 3. Apply Scene Settings
	const hemiLight = scene.getLightByName("hemiLight");
	if (data.sceneSettings) {
		if (data.sceneSettings.clearColor) {
			scene.clearColor = new Color4(data.sceneSettings.clearColor.r, data.sceneSettings.clearColor.g, data.sceneSettings.clearColor.b, 1);
		}
		if (hemiLight) {
			if (data.sceneSettings.ambientIntensity !== undefined) hemiLight.intensity = data.sceneSettings.ambientIntensity;
			if (data.sceneSettings.diffuseColor) hemiLight.diffuse = new Color3(data.sceneSettings.diffuseColor.r, data.sceneSettings.diffuseColor.g, data.sceneSettings.diffuseColor.b);
			if (data.sceneSettings.groundColor) hemiLight.groundColor = new Color3(data.sceneSettings.groundColor.r, data.sceneSettings.groundColor.g, data.sceneSettings.groundColor.b);
		}
	} else {
		// Defaults
		scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
		if (hemiLight) {
			hemiLight.intensity = 0.7;
			hemiLight.diffuse = new Color3(1, 1, 1);
			hemiLight.groundColor = new Color3(0.5, 0.5, 0.5);
		}
	}

	// 4. Apply Camera (only if present in file)
	if (data.camera && camera) {
		camera.alpha = data.camera.alpha;
		camera.beta = data.camera.beta;
		camera.radius = data.camera.radius;
		if (data.camera.target) {
			camera.target.set(data.camera.target.x, data.camera.target.y, data.camera.target.z);
		}
	}

	updateCSG();
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

function createNewAssembly(resetAll = false) {
	currentFileName = null;
	localStorage.removeItem(STORAGE_KEY_LAST_ASSEMBLY);
	isModified = false;

	disposeGizmos();
	clearShadowManagers();
	clearMaterialManager();
	selectNode(null);

	const toDispose =[];
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

	// Reset camera and settings only if requested (e.g., clicking "New Set")
	if (resetAll) {
		scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
		const hemiLight = scene.getLightByName("hemiLight");
		if (hemiLight) {
			hemiLight.intensity = 0.7;
			hemiLight.diffuse = new Color3(1, 1, 1);
			hemiLight.groundColor = new Color3(0.5, 0.5, 0.5);
		}
		if (camera) {
			camera.alpha = -Math.PI / 2;
			camera.beta = Math.PI / 2.5;
			camera.radius = 10;
			camera.target.set(0, 0, 0);
		}
	}

	setupGizmos(scene);
	updateStatus();
	updatePropertyEditor([]);
	refreshSceneGraph();
}

function handleSaveAction() {
	if (currentFileName) saveAssemblyInternal(currentFileName.replace(".json", ""));
	else openSaveModal();
}

function handleSaveAsAction() {
	openSaveModal(currentFileName);
}

function openSaveModal(prefillName = null) {
	populateAssemblyList("save");
	saveNameInput.value = prefillName ? prefillName.replace(".json", "") : "";
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
