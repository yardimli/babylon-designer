import { MeshBuilder, Vector3, Quaternion } from "@babylonjs/core";
import earcut from 'earcut'; // Added for shape extrusion
import { scene, getUniqueId } from "./assembly_scene.js";
import { setGizmoMode } from "./assembly_gizmoControl.js";
import { createLight } from "./assembly_lightManager.js";
import { createTransformNode } from "./assembly_transformNodeManager.js";
import { markModified } from "./assembly_manager.js";
import { refreshSceneGraph } from "./assembly_treeViewManager.js";
import { setShadowCaster } from "./assembly_shadowManager.js";
import { recordState } from "./assembly_historyManager.js";
import { selectNode } from "./assembly_selectionManager.js";

const primitives = ["Cube", "Sphere", "Cylinder", "Plane", "Ground", "Cone", "Pyramid", "Empty"];
const lights = ["Point", "Directional"];

export function setupUI() {
	const pList = document.getElementById("primitives-list");
	const lList = document.getElementById("lights-list");
	const canvas = document.getElementById("renderCanvas");

	setupGizmoButtons();

	if (pList) {
		primitives.forEach(type => {
			const div = createDraggableItem(type, "primitive");
			pList.appendChild(div);
		});
	}

	if (lList) {
		lights.forEach(type => {
			const div = createDraggableItem(type, "light");
			lList.appendChild(div);
		});
	}

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
			selectNode(createdNode, false);
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

	if (!btnPos) return;

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

// NEW: Function to build mesh from shape data (Adapted from part_ui.js)
export function createShapeMesh(shapeData, name, savedState = null) {
	const baseId = savedState ? savedState.id : `${name}_${Date.now()}`;
	const id = getUniqueId(scene, baseId);

	// Reconstruct geometry
	const solids = [];
	const holes = [];

	// Helper to convert shape object to Vector3 array
	const getPoints = (shape) => {
		const points = [];
		if (shape.type === 'rect') {
			points.push(
				new Vector3(shape.x, 0, shape.y),
				new Vector3(shape.x + shape.w, 0, shape.y),
				new Vector3(shape.x + shape.w, 0, shape.y + shape.h),
				new Vector3(shape.x, 0, shape.y + shape.h)
			);
		} else if (shape.type === 'circle') {
			const segments = 32;
			const r = shape.diameter / 2;
			for (let j = 0; j < segments; j++) {
				const theta = (j / segments) * Math.PI * 2;
				points.push(new Vector3(
					shape.x + Math.cos(theta) * r,
					0,
					shape.y + Math.sin(theta) * r
				));
			}
		} else if (shape.type === 'poly') {
			shape.points.forEach(p => points.push(new Vector3(p.x, 0, p.y)));
		}
		return points;
	};

	// Helper: Check if point is inside polygon
	const isPointInPoly = (pt, poly) => {
		let inside = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const xi = poly[i].x; const yi = poly[i].z;
			const xj = poly[j].x; const yj = poly[j].z;
			const intersect = ((yi > pt.z) !== (yj > pt.z)) &&
				(pt.x < (xj - xi) * (pt.z - yi) / (yj - yi) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	};

	// Process shapes
	shapeData.shapes.forEach((shape, i) => {
		const points = getPoints(shape);
		if (points.length < 3) return;
		if (shape.isHole) {
			holes.push({ points });
		} else {
			solids.push({ points, myHoles: [] });
		}
	});

	// Assign holes
	holes.forEach(hole => {
		for (const solid of solids) {
			if (isPointInPoly(hole.points[0], solid.points)) {
				solid.myHoles.push(hole.points);
				break;
			}
		}
	});

	let rootMesh = null;

	// Create Meshes
	solids.forEach((solid, i) => {
		try {
			const mesh = MeshBuilder.ExtrudePolygon(i === 0 ? id : `${id}_part_${i}`, {
				shape: solid.points,
				holes: solid.myHoles,
				depth: shapeData.extrusionHeight,
				sideOrientation: MeshBuilder.DOUBLESIDE,
				wrap: true
			}, scene, earcut);

			if (i === 0) {
				rootMesh = mesh;
			} else {
				mesh.parent = rootMesh;
			}
		} catch (e) {
			console.warn("Failed to extrude shape part", e);
		}
	});

	if (rootMesh) {
		// Store data for save/load
		rootMesh.metadata = {
			isShape: true,
			shapeData: shapeData,
			shapeName: name,
			castShadows: true
		};

		if (savedState) {
			if (savedState.name) rootMesh.name = savedState.name;
			rootMesh.position.set(savedState.position.x, savedState.position.y, savedState.position.z);
			rootMesh.scaling.set(savedState.scaling.x, savedState.scaling.y, savedState.scaling.z);

			if (!rootMesh.rotationQuaternion) rootMesh.rotationQuaternion = new Quaternion();
			if (savedState.rotation.w !== undefined) {
				rootMesh.rotationQuaternion.set(savedState.rotation.x, savedState.rotation.y, savedState.rotation.z, savedState.rotation.w);
			} else {
				rootMesh.rotationQuaternion = Quaternion.FromEulerAngles(savedState.rotation.x, savedState.rotation.y, savedState.rotation.z);
			}

			if (savedState.pivot) rootMesh.setPivotPoint(new Vector3(savedState.pivot.x, savedState.pivot.y, savedState.pivot.z));
			if (savedState.castShadows) setShadowCaster(rootMesh, true);
			if (savedState.receiveShadows) rootMesh.receiveShadows = true;
			if (savedState.materialId) {
				const mat = scene.getMaterialByID(savedState.materialId);
				if (mat) rootMesh.material = mat;
			}
			if (savedState.visible !== undefined) rootMesh.setEnabled(savedState.visible);
		} else {
			// Default placement
			rootMesh.position.y = shapeData.extrusionHeight;
			setShadowCaster(rootMesh, true);
		}
	}

	return rootMesh;
}

export function createPrimitive(type, savedData = null) {
	let mesh;
	const baseId = savedData ? savedData.id : `${type}_${Date.now()}`;
	const id = getUniqueId(scene, baseId);

	switch (type) {
		case "Cube":
			mesh = MeshBuilder.CreateBox(id, {size: 1}, scene);
			break;
		case "Sphere":
			mesh = MeshBuilder.CreateSphere(id, {diameter: 1}, scene);
			break;
		case "Cylinder":
			mesh = MeshBuilder.CreateCylinder(id, {height: 1, diameter: 1}, scene);
			break;
		case "Plane":
			mesh = MeshBuilder.CreatePlane(id, {size: 1}, scene);
			break;
		case "Ground":
			mesh = MeshBuilder.CreateGround(id, {width: 1, height: 1}, scene);
			mesh.backFaceCulling = false;
			break;
		case "Cone":
			mesh = MeshBuilder.CreateCylinder(id, {diameterTop: 0, height: 1}, scene);
			break;
		case "Pyramid":
			mesh = MeshBuilder.CreateCylinder(id, {diameterTop: 0, tessellation: 4, height: 1}, scene);
			break;
	}

	if (mesh) {
		mesh.metadata = {type: type, isPrimitive: true};

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

			// Fix: Restore receiveShadows
			if (savedData.receiveShadows !== undefined) {
				mesh.receiveShadows = savedData.receiveShadows;
			}
		} else {
			mesh.position.y = 0.5;
			setShadowCaster(mesh, true);
			if (type === "Ground" || type === "Plane") mesh.receiveShadows = true;
		}
	}
	return mesh;
}