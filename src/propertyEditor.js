import { Vector3, Quaternion, Color3, AbstractMesh } from "@babylonjs/core";
import { scene, getUniqueId } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectMesh } from "./gizmoControl.js";
import { createLight } from "./lightManager.js";
import { setShadowCaster, disposeShadowGenerator } from "./shadowManager.js";
import { createTransformNode } from "./transformNodeManager.js";
import { recordState } from "./historyManager.js";
// NEW: Import Tree View Manager functions
import { refreshSceneGraph, highlightInTree, setNodeParent } from "./treeViewManager.js";

let currentMesh = null; // Can be Mesh or TransformNode
let observer = null;

function createVec3Input(label, idPrefix, container) {
	const wrapper = document.createElement("div");
	wrapper.className = "flex flex-col gap-1 mb-2";
	wrapper.innerHTML = `<span class="text-xs font-bold opacity-70">${label}</span>`;
	
	const row = document.createElement("div");
	row.className = "grid grid-cols-3 gap-1";
	
	["x", "y", "z"].forEach(axis => {
		const input = document.createElement("input");
		input.type = "number";
		input.step = "0.1";
		input.id = `${idPrefix}-${axis}`;
		input.className = "input input-bordered input-xs w-full px-1";
		input.placeholder = axis.toUpperCase();
		row.appendChild(input);
	});
	wrapper.appendChild(row);
	container.appendChild(wrapper);
}

const transformContainer = document.getElementById("transform-container");
createVec3Input("Position", "pos", transformContainer);
createVec3Input("Rotation (Deg)", "rot", transformContainer);
createVec3Input("Scale", "scl", transformContainer);
createVec3Input("Pivot Point", "piv", transformContainer);

export function updatePropertyEditor(target) {
	const editor = document.getElementById("property-editor");
	const header = document.getElementById("properties-header");
	
	if (observer) {
		scene.onBeforeRenderObservable.remove(observer);
		observer = null;
	}
	
	currentMesh = target;
	
	// Always refresh tree highlight when selection selection changes
	highlightInTree(target);
	
	if (!target) {
		editor.classList.add("opacity-50", "pointer-events-none");
		document.getElementById("prop-id").value = "";
		document.getElementById("light-properties").classList.add("hidden");
		if (header) header.innerText = "Properties";
		return;
	}
	
	editor.classList.remove("opacity-50", "pointer-events-none");
	
	// Update Header with Type
	if (header) {
		let typeLabel = "Unknown";
		if (target.metadata) {
			if (target.metadata.isPrimitive) {
				typeLabel = target.metadata.type || "Mesh";
			} else if (target.metadata.isLightProxy) {
				const lType = target.metadata.lightType || "light";
				typeLabel = lType.charAt(0).toUpperCase() + lType.slice(1) + " Light";
			} else if (target.metadata.isTransformNode) {
				typeLabel = "Empty Node";
			}
		} else {
			typeLabel = target.getClassName();
		}
		
		header.innerHTML = `Properties <span class="ml-2 text-sm font-normal opacity-50 border border-base-content/20 px-2 rounded align-middle">${typeLabel}</span>`;
	}
	
	document.getElementById("prop-id").value = target.name;
	updateParentDropdown(target);
	
	// Material Dropdown - Hide for TransformNodes
	const matSelect = document.getElementById("prop-material");
	if (target.metadata && target.metadata.isTransformNode) {
		matSelect.closest(".form-control").classList.add("hidden");
	} else {
		matSelect.closest(".form-control").classList.remove("hidden");
		updateMaterialDropdown(target);
	}
	
	bindInputs(target);
	bindDuplicateButton(target);
	bindDeleteButton(target);
	
	// --- Light Properties ---
	const lightProps = document.getElementById("light-properties");
	if (target.metadata && target.metadata.isLightProxy) {
		lightProps.classList.remove("hidden");
		bindLightInputs(target);
	} else {
		lightProps.classList.add("hidden");
	}
	
	// --- Shadow Properties ---
	// Hide for TransformNodes
	const receiveShadowsInput = document.getElementById("prop-receive-shadows");
	const castShadowsInput = document.getElementById("prop-cast-shadows");
	
	if (target.metadata && target.metadata.isTransformNode) {
		receiveShadowsInput.closest(".form-control").classList.add("hidden");
		castShadowsInput.closest(".form-control").classList.add("hidden");
	} else {
		receiveShadowsInput.closest(".form-control").classList.remove("hidden");
		castShadowsInput.closest(".form-control").classList.remove("hidden");
	}
	
	observer = scene.onBeforeRenderObservable.add(() => {
		if (!currentMesh) return;
		syncUIFromMesh(currentMesh);
	});
}

function updateParentDropdown(mesh) {
	const select = document.getElementById("prop-parent");
	select.innerHTML = '<option value="">None</option>';
	
	// List all valid parents (Meshes and TransformNodes)
	const potentialParents = [];
	scene.meshes.forEach(m => {
		if (isUserMesh(m)) potentialParents.push(m);
	});
	scene.transformNodes.forEach(t => {
		if (t.metadata && t.metadata.isTransformNode) potentialParents.push(t);
	});
	
	potentialParents.forEach(p => {
		if (p !== mesh && p.parent !== mesh) {
			const option = document.createElement("option");
			option.value = p.name;
			option.text = p.name;
			if (mesh.parent === p) option.selected = true;
			select.appendChild(option);
		}
	});
	
	select.onchange = () => {
		const parentName = select.value;
		let parent = scene.getMeshByName(parentName);
		if (!parent) parent = scene.getTransformNodeByName(parentName);
		
		// Use shared helper from treeViewManager
		setNodeParent(mesh, parent);
		
		markModified();
		refreshSceneGraph();
		// NEW: Record History
		recordState();
	};
}

// Helper duplicated locally or imported?
// Since isUserMesh is used in updateParentDropdown, we need it here.
// We can import it or duplicate it. For simplicity, I'll duplicate the small check
// or we could export it from treeViewManager. Let's duplicate the logic to avoid too many fine-grained exports.
function isUserMesh(mesh) {
	return mesh.name !== "previewSphere" &&
		!mesh.name.startsWith("gizmo") &&
		mesh.name !== "hdrSkyBox" &&
		(mesh.metadata?.isPrimitive || mesh.metadata?.isLightProxy);
}

function updateMaterialDropdown(mesh) {
	const select = document.getElementById("prop-material");
	select.innerHTML = '<option value="">None</option>';
	
	scene.materials.forEach(mat => {
		const option = document.createElement("option");
		option.value = mat.id;
		option.text = mat.name;
		if (mesh.material === mat) option.selected = true;
		select.appendChild(option);
	});
	
	select.onchange = () => {
		const mat = scene.getMaterialByID(select.value);
		mesh.material = mat;
		markModified();
		// NEW: Record History
		recordState();
	};
}

function bindLightInputs(mesh) {
	const light = scene.getLightByID(mesh.metadata.lightId);
	if (!light) return;
	
	const iInput = document.getElementById("prop-light-intensity");
	const cInput = document.getElementById("prop-light-diffuse");
	
	iInput.value = light.intensity;
	cInput.value = light.diffuse.toHexString();
	
	iInput.onchange = () => {
		light.intensity = parseFloat(iInput.value) || 0;
		markModified();
		// NEW: Record History
		recordState();
	};
	
	cInput.onchange = () => {
		light.diffuse = Color3.FromHexString(cInput.value);
		markModified();
		// NEW: Record History
		recordState();
	};
}

function syncUIFromMesh(mesh) {
	if (document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox" && document.activeElement.type !== "color") return;
	
	document.getElementById("pos-x").value = mesh.position.x.toFixed(2);
	document.getElementById("pos-y").value = mesh.position.y.toFixed(2);
	document.getElementById("pos-z").value = mesh.position.z.toFixed(2);
	
	if (mesh.rotationQuaternion) {
		const euler = mesh.rotationQuaternion.toEulerAngles();
		document.getElementById("rot-x").value = (euler.x * 180 / Math.PI).toFixed(2);
		document.getElementById("rot-y").value = (euler.y * 180 / Math.PI).toFixed(2);
		document.getElementById("rot-z").value = (euler.z * 180 / Math.PI).toFixed(2);
	} else {
		document.getElementById("rot-x").value = (mesh.rotation.x * 180 / Math.PI).toFixed(2);
		document.getElementById("rot-y").value = (mesh.rotation.y * 180 / Math.PI).toFixed(2);
		document.getElementById("rot-z").value = (mesh.rotation.z * 180 / Math.PI).toFixed(2);
	}
	
	document.getElementById("scl-x").value = mesh.scaling.x.toFixed(2);
	document.getElementById("scl-y").value = mesh.scaling.y.toFixed(2);
	document.getElementById("scl-z").value = mesh.scaling.z.toFixed(2);
	
	const pivot = mesh.getPivotPoint();
	document.getElementById("piv-x").value = pivot.x.toFixed(2);
	document.getElementById("piv-y").value = pivot.y.toFixed(2);
	document.getElementById("piv-z").value = pivot.z.toFixed(2);
	
	// Sync Shadow Checkboxes (Only for Meshes)
	if (mesh instanceof AbstractMesh) {
		document.getElementById("prop-receive-shadows").checked = !!mesh.receiveShadows;
		document.getElementById("prop-cast-shadows").checked = !!(mesh.metadata && mesh.metadata.castShadows);
	}
	
	// Sync Light Properties
	if (mesh.metadata && mesh.metadata.isLightProxy) {
		const light = scene.getLightByID(mesh.metadata.lightId);
		if (light) {
			const iInput = document.getElementById("prop-light-intensity");
			const cInput = document.getElementById("prop-light-diffuse");
			
			if (document.activeElement !== iInput) iInput.value = light.intensity;
			if (document.activeElement !== cInput) cInput.value = light.diffuse.toHexString();
		}
	}
}

function bindInputs(mesh) {
	const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
	
	const updateMesh = () => {
		mesh.position.x = getVal("pos-x");
		mesh.position.y = getVal("pos-y");
		mesh.position.z = getVal("pos-z");
		
		const radX = getVal("rot-x") * Math.PI / 180;
		const radY = getVal("rot-y") * Math.PI / 180;
		const radZ = getVal("rot-z") * Math.PI / 180;
		
		if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
		Quaternion.FromEulerAnglesToRef(radX, radY, radZ, mesh.rotationQuaternion);
		
		mesh.scaling.x = getVal("scl-x");
		mesh.scaling.y = getVal("scl-y");
		mesh.scaling.z = getVal("scl-z");
		
		mesh.setPivotPoint(new Vector3(getVal("piv-x"), getVal("piv-y"), getVal("piv-z")));
		
		markModified();
	};
	
	document.querySelectorAll("#property-editor input[type='number']").forEach(input => {
		if (input.id.startsWith("prop-light")) return;
		input.oninput = updateMesh;
		// NEW: Record History on change (committed)
		input.onchange = recordState;
	});
	
	// Handle Renaming with ID Uniqueness Check
	document.getElementById("prop-id").onchange = (e) => {
		let newName = e.target.value;
		
		// Special Handling for Lights
		// We want to rename the underlying Light ID, and keep the Proxy as ID_proxy
		if (mesh.metadata && mesh.metadata.isLightProxy) {
			const light = scene.getLightByID(mesh.metadata.lightId);
			if (light) {
				// 1. Strip _proxy if user typed it, to get the base name
				const baseName = newName.replace(/_proxy$/, "");
				
				// 2. Ensure base name is unique for the LIGHT
				const uniqueLightId = getUniqueId(scene, baseName);
				
				// 3. Rename Light
				light.id = uniqueLightId;
				light.name = uniqueLightId;
				
				// 4. Rename Proxy to match convention
				const proxyId = uniqueLightId + "_proxy";
				mesh.id = proxyId;
				mesh.name = proxyId;
				
				// 5. Update Metadata link
				mesh.metadata.lightId = uniqueLightId;
				
				// 6. Update Input to show the actual proxy name
				e.target.value = proxyId;
			}
		} else {
			// Standard Mesh/Node Renaming
			const uniqueId = getUniqueId(scene, newName);
			mesh.name = uniqueId;
			mesh.id = uniqueId;
			
			if (uniqueId !== newName) {
				e.target.value = uniqueId;
			}
		}
		
		markModified();
		refreshSceneGraph();
		// NEW: Record History
		recordState();
	};
	
	// Bind Shadow Checkboxes (Only if visible/mesh)
	if (mesh instanceof AbstractMesh) {
		document.getElementById("prop-receive-shadows").onchange = (e) => {
			mesh.receiveShadows = e.target.checked;
			markModified();
			// NEW: Record History
			recordState();
		};
		
		document.getElementById("prop-cast-shadows").onchange = (e) => {
			setShadowCaster(mesh, e.target.checked);
			markModified();
			// NEW: Record History
			recordState();
		};
	}
}

function bindDuplicateButton(node) {
	const btn = document.getElementById("btn-duplicate-asset");
	if (!btn) return;
	
	btn.onclick = () => {
		const newNode = duplicateHierarchy(node, node.parent);
		if (newNode) {
			selectMesh(newNode);
			markModified();
			refreshSceneGraph();
			// NEW: Record History
			recordState();
		}
	};
}

function duplicateHierarchy(node, parent) {
	let newNode = null;
	
	// Generate a unique ID for the duplicate
	const baseId = node.name + "_dup";
	const newId = getUniqueId(scene, baseId);
	
	if (node.metadata && node.metadata.isLightProxy) {
		// Light Duplication
		const oldLight = scene.getLightByID(node.metadata.lightId);
		if (oldLight) {
			const savedData = {
				id: newId, // Use the unique ID
				position: node.position,
				intensity: oldLight.intensity,
				diffuse: oldLight.diffuse,
				direction: oldLight.direction ? { x: oldLight.direction.x, y: oldLight.direction.y, z: oldLight.direction.z } : null
			};
			newNode = createLight(node.metadata.lightType, savedData, scene);
			if (newNode && parent) newNode.parent = parent;
		}
	} else if (node.metadata && node.metadata.isTransformNode) {
		// TransformNode Duplication
		const savedData = {
			id: newId, // Use the unique ID
			position: node.position,
			rotation: node.rotationQuaternion || Quaternion.FromEulerVector(node.rotation),
			scaling: node.scaling,
			name: newId
		};
		newNode = createTransformNode(savedData, scene);
		if (newNode && parent) newNode.parent = parent;
	} else if (node.metadata && node.metadata.isPrimitive) {
		// Mesh Duplication
		newNode = node.clone(newId, parent);
		newNode.id = newId; // Ensure ID matches
		
		if (node.metadata) {
			newNode.metadata = JSON.parse(JSON.stringify(node.metadata));
		}
		
		newNode.receiveShadows = node.receiveShadows;
		if (newNode.metadata && newNode.metadata.castShadows) {
			setShadowCaster(newNode, true);
		}
	}
	
	if (newNode) {
		// Recursively duplicate children
		// We need to check if children are valid graph nodes
		node.getChildren().forEach(child => {
			// Simple check to ensure we only duplicate what we show in tree
			if (child.metadata && (child.metadata.isPrimitive || child.metadata.isLightProxy || child.metadata.isTransformNode)) {
				duplicateHierarchy(child, newNode);
			}
		});
	}
	
	return newNode;
}

function bindDeleteButton(node) {
	const btn = document.getElementById("btn-delete-asset");
	if (!btn) return;
	
	btn.onclick = () => {
		if (confirm(`Are you sure you want to delete "${node.name}"?`)) {
			// 1. Handle Light Proxy cleanup
			if (node.metadata && node.metadata.isLightProxy) {
				const light = scene.getLightByID(node.metadata.lightId);
				if (light) {
					disposeShadowGenerator(light);
					light.dispose();
				}
			}
			
			// 2. Deselect
			selectMesh(null);
			
			// 3. Unregister shadows if mesh
			if (node instanceof AbstractMesh) {
				setShadowCaster(node, false);
			}
			
			// 4. Dispose
			node.dispose();
			
			// 5. Update State
			markModified();
			refreshSceneGraph();
			// NEW: Record History
			recordState();
		}
	};
}
