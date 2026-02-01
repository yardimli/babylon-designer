import { MeshBuilder, Vector3, Quaternion } from "@babylonjs/core";
import { scene, getUniqueId } from "./scene.js";
import { gizmoManager, setGizmoMode } from "./gizmoControl.js";
import { createLight } from "./lightManager.js";
import { createTransformNode } from "./transformNodeManager.js";
import { markModified } from "./sceneManager.js";
import { refreshSceneGraph } from "./treeViewManager.js";
import { setShadowCaster } from "./shadowManager.js";
import { recordState } from "./historyManager.js";
import { selectNode } from "./selectionManager.js"; // Updated

const primitives = ["Cube", "Sphere", "Cylinder", "Plane", "Ground", "Cone", "Pyramid", "Empty"];
const lights = ["Point", "Directional"];

export function setupUI() {
	const pList = document.getElementById("primitives-list");
	const lList = document.getElementById("lights-list");
	const canvas = document.getElementById("renderCanvas");
	
	setupGizmoButtons();
	
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
		
		let createdNode = null;
		
		if (category === "primitive") {
			if (type === "Empty") {
				createdNode = createTransformNode(null, scene);
			} else {
				createdNode = createPrimitive(type);
			}
		} else if (category === "light") {
			createdNode = createLight(type.toLowerCase(), null, scene);
		}
		
		if (createdNode) {
			selectNode(createdNode, false); // Select the new item
			markModified();
			refreshSceneGraph();
			recordState();
		}
	});
}

function setupGizmoButtons() {
	const btnPos = document.getElementById("btn-gizmo-pos");
	const btnRot = document.getElementById("btn-gizmo-rot");
	const btnScl = document.getElementById("btn-gizmo-scl");
	
	const setActive = (activeBtn) => {
		[btnPos, btnRot, btnScl].forEach(btn => {
			if (btn === activeBtn) btn.classList.add("btn-active");
			else btn.classList.remove("btn-active");
		});
	};
	
	btnPos.onclick = () => {
		setGizmoMode("position");
		setActive(btnPos);
	};
	
	btnRot.onclick = () => {
		setGizmoMode("rotation");
		setActive(btnRot);
	};
	
	btnScl.onclick = () => {
		setGizmoMode("scale");
		setActive(btnScl);
	};
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

export function createPrimitive(type, savedData = null) {
	let mesh;
	const baseId = savedData ? savedData.id : `${type}_${Date.now()}`;
	const id = getUniqueId(scene, baseId);
	
	switch (type) {
		case "Cube":
			mesh = MeshBuilder.CreateBox(id, { size: 1 }, scene);
			break;
		case "Sphere":
			mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, scene);
			break;
		case "Cylinder":
			mesh = MeshBuilder.CreateCylinder(id, { height: 1, diameter: 1 }, scene);
			break;
		case "Plane":
			mesh = MeshBuilder.CreatePlane(id, { size: 1 }, scene);
			break;
		case "Ground":
			mesh = MeshBuilder.CreateGround(id, { width: 1, height: 1 }, scene);
			mesh.backFaceCulling = false;
			break;
		case "Cone":
			mesh = MeshBuilder.CreateCylinder(id, { diameterTop: 0, height: 1 }, scene);
			break;
		case "Pyramid":
			mesh = MeshBuilder.CreateCylinder(id, { diameterTop: 0, tessellation: 4, height: 1 }, scene);
			break;
	}
	
	if (mesh) {
		mesh.metadata = { type: type, isPrimitive: true };
		
		if (savedData) {
			if (savedData.name) mesh.name = savedData.name;
			mesh.position.set(savedData.position.x, savedData.position.y, savedData.position.z);
			mesh.scaling.set(savedData.scaling.x, savedData.scaling.y, savedData.scaling.z);
			
			if (!mesh.rotationQuaternion) mesh.rotationQuaternion = new Quaternion();
			if (savedData.rotation.w !== undefined) {
				mesh.rotationQuaternion.set(savedData.rotation.x, savedData.rotation.y, savedData.rotation.z, savedData.rotation.w);
			} else {
				mesh.rotationQuaternion = Quaternion.FromEulerAngles(savedData.rotation.x, savedData.rotation.y, savedData.rotation.z);
			}
			
			if (savedData.pivot) mesh.setPivotPoint(new Vector3(savedData.pivot.x, savedData.pivot.y, savedData.pivot.z));
			if (savedData.castShadows) setShadowCaster(mesh, true);
		} else {
			mesh.position.y = 0.5;
			setShadowCaster(mesh, true);
			if (type === "Ground" || type === "Plane") mesh.receiveShadows = true;
		}
		
		// Gizmo attachment is now handled by selectionManager calls in ui.js or load logic
	}
	return mesh;
}
