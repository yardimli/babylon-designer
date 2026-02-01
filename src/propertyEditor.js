import { Vector3, Quaternion, Color3, AbstractMesh, TransformNode } from "@babylonjs/core";
import { scene, getUniqueId } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectMesh } from "./gizmoControl.js";
import { createLight } from "./lightManager.js";
import { setShadowCaster, disposeShadowGenerator } from "./shadowManager.js";
import { createTransformNode } from "./transformNodeManager.js";
// NEW: Import History
import { recordState } from "./historyManager.js";

let currentMesh = null; // Can be Mesh or TransformNode
let observer = null;
const collapsedNodes = new Set(); // Store IDs of collapsed nodes

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
		return;
	}
	
	editor.classList.remove("opacity-50", "pointer-events-none");
	
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

// Helper to handle parenting logic including Light Proxies
function setNodeParent(node, parent) {
	node.setParent(parent);
	
	// If this is a light proxy, we must also parent the actual light
	if (node.metadata && node.metadata.isLightProxy) {
		const light = scene.getLightByID(node.metadata.lightId);
		if (light) {
			light.parent = parent;
		}
	}
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
		
		setNodeParent(mesh, parent);
		
		markModified();
		refreshSceneGraph();
		// NEW: Record History
		recordState();
	};
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
		const newName = e.target.value;
		// Ensure the new name/id is unique
		const uniqueId = getUniqueId(scene, newName);
		
		mesh.name = uniqueId;
		mesh.id = uniqueId; // Sync ID with Name for consistency
		
		// Update UI if the name was modified to be unique
		if (uniqueId !== newName) {
			e.target.value = uniqueId;
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
		node.getChildren().forEach(child => {
			if (isGraphNode(child)) {
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

// ==========================================
// SCENE TREE VIEW
// ==========================================

// Helper to identify nodes that should appear in the tree
function isGraphNode(node) {
	if (node instanceof AbstractMesh) {
		return isUserMesh(node);
	}
	if (node.getClassName() === "TransformNode") {
		return node.metadata && node.metadata.isTransformNode;
	}
	return false;
}

function isUserMesh(mesh) {
	return mesh.name !== "previewSphere" &&
		!mesh.name.startsWith("gizmo") &&
		mesh.name !== "hdrSkyBox" &&
		(mesh.metadata?.isPrimitive || mesh.metadata?.isLightProxy);
}

// Helper to sort nodes by metadata.sortIndex
function getSortedRoots() {
	return scene.rootNodes
		.filter(n => !n.parent && isGraphNode(n))
		.sort((a, b) => (a.metadata?.sortIndex || 0) - (b.metadata?.sortIndex || 0));
}

function getSortedChildren(node) {
	return node.getChildren()
		.filter(child => isGraphNode(child))
		.sort((a, b) => (a.metadata?.sortIndex || 0) - (b.metadata?.sortIndex || 0));
}

export function refreshSceneGraph() {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	container.innerHTML = "";
	
	// Enable dropping to root (unparenting)
	container.ondragover = (e) => {
		e.preventDefault();
		// Only highlight if we are over the container background, not a child
		if (e.target === container) {
			container.classList.add("bg-base-content/5");
		}
	};
	container.ondragleave = (e) => {
		if (e.target === container) {
			container.classList.remove("bg-base-content/5");
		}
	};
	container.ondrop = (e) => {
		e.preventDefault();
		container.classList.remove("bg-base-content/5");
		
		// If dropped directly on container, move to root
		if (e.target === container) {
			const draggedId = e.dataTransfer.getData("nodeId");
			if (draggedId) {
				const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
				if (draggedNode && draggedNode.parent) {
					setNodeParent(draggedNode, null);
					
					// Move to end of root list
					const roots = getSortedRoots();
					const maxIndex = roots.length > 0 ? (roots[roots.length - 1].metadata?.sortIndex || 0) : 0;
					if (!draggedNode.metadata) draggedNode.metadata = {};
					draggedNode.metadata.sortIndex = maxIndex + 100;
					
					markModified();
					refreshSceneGraph();
					recordState();
				}
			}
		}
	};
	
	const roots = getSortedRoots();
	
	if (roots.length === 0) {
		container.innerHTML = "<div class='opacity-50 italic p-2'>Empty Scene</div>";
		return;
	}
	
	roots.forEach(node => {
		container.appendChild(createTreeNode(node, 0));
	});
	
	if (currentMesh) highlightInTree(currentMesh);
}

function createTreeNode(node, level) {
	const wrapper = document.createElement("div");
	
	// Row Container
	const row = document.createElement("div");
	row.className = "flex items-center hover:bg-base-content/10 rounded cursor-pointer p-1 border-transparent border-y-2";
	row.style.paddingLeft = `${level * 12 + 4}px`;
	row.dataset.meshId = node.id;
	
	// --- Drag & Drop Logic ---
	row.draggable = true;
	
	row.ondragstart = (e) => {
		e.dataTransfer.setData("nodeId", node.id);
		e.dataTransfer.effectAllowed = "move";
		// Small delay to let the ghost image form before hiding/styling
		setTimeout(() => row.classList.add("opacity-50"), 0);
	};
	
	row.ondragend = () => {
		row.classList.remove("opacity-50");
	};
	
	row.ondragover = (e) => {
		e.preventDefault(); // Allow drop
		e.stopPropagation(); // Handle here, don't bubble to container
		
		// Don't allow dropping on self
		const draggedId = e.dataTransfer.getData("nodeId");
		if (draggedId === node.id) return;
		
		// Determine drop zone: Top (Before), Middle (Inside), Bottom (After)
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		
		// Reset styles
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20");
		row.style.borderColor = "transparent";
		
		if (relY < height * 0.25) {
			// Zone: Before (Sibling)
			row.classList.add("border-t-primary");
			row.style.borderTopColor = "oklch(var(--p))"; // Force color if class fails
		} else if (relY > height * 0.75) {
			// Zone: After (Sibling)
			row.classList.add("border-b-primary");
			row.style.borderBottomColor = "oklch(var(--p))";
		} else {
			// Zone: Inside (Child)
			row.classList.add("bg-primary/20");
		}
	};
	
	row.ondragleave = () => {
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20");
		row.style.borderColor = "transparent";
	};
	
	row.ondrop = (e) => {
		e.preventDefault();
		e.stopPropagation();
		
		// Cleanup styles
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20", "opacity-50");
		row.style.borderColor = "transparent";
		
		const draggedId = e.dataTransfer.getData("nodeId");
		if (!draggedId || draggedId === node.id) return;
		
		const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
		if (!draggedNode) return;
		
		// Circular check: Cannot drop parent into its own child
		let check = node;
		while (check) {
			if (check === draggedNode) return;
			check = check.parent;
		}
		
		// Determine Drop Action
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		
		let action = "inside";
		if (relY < height * 0.25) action = "before";
		else if (relY > height * 0.75) action = "after";
		
		handleNodeDrop(draggedNode, node, action);
	};
	
	// --- End Drag & Drop Logic ---
	
	// Expand/Collapse Icon
	const children = getSortedChildren(node);
	const hasChildren = children.length > 0;
	
	const icon = document.createElement("span");
	icon.className = "w-4 h-4 mr-1 flex items-center justify-center font-mono text-xs opacity-70";
	if (hasChildren) {
		const isCollapsed = collapsedNodes.has(node.id);
		icon.innerText = isCollapsed ? "▶" : "▼";
		icon.onclick = (e) => {
			e.stopPropagation();
			if (isCollapsed) collapsedNodes.delete(node.id);
			else collapsedNodes.add(node.id);
			refreshSceneGraph();
		};
	} else {
		icon.innerText = "•";
	}
	row.appendChild(icon);
	
	// Name
	const label = document.createElement("span");
	label.innerText = node.name;
	label.className = "truncate flex-1";
	
	// Visual distinction for TransformNodes
	if (node.metadata && node.metadata.isTransformNode) {
		label.className += " text-secondary";
	}
	
	row.appendChild(label);
	
	// Selection Logic
	row.onclick = () => {
		selectMesh(node);
	};
	
	wrapper.appendChild(row);
	
	// Children Container
	if (hasChildren && !collapsedNodes.has(node.id)) {
		const childrenContainer = document.createElement("div");
		children.forEach(child => {
			childrenContainer.appendChild(createTreeNode(child, level + 1));
		});
		wrapper.appendChild(childrenContainer);
	}
	
	return wrapper;
}

function handleNodeDrop(draggedNode, targetNode, action) {
	if (action === "inside") {
		// Reparent
		setNodeParent(draggedNode, targetNode);
		
		// Append to end of children list
		const siblings = getSortedChildren(targetNode);
		const maxIndex = siblings.length > 0 ? (siblings[siblings.length - 1].metadata?.sortIndex || 0) : 0;
		if (!draggedNode.metadata) draggedNode.metadata = {};
		draggedNode.metadata.sortIndex = maxIndex + 100;
		
		// Auto-expand target
		collapsedNodes.delete(targetNode.id);
		
	} else {
		// Reorder (Sibling)
		// 1. Ensure same parent
		setNodeParent(draggedNode, targetNode.parent);
		
		// 2. Get all siblings (including draggedNode which is now a sibling)
		const parent = targetNode.parent;
		let siblings = parent ? getSortedChildren(parent) : getSortedRoots();
		
		// Remove draggedNode from current position in array (it might be there if it was already a sibling)
		siblings = siblings.filter(n => n !== draggedNode);
		
		// Find index of target
		const targetIndex = siblings.indexOf(targetNode);
		
		// Insert draggedNode
		if (action === "before") {
			siblings.splice(targetIndex, 0, draggedNode);
		} else {
			siblings.splice(targetIndex + 1, 0, draggedNode);
		}
		
		// 3. Re-index all siblings to ensure stable float/int order
		siblings.forEach((sib, index) => {
			if (!sib.metadata) sib.metadata = {};
			sib.metadata.sortIndex = (index + 1) * 100;
		});
	}
	
	markModified();
	refreshSceneGraph();
	recordState();
}

function highlightInTree(node) {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	container.querySelectorAll("[data-mesh-id]").forEach(el => {
		el.classList.remove("bg-primary/20", "text-primary");
	});
	
	if (node) {
		const el = container.querySelector(`[data-mesh-id="${node.id}"]`);
		if (el) {
			el.classList.add("bg-primary/20", "text-primary");
			// Ensure parent folders are expanded? (Optional, skipping for now)
		}
	}
}
