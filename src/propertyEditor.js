import { Vector3, Quaternion, Color3, AbstractMesh } from "@babylonjs/core";
import { scene, getUniqueId } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectNode, getSelectedNodes } from "./selectionManager.js"; // Updated import
import { createLight } from "./lightManager.js";
import { setShadowCaster, disposeShadowGenerator } from "./shadowManager.js";
import { createTransformNode } from "./transformNodeManager.js";
import { recordState } from "./historyManager.js";
import { refreshSceneGraph, setNodeParent } from "./treeViewManager.js";

let observer = null;

function createVec3Input(label, idPrefix, container) {
	const wrapper = document.createElement("div");
	wrapper.className = "flex flex-col gap-1 mb-2";
	wrapper.innerHTML = `<span class="text-xs font-bold opacity-70">${label}</span>`;
	
	const row = document.createElement("div");
	row.className = "grid grid-cols-3 gap-1";
	
	["x", "y", "z"].forEach(axis => {
		const input = document.createElement("input");
		input.type = "text"; // Changed to text to support empty string for mixed values
		input.id = `${idPrefix}-${axis}`;
		input.className = "input input-bordered input-xs w-full px-1";
		input.placeholder = axis.toUpperCase();
		row.appendChild(input);
	});
	wrapper.appendChild(row);
	container.appendChild(wrapper);
}

const transformContainer = document.getElementById("transform-container");
// Clear existing to avoid duplicates on HMR if any
transformContainer.innerHTML = "";
createVec3Input("Position", "pos", transformContainer);
createVec3Input("Rotation (Deg)", "rot", transformContainer);
createVec3Input("Scale", "scl", transformContainer);
// Pivot editing is complex with multi-select, hiding for now or keeping simple
// createVec3Input("Pivot Point", "piv", transformContainer);

export function updatePropertyEditor(targets) {
	// Ensure targets is an array
	if (!Array.isArray(targets)) {
		targets = targets ? [targets] : [];
	}
	
	const editor = document.getElementById("property-editor");
	const header = document.getElementById("properties-header");
	
	if (observer) {
		scene.onBeforeRenderObservable.remove(observer);
		observer = null;
	}
	
	if (targets.length === 0) {
		editor.classList.add("opacity-50", "pointer-events-none");
		document.getElementById("prop-id").value = "";
		document.getElementById("light-properties").classList.add("hidden");
		if (header) header.innerText = "Properties";
		return;
	}
	
	editor.classList.remove("opacity-50", "pointer-events-none");
	
	// --- Header ---
	if (header) {
		if (targets.length === 1) {
			const target = targets[0];
			let typeLabel = "Unknown";
			if (target.metadata) {
				if (target.metadata.isPrimitive) typeLabel = target.metadata.type || "Mesh";
				else if (target.metadata.isLightProxy) typeLabel = "Light";
				else if (target.metadata.isTransformNode) typeLabel = "Node";
			} else {
				typeLabel = target.getClassName();
			}
			header.innerHTML = `Properties <span class="ml-2 text-sm font-normal opacity-50 border border-base-content/20 px-2 rounded align-middle">${typeLabel}</span>`;
			document.getElementById("prop-id").value = target.name;
			document.getElementById("prop-id").disabled = false;
		} else {
			header.innerHTML = `Properties <span class="ml-2 text-sm font-normal opacity-50 border border-base-content/20 px-2 rounded align-middle">${targets.length} Selected</span>`;
			document.getElementById("prop-id").value = "---";
			document.getElementById("prop-id").disabled = true;
		}
	}
	
	// --- Common Bindings ---
	updateParentDropdown(targets);
	updateMaterialDropdown(targets);
	bindInputs(targets);
	bindDuplicateButton(targets);
	bindDeleteButton(targets);
	
	// --- Light Properties ---
	// Only show if ALL selected are lights
	const allLights = targets.every(t => t.metadata && t.metadata.isLightProxy);
	const lightProps = document.getElementById("light-properties");
	
	if (allLights) {
		lightProps.classList.remove("hidden");
		bindLightInputs(targets);
	} else {
		lightProps.classList.add("hidden");
	}
	
	// --- Shadow Properties ---
	const allMeshes = targets.every(t => t instanceof AbstractMesh && !t.metadata?.isTransformNode);
	const receiveShadowsInput = document.getElementById("prop-receive-shadows");
	const castShadowsInput = document.getElementById("prop-cast-shadows");
	
	if (allMeshes) {
		receiveShadowsInput.closest(".form-control").classList.remove("hidden");
		castShadowsInput.closest(".form-control").classList.remove("hidden");
		
		// Set initial checkbox state (checked if all true, indeterminate if mixed)
		const allReceive = targets.every(t => t.receiveShadows);
		const someReceive = targets.some(t => t.receiveShadows);
		receiveShadowsInput.checked = allReceive;
		receiveShadowsInput.indeterminate = someReceive && !allReceive;
		
		const allCast = targets.every(t => t.metadata && t.metadata.castShadows);
		const someCast = targets.some(t => t.metadata && t.metadata.castShadows);
		castShadowsInput.checked = allCast;
		castShadowsInput.indeterminate = someCast && !allCast;
		
	} else {
		receiveShadowsInput.closest(".form-control").classList.add("hidden");
		castShadowsInput.closest(".form-control").classList.add("hidden");
	}
	
	// --- Live Update Loop ---
	observer = scene.onBeforeRenderObservable.add(() => {
		// Only update UI if user is NOT typing
		if (document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox" && document.activeElement.type !== "color") return;
		syncUIFromTargets(targets);
	});
	
	// Initial Sync
	syncUIFromTargets(targets);
}

// Helper to get a common value or null if mixed
function getCommonValue(targets, getter) {
	if (targets.length === 0) return null;
	const first = getter(targets[0]);
	for (let i = 1; i < targets.length; i++) {
		const val = getter(targets[i]);
		if (Math.abs(val - first) > 0.001) return null; // Tolerance for floats
	}
	return first;
}

function syncUIFromTargets(targets) {
	// Position
	const px = getCommonValue(targets, t => t.position.x);
	const py = getCommonValue(targets, t => t.position.y);
	const pz = getCommonValue(targets, t => t.position.z);
	
	document.getElementById("pos-x").value = px !== null ? px.toFixed(2) : "";
	document.getElementById("pos-y").value = py !== null ? py.toFixed(2) : "";
	document.getElementById("pos-z").value = pz !== null ? pz.toFixed(2) : "";
	
	// Rotation (Euler)
	const getRot = (t, axis) => {
		if (t.rotationQuaternion) {
			return t.rotationQuaternion.toEulerAngles()[axis] * 180 / Math.PI;
		}
		return t.rotation[axis] * 180 / Math.PI;
	};
	
	const rx = getCommonValue(targets, t => getRot(t, "x"));
	const ry = getCommonValue(targets, t => getRot(t, "y"));
	const rz = getCommonValue(targets, t => getRot(t, "z"));
	
	document.getElementById("rot-x").value = rx !== null ? rx.toFixed(2) : "";
	document.getElementById("rot-y").value = ry !== null ? ry.toFixed(2) : "";
	document.getElementById("rot-z").value = rz !== null ? rz.toFixed(2) : "";
	
	// Scale
	const sx = getCommonValue(targets, t => t.scaling.x);
	const sy = getCommonValue(targets, t => t.scaling.y);
	const sz = getCommonValue(targets, t => t.scaling.z);
	
	document.getElementById("scl-x").value = sx !== null ? sx.toFixed(2) : "";
	document.getElementById("scl-y").value = sy !== null ? sy.toFixed(2) : "";
	document.getElementById("scl-z").value = sz !== null ? sz.toFixed(2) : "";
}

function bindInputs(targets) {
	const getVal = (id) => {
		const val = document.getElementById(id).value;
		return val === "" ? null : parseFloat(val);
	};
	
	const updateTargets = () => {
		const px = getVal("pos-x");
		const py = getVal("pos-y");
		const pz = getVal("pos-z");
		
		const rx = getVal("rot-x");
		const ry = getVal("rot-y");
		const rz = getVal("rot-z");
		
		const sx = getVal("scl-x");
		const sy = getVal("scl-y");
		const sz = getVal("scl-z");
		
		targets.forEach(mesh => {
			// Position
			if (px !== null) mesh.position.x = px;
			if (py !== null) mesh.position.y = py;
			if (pz !== null) mesh.position.z = pz;
			
			// Rotation
			if (rx !== null || ry !== null || rz !== null) {
				let currentEuler;
				if (mesh.rotationQuaternion) {
					currentEuler = mesh.rotationQuaternion.toEulerAngles();
				} else {
					currentEuler = mesh.rotation;
				}
				
				const radX = rx !== null ? rx * Math.PI / 180 : currentEuler.x;
				const radY = ry !== null ? ry * Math.PI / 180 : currentEuler.y;
				const radZ = rz !== null ? rz * Math.PI / 180 : currentEuler.z;
				
				if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
				Quaternion.FromEulerAnglesToRef(radX, radY, radZ, mesh.rotationQuaternion);
			}
			
			// Scale
			if (sx !== null) mesh.scaling.x = sx;
			if (sy !== null) mesh.scaling.y = sy;
			if (sz !== null) mesh.scaling.z = sz;
		});
		
		markModified();
	};
	
	document.querySelectorAll("#transform-container input").forEach(input => {
		input.oninput = updateTargets;
		input.onchange = recordState;
	});
	
	// ID Renaming (Only for single selection)
	if (targets.length === 1) {
		document.getElementById("prop-id").onchange = (e) => {
			const mesh = targets[0];
			let newName = e.target.value;
			
			if (mesh.metadata && mesh.metadata.isLightProxy) {
				const light = scene.getLightByID(mesh.metadata.lightId);
				if (light) {
					const baseName = newName.replace(/_proxy$/, "");
					const uniqueLightId = getUniqueId(scene, baseName);
					light.id = uniqueLightId;
					light.name = uniqueLightId;
					const proxyId = uniqueLightId + "_proxy";
					mesh.id = proxyId;
					mesh.name = proxyId;
					mesh.metadata.lightId = uniqueLightId;
					e.target.value = proxyId;
				}
			} else {
				const uniqueId = getUniqueId(scene, newName);
				mesh.name = uniqueId;
				mesh.id = uniqueId;
				if (uniqueId !== newName) e.target.value = uniqueId;
			}
			markModified();
			refreshSceneGraph();
			recordState();
		};
	}
	
	// Shadow Checkboxes
	document.getElementById("prop-receive-shadows").onchange = (e) => {
		targets.forEach(t => {
			if (t instanceof AbstractMesh) t.receiveShadows = e.target.checked;
		});
		markModified();
		recordState();
	};
	
	document.getElementById("prop-cast-shadows").onchange = (e) => {
		targets.forEach(t => {
			if (t instanceof AbstractMesh) setShadowCaster(t, e.target.checked);
		});
		markModified();
		recordState();
	};
}

function updateParentDropdown(targets) {
	const select = document.getElementById("prop-parent");
	select.innerHTML = '<option value="">None</option>';
	
	// If multiple selected, we can only set parent if it's not one of the selected nodes
	// To simplify, we allow setting parent to "None" or an unselected node
	
	const potentialParents = [];
	scene.meshes.forEach(m => {
		if (isUserMesh(m) && !targets.includes(m)) potentialParents.push(m);
	});
	scene.transformNodes.forEach(t => {
		if (t.metadata && t.metadata.isTransformNode && !targets.includes(t)) potentialParents.push(t);
	});
	
	potentialParents.forEach(p => {
		const option = document.createElement("option");
		option.value = p.name;
		option.text = p.name;
		select.appendChild(option);
	});
	
	// Set selected value
	if (targets.length === 1) {
		const parent = targets[0].parent;
		if (parent) select.value = parent.name;
	} else {
		// If all share same parent, select it, else empty
		const firstParent = targets[0].parent;
		const allSame = targets.every(t => t.parent === firstParent);
		if (allSame && firstParent) select.value = firstParent.name;
		else select.value = "";
	}
	
	select.onchange = () => {
		const parentName = select.value;
		let parent = scene.getMeshByName(parentName);
		if (!parent) parent = scene.getTransformNodeByName(parentName);
		
		targets.forEach(t => {
			// Prevent cycles: don't parent to a child
			if (parent) {
				let check = parent;
				while (check) {
					if (check === t) return; // Cycle detected
					check = check.parent;
				}
			}
			setNodeParent(t, parent);
		});
		
		markModified();
		refreshSceneGraph();
		recordState();
	};
}

function updateMaterialDropdown(targets) {
	const select = document.getElementById("prop-material");
	select.innerHTML = '<option value="">None</option>';
	
	// Hide if any target is a TransformNode (no material)
	if (targets.some(t => t.metadata && t.metadata.isTransformNode)) {
		select.closest(".form-control").classList.add("hidden");
		return;
	}
	select.closest(".form-control").classList.remove("hidden");
	
	scene.materials.forEach(mat => {
		const option = document.createElement("option");
		option.value = mat.id;
		option.text = mat.name;
		select.appendChild(option);
	});
	
	// Set selection
	if (targets.length > 0) {
		const firstMat = targets[0].material;
		const allSame = targets.every(t => t.material === firstMat);
		if (allSame && firstMat) select.value = firstMat.id;
	}
	
	select.onchange = () => {
		const mat = scene.getMaterialByID(select.value);
		targets.forEach(t => {
			t.material = mat;
		});
		markModified();
		recordState();
	};
}

function bindLightInputs(targets) {
	const lights = targets.map(t => scene.getLightByID(t.metadata.lightId)).filter(l => l);
	if (lights.length === 0) return;
	
	const iInput = document.getElementById("prop-light-intensity");
	const cInput = document.getElementById("prop-light-diffuse");
	
	// Sync UI
	const firstI = lights[0].intensity;
	const allSameI = lights.every(l => Math.abs(l.intensity - firstI) < 0.01);
	iInput.value = allSameI ? firstI : "";
	
	const firstC = lights[0].diffuse.toHexString();
	const allSameC = lights.every(l => l.diffuse.toHexString() === firstC);
	cInput.value = allSameC ? firstC : "#ffffff";
	
	iInput.onchange = () => {
		const val = parseFloat(iInput.value);
		if (!isNaN(val)) {
			lights.forEach(l => l.intensity = val);
			markModified();
			recordState();
		}
	};
	
	cInput.onchange = () => {
		const col = Color3.FromHexString(cInput.value);
		lights.forEach(l => l.diffuse = col);
		markModified();
		recordState();
	};
}

function bindDuplicateButton(targets) {
	const btn = document.getElementById("btn-duplicate-asset");
	if (!btn) return;
	
	btn.onclick = () => {
		const newSelection = [];
		targets.forEach(node => {
			const newNode = duplicateHierarchy(node, node.parent);
			if (newNode) newSelection.push(newNode);
		});
		
		if (newSelection.length > 0) {
			selectNode(null); // Clear
			selectNode(newSelection[0], false); // Select first
			for(let i=1; i<newSelection.length; i++) selectNode(newSelection[i], true); // Add others
			
			markModified();
			refreshSceneGraph();
			recordState();
		}
	};
}

function duplicateHierarchy(node, parent) {
	let newNode = null;
	const baseId = node.name + "_dup";
	const newId = getUniqueId(scene, baseId);
	
	if (node.metadata && node.metadata.isLightProxy) {
		const oldLight = scene.getLightByID(node.metadata.lightId);
		if (oldLight) {
			const savedData = {
				id: newId,
				position: node.position,
				intensity: oldLight.intensity,
				diffuse: oldLight.diffuse,
				direction: oldLight.direction ? { x: oldLight.direction.x, y: oldLight.direction.y, z: oldLight.direction.z } : null
			};
			newNode = createLight(node.metadata.lightType, savedData, scene);
			if (newNode && parent) newNode.parent = parent;
		}
	} else if (node.metadata && node.metadata.isTransformNode) {
		const savedData = {
			id: newId,
			position: node.position,
			rotation: node.rotationQuaternion || Quaternion.FromEulerVector(node.rotation),
			scaling: node.scaling,
			name: newId
		};
		newNode = createTransformNode(savedData, scene);
		if (newNode && parent) newNode.parent = parent;
	} else if (node.metadata && node.metadata.isPrimitive) {
		newNode = node.clone(newId, parent);
		newNode.id = newId;
		if (node.metadata) newNode.metadata = JSON.parse(JSON.stringify(node.metadata));
		newNode.receiveShadows = node.receiveShadows;
		if (newNode.metadata && newNode.metadata.castShadows) setShadowCaster(newNode, true);
	}
	
	if (newNode) {
		node.getChildren().forEach(child => {
			if (child.metadata && (child.metadata.isPrimitive || child.metadata.isLightProxy || child.metadata.isTransformNode)) {
				duplicateHierarchy(child, newNode);
			}
		});
	}
	return newNode;
}

function bindDeleteButton(targets) {
	const btn = document.getElementById("btn-delete-asset");
	if (!btn) return;
	
	btn.onclick = () => {
		const count = targets.length;
		if (confirm(`Delete ${count} item(s)?`)) {
			targets.forEach(node => {
				if (node.metadata && node.metadata.isLightProxy) {
					const light = scene.getLightByID(node.metadata.lightId);
					if (light) {
						disposeShadowGenerator(light);
						light.dispose();
					}
				}
				if (node instanceof AbstractMesh) {
					setShadowCaster(node, false);
				}
				node.dispose();
			});
			
			selectNode(null);
			markModified();
			refreshSceneGraph();
			recordState();
		}
	};
}

function isUserMesh(mesh) {
	return mesh.name !== "previewSphere" &&
		!mesh.name.startsWith("gizmo") &&
		mesh.name !== "hdrSkyBox" &&
		(mesh.metadata?.isPrimitive || mesh.metadata?.isLightProxy);
}
