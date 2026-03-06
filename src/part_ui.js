import { MeshBuilder, Vector3, Quaternion, TransformNode, Color3, Color4, StandardMaterial, Mesh, Matrix } from "@babylonjs/core";
import earcut from 'earcut';
import { part, getUniqueId, camera } from "./part.js";
import { setGizmoMode } from "./part_gizmoControl.js";
import { createLight } from "./part_lightManager.js";
import { createTransformNode } from "./part_transformNodeManager.js";
import { markModified } from "./part_manager.js";
import { refreshPartGraph } from "./part_treeViewManager.js";
import { setShadowCaster } from "./part_shadowManager.js";
import { recordState } from "./part_historyManager.js";
import { selectNode } from "./part_selectionManager.js";
import { updateCSG, getNegativeMaterial } from "./part_csgManager.js";

// Added "Wedge" to the list of primitives
const primitives = ["Cube", "Sphere", "Cylinder", "Plane", "Ground", "Cone", "Pyramid", "Wedge", "Empty"];
const lights = ["Point", "Spot"];

// Store references to grid meshes
const gridMeshes = { xy: null, xz: null, yz: null };

export function setupUI() {
	const pList = document.getElementById("primitives-list");
	const lList = document.getElementById("lights-list");
	const sList = document.getElementById("shapes-list");
	const canvas = document.getElementById("renderCanvas");

	setupGizmoButtons();
	setupCameraControls();
	setupGridControls();
	setupSceneSettings();

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

	const btnRefreshShapes = document.getElementById("btn-refresh-shapes");
	if (btnRefreshShapes) {
		btnRefreshShapes.onclick = () => {
			sList.innerHTML = "";
			fetchShapes(sList);
		};
	}

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
				const filename = type.endsWith('.json') ? type : type + ".json";
				const res = await fetch(`/api/shapes?file=${filename}`);
				const json = await res.json();
				if (json.success) {
					createdNode = createShapeMesh(json.data, type);
					// Modified: Store filename in metadata so it can be saved by reference
					if (createdNode) {
						createdNode.metadata.shapeFilename = filename;
					}
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

// Added function to handle grid controls
function setupGridControls() {
	const btnXY = document.getElementById("btn-grid-xy");
	const btnXZ = document.getElementById("btn-grid-xz");
	const btnYZ = document.getElementById("btn-grid-yz");

	const toggle = (plane, btn) => {
		if (!gridMeshes[plane]) {
			gridMeshes[plane] = createGrid(plane);
		}
		const isVisible = !gridMeshes[plane].isEnabled();
		gridMeshes[plane].setEnabled(isVisible);

		if (isVisible) btn.classList.add("btn-active");
		else btn.classList.remove("btn-active");
	};

	if (btnXY) btnXY.onclick = () => toggle("xy", btnXY);
	if (btnXZ) btnXZ.onclick = () => toggle("xz", btnXZ);
	if (btnYZ) btnYZ.onclick = () => toggle("yz", btnYZ);
}

// Helper to create grid lines
function createGrid(plane) {
	const size = 20; // 20 units total size
	const spacing = 1; // 1 unit spacing
	const half = size / 2;
	const lines = [];

	// Grid color
	const color = new Color3(0.3, 0.3, 0.3);

	for (let i = -half; i <= half; i += spacing) {
		if (plane === "xz") {
			// Constant X, varying Z
			lines.push([new Vector3(i, 0, -half), new Vector3(i, 0, half)]);
			// Constant Z, varying X
			lines.push([new Vector3(-half, 0, i), new Vector3(half, 0, i)]);
		} else if (plane === "xy") {
			// Constant X, varying Y
			lines.push([new Vector3(i, -half, 0), new Vector3(i, half, 0)]);
			// Constant Y, varying X
			lines.push([new Vector3(-half, i, 0), new Vector3(half, i, 0)]);
		} else if (plane === "yz") {
			// Constant Y, varying Z
			lines.push([new Vector3(0, i, -half), new Vector3(0, i, half)]);
			// Constant Z, varying Y
			lines.push([new Vector3(0, -half, i), new Vector3(0, half, i)]);
		}
	}

	const grid = MeshBuilder.CreateLineSystem("grid_" + plane, { lines: lines }, part);
	grid.color = color;
	grid.isPickable = false;
	// Mark as internal so it doesn't get exported or show in tree view
	grid.metadata = { isInternal: true };
	// Start hidden
	grid.setEnabled(false);
	return grid;
}

// Added function to handle scene settings (Background & Ambient Light)
function setupSceneSettings() {
	const btnScene = document.getElementById("btn-menu-scene");
	const modal = document.getElementById("scene_settings_modal");
	const inputBg = document.getElementById("scene-bg-color");
	const inputIntensity = document.getElementById("scene-ambient-intensity");
	const labelIntensity = document.getElementById("val-ambient-intensity");
	// Added inputs for light colors
	const inputDiffuse = document.getElementById("scene-light-diffuse");
	const inputGround = document.getElementById("scene-light-ground");

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

				// Sync Ambient Light Properties
				const light = part.getLightByName("hemiLight");
				if (light) {
					if (inputIntensity) inputIntensity.value = light.intensity;
					if (labelIntensity) labelIntensity.innerText = light.intensity.toFixed(1);
					// Sync Colors
					if (inputDiffuse) inputDiffuse.value = light.diffuse.toHexString();
					if (inputGround) inputGround.value = light.groundColor.toHexString();
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
				markModified();
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
					markModified();
				}
			}
			if (labelIntensity) labelIntensity.innerText = val.toFixed(1);
		};
	}

	// Added Handle Diffuse Color Change
	if (inputDiffuse) {
		inputDiffuse.oninput = (e) => {
			if (part) {
				const light = part.getLightByName("hemiLight");
				if (light) {
					light.diffuse = Color3.FromHexString(e.target.value);
					markModified();
				}
			}
		};
	}

	// Added Handle Ground Color Change
	if (inputGround) {
		inputGround.oninput = (e) => {
			if (part) {
				const light = part.getLightByName("hemiLight");
				if (light) {
					light.groundColor = Color3.FromHexString(e.target.value);
					markModified();
				}
			}
		};
	}
}

function createDraggableItem(name, category) {
	const div = document.createElement("div");
	// Modified: Changed btn-sm to btn-xs for a more compact list
	div.className = "btn btn-xs btn-outline btn-secondary cursor-grab truncate";
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

	let rootMesh;

	// Check for new simplified format (single points array)
	if (shapeData.points && Array.isArray(shapeData.points)) {
		try {
			const vectorPoints = shapeData.points.map(p => new Vector3(p.x, 0, p.y));

			rootMesh = MeshBuilder.ExtrudePolygon(id, {
				shape: vectorPoints,
				depth: shapeData.extrusionHeight || 1,
				sideOrientation: MeshBuilder.FRONTSIDE,
				wrap: true
			}, part, earcut);

			// Default Material
			if (!rootMesh.material) {
				const mat = new StandardMaterial(rootMesh.name + "_mat", part);
				mat.backFaceCulling = false;
				mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
				rootMesh.material = mat;
			}
		} catch (e) {
			console.warn("Failed to extrude simplified shape", e);
		}
	}
	// Fallback to Legacy Format (Multiple shapes/holes)
	else if (shapeData.shapes) {
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

		// Store generated meshes to merge them later
		const meshes = [];

		// Create Meshes
		solids.forEach((solid, i) => {
			try {
				const mesh = MeshBuilder.ExtrudePolygon(i === 0 ? id : `${id}_part_${i}`, {
					shape: solid.points,
					holes: solid.myHoles,
					depth: shapeData.extrusionHeight,
					sideOrientation: MeshBuilder.FRONTSIDE,
					wrap: true
				}, part, earcut);

				if (!mesh.material) {
					const mat = new StandardMaterial(mesh.name + "_mat", part);
					mat.backFaceCulling = false;
					mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
					mesh.material = mat;
				}

				meshes.push(mesh);
			} catch (e) {
				console.warn("Failed to extrude shape part", e);
			}
		});

		if (meshes.length === 0) return null;

		if (meshes.length === 1) {
			rootMesh = meshes[0];
		} else {
			rootMesh = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
			rootMesh.name = id;
			rootMesh.id = id;
		}
	}

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

			// Modified: Preserve filename if it exists in saved state
			if (savedState.shapeFilename) {
				rootMesh.metadata.shapeFilename = savedState.shapeFilename;
			}
		} else {
			// Default placement
			rootMesh.position.y = shapeData.extrusionHeight || 1;
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
		case "Wedge": // Added Wedge
			// Right-Angle Wedge (Ramp shape)
			const wedgeShape = [
				new Vector3(-0.5, 0, -0.5),
				new Vector3(0.5, 0, -0.5),
				new Vector3(-0.5, 0, 0.5)
			];
			mesh = MeshBuilder.ExtrudePolygon(id, {
				shape: wedgeShape,
				depth: 1,
				sideOrientation: MeshBuilder.FRONTSIDE,
				wrap: true
			}, part, earcut);
			// Center the mesh geometry (ExtrudePolygon pivots at bottom)
			// Move Y down by 0.5 so pivot is at center of height
			mesh.bakeTransformIntoVertices(Matrix.Translation(0, -0.5, 0));
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
