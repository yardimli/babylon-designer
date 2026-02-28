import { MeshBuilder, Vector3, Quaternion, TransformNode, Color3, Color4 } from "@babylonjs/core"; // Added Color3, Color4
import earcut from 'earcut'; // Required for polygon extrusion
import { part, getUniqueId, camera } from "./part.js"; // Added camera
import { setGizmoMode } from "./part_gizmoControl.js";
import { createLight } from "./part_lightManager.js";
import { createTransformNode } from "./part_transformNodeManager.js";
import { markModified } from "./part_manager.js";
import { refreshPartGraph } from "./part_treeViewManager.js";
import { setShadowCaster } from "./part_shadowManager.js";
import { recordState } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { updateCSG, getNegativeMaterial } from "./part_csgManager.js"; // Added

const primitives = ["Cube", "Sphere", "Cylinder", "Plane", "Ground", "Cone", "Pyramid", "Empty"];
const lights = ["Point", "Spot"];

export function setupUI() {
	const pList = document.getElementById("primitives-list");
	const lList = document.getElementById("lights-list");
	const sList = document.getElementById("shapes-list");
	const canvas = document.getElementById("renderCanvas");

	setupGizmoButtons();
	setupCameraControls(); // Added camera controls setup
	setupSceneSettings(); // Added scene settings setup

	// --- Added Keyboard Shortcuts ---
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			// Check if any modal is open to prevent accidental deselection when closing a modal
			if (document.querySelector("dialog[open]")) return;

			selectNode(null);
		}
	});
	// --------------------------------

	primitives.forEach(type => {
		const div = createDraggableItem(type, "primitive");
		pList.appendChild(div);
	});

	lights.forEach(type => {
		const div = createDraggableItem(type, "light");
		lList.appendChild(div);
	});

	// Load saved shapes
	fetchShapes(sList);

	canvas.addEventListener("dragover", (e) => e.preventDefault());
	canvas.addEventListener("drop", async (e) => {
		e.preventDefault();
		const type = e.dataTransfer.getData("type");
		const category = e.dataTransfer.getData("category");

		let createdNode = null;

		if (category === "primitive") {
			if (type === "Empty") {
				createdNode = createTransformNode(null, part);
			} else {
				createdNode = createPrimitive(type);
			}
		} else if (category === "light") {
			createdNode = createLight(type.toLowerCase(), null, part);
		} else if (category === "shape") {
			//  Handle Shape Drop
			try {
				const res = await fetch(`/api/shapes?file=${type}.json`);
				const json = await res.json();
				if (json.success) {
					createdNode = createShapeMesh(json.data, type);
				}
			} catch (err) {
				console.error("Failed to load shape", err);
			}
		}

		if (createdNode) {
			selectNode(createdNode, false);
			updateCSG(); // Recompute CSG when new nodes are added
			markModified();
			refreshPartGraph();
			recordState();
		}
	});
}

async function fetchShapes(container) {
	if (!container) return;
	try {
		const res = await fetch('/api/shapes');
		const data = await res.json();
		if (data.files) {
			data.files.forEach(file => {
				const name = file.replace('.json', '');
				const div = createDraggableItem(name, "shape");
				div.classList.replace("btn-secondary", "btn-accent"); // Different color for shapes
				container.appendChild(div);
			});
		}
	} catch (e) {
		console.error("Failed to fetch shapes", e);
	}
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

// Added function to handle camera position buttons
function setupCameraControls() {
	const setView = (alpha, beta) => {
		if (!camera) return;
		camera.alpha = alpha;
		camera.beta = beta;
	};

	const map = {
		"top": { a: -Math.PI / 2, b: 0 },
		"bottom": { a: -Math.PI / 2, b: Math.PI },
		"front": { a: -Math.PI / 2, b: Math.PI / 2 },
		"back": { a: Math.PI / 2, b: Math.PI / 2 },
		"left": { a: Math.PI, b: Math.PI / 2 },
		"right": { a: 0, b: Math.PI / 2 }
	};

	Object.keys(map).forEach(id => {
		const btn = document.getElementById(`btn-view-${id}`);
		if (btn) {
			btn.onclick = () => setView(map[id].a, map[id].b);
		}
	});
}

// Added function to handle scene settings (Background & Ambient Light)
function setupSceneSettings() {
	const btnScene = document.getElementById("btn-menu-scene");
	const modal = document.getElementById("scene_settings_modal");
	const inputBg = document.getElementById("scene-bg-color");
	const inputIntensity = document.getElementById("scene-ambient-intensity");
	const labelIntensity = document.getElementById("val-ambient-intensity");

	if (btnScene && modal) {
		btnScene.onclick = () => {
			// Sync UI with current scene state before showing
			if (part) {
				// Sync Background Color
				if (part.clearColor) {
					// Convert Color4 to Hex (#RRGGBB) for input type="color"
					const hex = part.clearColor.toHexString().substring(0, 7);
					if (inputBg) inputBg.value = hex;
				}

				// Sync Ambient Light Intensity
				const light = part.getLightByName("hemiLight");
				if (light) {
					if (inputIntensity) inputIntensity.value = light.intensity;
					if (labelIntensity) labelIntensity.innerText = light.intensity.toFixed(1);
				}
			}
			modal.showModal();
		};
	}

	// Handle Background Color Change
	if (inputBg) {
		inputBg.oninput = (e) => {
			if (part) {
				// Convert Hex to Color3 then to Color4 (Alpha 1)
				const c3 = Color3.FromHexString(e.target.value);
				part.clearColor = new Color4(c3.r, c3.g, c3.b, 1);
			}
		};
	}

	// Handle Ambient Light Intensity Change
	if (inputIntensity) {
		inputIntensity.oninput = (e) => {
			const val = parseFloat(e.target.value);
			if (part) {
				const light = part.getLightByName("hemiLight");
				if (light) {
					light.intensity = val;
				}
			}
			if (labelIntensity) labelIntensity.innerText = val.toFixed(1);
		};
	}
}

function createDraggableItem(name, category) {
	const div = document.createElement("div");
	div.className = "btn btn-sm btn-outline btn-secondary cursor-grab truncate";
	div.innerText = name;
	div.draggable = true;
	div.addEventListener("dragstart", (e) => {
		e.dataTransfer.setData("type", name);
		e.dataTransfer.setData("category", category);
	});
	return div;
}

//  Function to build mesh from shape data (mirrors shapeEditor logic)
export function createShapeMesh(shapeData, name, savedState = null) {
	const baseId = savedState ? savedState.id : `${name}_${Date.now()}`;
	const id = getUniqueId(part, baseId);

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
			}, part, earcut);

			// Center pivot logic could go here, but for now keep origin
			// ExtrudePolygon builds downwards usually, let's fix orientation to match primitive behavior if needed
			// But ShapeEditor output is Y-up based on XZ plane.

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
			castShadows: true,
			isNegative: false // Default CSG state
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
				const mat = part.getMaterialByID(savedState.materialId);
				if (mat) rootMesh.material = mat;
			}
			if (savedState.visible !== undefined) rootMesh.setEnabled(savedState.visible);

			// Apply CSG state
			if (savedState.isNegative) {
				rootMesh.metadata.isNegative = true;
				rootMesh.metadata.originalMaterialId = savedState.originalMaterialId;
				rootMesh.material = getNegativeMaterial(part);
			}
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
	const id = getUniqueId(part, baseId);

	switch (type) {
		case "Cube":
			mesh = MeshBuilder.CreateBox(id, { size: 1 }, part);
			break;
		case "Sphere":
			mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, part);
			break;
		case "Cylinder":
			mesh = MeshBuilder.CreateCylinder(id, { height: 1, diameter: 1 }, part);
			break;
		case "Plane":
			mesh = MeshBuilder.CreatePlane(id, { size: 1 }, part);
			break;
		case "Ground":
			mesh = MeshBuilder.CreateGround(id, { width: 1, height: 1 }, part);
			mesh.backFaceCulling = false;
			break;
		case "Cone":
			mesh = MeshBuilder.CreateCylinder(id, { diameterTop: 0, height: 1 }, part);
			break;
		case "Pyramid":
			mesh = MeshBuilder.CreateCylinder(id, { diameterTop: 0, tessellation: 4, height: 1 }, part);
			break;
	}

	if (mesh) {
		mesh.metadata = { type: type, isPrimitive: true, isNegative: false };

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

			// Apply CSG state
			if (savedData.isNegative) {
				mesh.metadata.isNegative = true;
				mesh.metadata.originalMaterialId = savedData.originalMaterialId;
				mesh.material = getNegativeMaterial(part);
			}
		} else {
			mesh.position.y = 0.5;
			setShadowCaster(mesh, true);
			if (type === "Ground" || type === "Plane") mesh.receiveShadows = true;
		}
	}
	return mesh;
}