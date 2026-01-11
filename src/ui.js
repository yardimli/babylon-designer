import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { scene } from "./scene.js";
import { gizmoManager } from "./gizmoControl.js";
import { createLight } from "./lightManager.js";
import { markModified } from "./sceneManager.js";

const primitives = ["Cube", "Sphere", "Cylinder", "Plane", "Cone", "Pyramid"];
const lights = ["Point", "Directional"];

export function setupUI() {
	const pList = document.getElementById("primitives-list");
	const lList = document.getElementById("lights-list");
	const canvas = document.getElementById("renderCanvas");
	
	primitives.forEach(type => {
		const div = createDraggableItem(type, "primitive");
		pList.appendChild(div);
	});
	
	lights.forEach(type => {
		const div = createDraggableItem(type, "light");
		lList.appendChild(div);
	});
	
	canvas.addEventListener("dragover", (e) => e.preventDefault());
	canvas.addEventListener("drop", (e) => {
		e.preventDefault();
		const type = e.dataTransfer.getData("type");
		const category = e.dataTransfer.getData("category");
		
		let created = false;
		
		if (category === "primitive") {
			createPrimitive(type);
			created = true;
		} else if (category === "light") {
			const proxy = createLight(type.toLowerCase(), null, scene);
			if(proxy) {
				gizmoManager.attachToMesh(proxy);
				created = true;
			}
		}
		
		if (created) markModified();
	});
}

function createDraggableItem(name, category) {
	const div = document.createElement("div");
	div.className = "btn btn-sm btn-outline btn-secondary cursor-grab";
	div.innerText = name;
	div.draggable = true;
	div.addEventListener("dragstart", (e) => {
		e.dataTransfer.setData("type", name);
		e.dataTransfer.setData("category", category);
	});
	return div;
}

// Exported so the Loader can use it too
export function createPrimitive(type, savedData = null) {
	let mesh;
	const id = savedData ? savedData.id : `${type}_${Date.now()}`;
	
	switch(type) {
		case "Cube": mesh = MeshBuilder.CreateBox(id, {size: 1}, scene); break;
		case "Sphere": mesh = MeshBuilder.CreateSphere(id, {diameter: 1}, scene); break;
		case "Cylinder": mesh = MeshBuilder.CreateCylinder(id, {height: 1, diameter: 1}, scene); break;
		case "Plane": mesh = MeshBuilder.CreatePlane(id, {size: 1}, scene); break;
		case "Cone": mesh = MeshBuilder.CreateCylinder(id, {diameterTop: 0, height: 1}, scene); break;
		case "Pyramid": mesh = MeshBuilder.CreateCylinder(id, {diameterTop: 0, tessellation: 4, height: 1}, scene); break;
	}
	
	if (mesh) {
		// IMPORTANT: Store type in metadata for saving later
		mesh.metadata = { type: type, isPrimitive: true };
		
		if (savedData) {
			// Restore Transforms
			mesh.position.set(savedData.position.x, savedData.position.y, savedData.position.z);
			mesh.scaling.set(savedData.scaling.x, savedData.scaling.y, savedData.scaling.z);
			if (mesh.rotationQuaternion) {
				mesh.rotationQuaternion.set(savedData.rotation.x, savedData.rotation.y, savedData.rotation.z, savedData.rotation.w);
			} else {
				// If saved as Euler (though we prefer Quaternion)
				mesh.rotation.set(savedData.rotation.x, savedData.rotation.y, savedData.rotation.z);
			}
		} else {
			// New Object Defaults
			mesh.position.y = 0.5;
		}
		
		gizmoManager.attachToMesh(mesh);
	}
	return mesh;
}
