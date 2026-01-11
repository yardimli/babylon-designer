import { Vector3, Quaternion } from "@babylonjs/core";
import { scene } from "./scene.js";
import { markModified } from "./sceneManager.js"; // Import modified tracker

let currentMesh = null;
let observer = null;

// Helper to create vector3 inputs
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

// Initialize UI structure
const transformContainer = document.getElementById("transform-container");
createVec3Input("Position", "pos", transformContainer);
createVec3Input("Rotation (Deg)", "rot", transformContainer);
createVec3Input("Scale", "scl", transformContainer);
createVec3Input("Pivot Point", "piv", transformContainer);

export function updatePropertyEditor(mesh) {
	const editor = document.getElementById("property-editor");
	
	// Clean up previous observer
	if (observer) {
		scene.onBeforeRenderObservable.remove(observer);
		observer = null;
	}
	
	currentMesh = mesh;
	
	if (!mesh) {
		editor.classList.add("opacity-50", "pointer-events-none");
		document.getElementById("prop-id").value = "";
		return;
	}
	
	editor.classList.remove("opacity-50", "pointer-events-none");
	
	// Populate Static Fields
	document.getElementById("prop-id").value = mesh.name;
	updateParentDropdown(mesh);
	updateMaterialDropdown(mesh);
	
	// Bind Inputs
	bindInputs(mesh);
	
	// Continuous update loop for transforms (in case gizmo moves it)
	observer = scene.onBeforeRenderObservable.add(() => {
		if(!currentMesh) return;
		syncUIFromMesh(currentMesh);
	});
}

function updateParentDropdown(mesh) {
	const select = document.getElementById("prop-parent");
	select.innerHTML = '<option value="">None</option>';
	
	scene.meshes.forEach(m => {
		if (m !== mesh && m.parent !== mesh) { // Simple cycle prevention
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
		markModified(); // Mark as modified
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
		markModified(); // Mark as modified
	};
}

function syncUIFromMesh(mesh) {
	if(document.activeElement.tagName === "INPUT") return; // Don't overwrite while typing
	
	// Position
	document.getElementById("pos-x").value = mesh.position.x.toFixed(2);
	document.getElementById("pos-y").value = mesh.position.y.toFixed(2);
	document.getElementById("pos-z").value = mesh.position.z.toFixed(2);
	
	// Rotation (Euler)
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
	
	// Scale
	document.getElementById("scl-x").value = mesh.scaling.x.toFixed(2);
	document.getElementById("scl-y").value = mesh.scaling.y.toFixed(2);
	document.getElementById("scl-z").value = mesh.scaling.z.toFixed(2);
	
	// Pivot
	const pivot = mesh.getPivotPoint();
	document.getElementById("piv-x").value = pivot.x.toFixed(2);
	document.getElementById("piv-y").value = pivot.y.toFixed(2);
	document.getElementById("piv-z").value = pivot.z.toFixed(2);
}

function bindInputs(mesh) {
	const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
	
	const updateMesh = () => {
		// Position
		mesh.position.x = getVal("pos-x");
		mesh.position.y = getVal("pos-y");
		mesh.position.z = getVal("pos-z");
		
		// Rotation
		const radX = getVal("rot-x") * Math.PI / 180;
		const radY = getVal("rot-y") * Math.PI / 180;
		const radZ = getVal("rot-z") * Math.PI / 180;
		
		if(!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
		Quaternion.FromEulerAnglesToRef(radX, radY, radZ, mesh.rotationQuaternion);
		
		// Scale
		mesh.scaling.x = getVal("scl-x");
		mesh.scaling.y = getVal("scl-y");
		mesh.scaling.z = getVal("scl-z");
		
		// Pivot
		mesh.setPivotPoint(new Vector3(getVal("piv-x"), getVal("piv-y"), getVal("piv-z")));
		
		markModified(); // Mark as modified
	};
	
	// Attach listeners
	document.querySelectorAll("#property-editor input").forEach(input => {
		input.oninput = updateMesh;
	});
	
	document.getElementById("prop-id").onchange = (e) => {
		mesh.name = e.target.value;
		markModified(); // Mark as modified
	};
}
