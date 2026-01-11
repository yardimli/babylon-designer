import { Vector3, Quaternion } from "@babylonjs/core";
import { scene } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectMesh } from "./gizmoControl.js";

let currentMesh = null;
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

export function updatePropertyEditor(mesh) {
	const editor = document.getElementById("property-editor");
	
	if (observer) {
		scene.onBeforeRenderObservable.remove(observer);
		observer = null;
	}
	
	currentMesh = mesh;
	
	// Always refresh tree highlight when selection changes
	highlightInTree(mesh);
	
	if (!mesh) {
		editor.classList.add("opacity-50", "pointer-events-none");
		document.getElementById("prop-id").value = "";
		return;
	}
	
	editor.classList.remove("opacity-50", "pointer-events-none");
	
	document.getElementById("prop-id").value = mesh.name;
	updateParentDropdown(mesh);
	updateMaterialDropdown(mesh);
	bindInputs(mesh);
	
	observer = scene.onBeforeRenderObservable.add(() => {
		if(!currentMesh) return;
		syncUIFromMesh(currentMesh);
	});
}

function updateParentDropdown(mesh) {
	const select = document.getElementById("prop-parent");
	select.innerHTML = '<option value="">None</option>';
	
	scene.meshes.forEach(m => {
		if (m !== mesh && m.parent !== mesh && isUserMesh(m)) {
			const option = document.createElement("option");
			option.value = m.name;
			option.text = m.name;
			if (mesh.parent === m) option.selected = true;
			select.appendChild(option);
		}
	});
	
	select.onchange = () => {
		const parentName = select.value;
		const parent = scene.getMeshByName(parentName);
		mesh.setParent(parent);
		markModified();
		refreshSceneGraph(); // Update tree structure
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
	};
}

function syncUIFromMesh(mesh) {
	if(document.activeElement.tagName === "INPUT") return;
	
	document.getElementById("pos-x").value = mesh.position.x.toFixed(2);
	document.getElementById("pos-y").value = mesh.position.y.toFixed(2);
	document.getElementById("pos-z").value = mesh.position.z.toFixed(2);
	
	if(mesh.rotationQuaternion) {
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
		
		if(!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
		Quaternion.FromEulerAnglesToRef(radX, radY, radZ, mesh.rotationQuaternion);
		
		mesh.scaling.x = getVal("scl-x");
		mesh.scaling.y = getVal("scl-y");
		mesh.scaling.z = getVal("scl-z");
		
		mesh.setPivotPoint(new Vector3(getVal("piv-x"), getVal("piv-y"), getVal("piv-z")));
		
		markModified();
	};
	
	document.querySelectorAll("#property-editor input").forEach(input => {
		input.oninput = updateMesh;
	});
	
	document.getElementById("prop-id").onchange = (e) => {
		mesh.name = e.target.value;
		markModified();
		refreshSceneGraph(); // Name changed, update tree
	};
}

// ==========================================
// SCENE TREE VIEW
// ==========================================

function isUserMesh(mesh) {
	// Filter out internal meshes
	return mesh.name !== "previewSphere" &&
		!mesh.name.startsWith("gizmo") &&
		mesh.name !== "hdrSkyBox" &&
		(mesh.metadata?.isPrimitive || mesh.metadata?.isLightProxy);
}

export function refreshSceneGraph() {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	container.innerHTML = "";
	
	// Get root meshes (no parent)
	const roots = scene.meshes.filter(m => !m.parent && isUserMesh(m));
	
	if (roots.length === 0) {
		container.innerHTML = "<div class='opacity-50 italic'>Empty Scene</div>";
		return;
	}
	
	roots.forEach(mesh => {
		container.appendChild(createTreeNode(mesh, 0));
	});
	
	// Re-highlight if selection exists
	if (currentMesh) highlightInTree(currentMesh);
}

function createTreeNode(mesh, level) {
	const wrapper = document.createElement("div");
	
	// Row Container
	const row = document.createElement("div");
	row.className = "flex items-center hover:bg-base-content/10 rounded cursor-pointer p-1";
	row.style.paddingLeft = `${level * 12 + 4}px`;
	row.dataset.meshId = mesh.id;
	
	// Expand/Collapse Icon
	const children = scene.meshes.filter(m => m.parent === mesh && isUserMesh(m));
	const hasChildren = children.length > 0;
	
	const icon = document.createElement("span");
	icon.className = "w-4 h-4 mr-1 flex items-center justify-center font-mono text-xs opacity-70";
	if (hasChildren) {
		const isCollapsed = collapsedNodes.has(mesh.id);
		icon.innerText = isCollapsed ? "▶" : "▼";
		icon.onclick = (e) => {
			e.stopPropagation();
			if (isCollapsed) collapsedNodes.delete(mesh.id);
			else collapsedNodes.add(mesh.id);
			refreshSceneGraph();
		};
	} else {
		icon.innerText = "•";
	}
	row.appendChild(icon);
	
	// Name
	const label = document.createElement("span");
	label.innerText = mesh.name;
	label.className = "truncate flex-1";
	row.appendChild(label);
	
	// Selection Logic
	row.onclick = () => {
		selectMesh(mesh);
	};
	
	wrapper.appendChild(row);
	
	// Children Container
	if (hasChildren && !collapsedNodes.has(mesh.id)) {
		const childrenContainer = document.createElement("div");
		children.forEach(child => {
			childrenContainer.appendChild(createTreeNode(child, level + 1));
		});
		wrapper.appendChild(childrenContainer);
	}
	
	return wrapper;
}

function highlightInTree(mesh) {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	// Remove active class from all
	container.querySelectorAll("[data-mesh-id]").forEach(el => {
		el.classList.remove("bg-primary/20", "text-primary");
	});
	
	if (mesh) {
		const el = container.querySelector(`[data-mesh-id="${mesh.id}"]`);
		if (el) {
			el.classList.add("bg-primary/20", "text-primary");
			// Ensure parent nodes are expanded?
			// That would require traversing up and removing from collapsedNodes, then refreshing.
			// For now, simple highlight.
		}
	}
}
