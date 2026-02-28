import { GizmoManager, PointerEventTypes, TransformNode, Vector3, Quaternion, Space } from "@babylonjs/core";
import { markModified } from "./part_manager.js";
import { recordState } from "./part_historyManager.js";
import { selectNode, getSelectedNodes } from "./part_selectionManager.js";
import { part } from "./part.js";
import { updateCSG } from "./part_csgManager.js";

export let gizmoManager;
let selectionAnchor = null;
let originalParents = new Map();
let pointerObserver = null; // 1. Add variable to track the observer

export function disposeGizmos() {
	// 2. Remove the observer if it exists
	if (pointerObserver && part) {
		part.onPointerObservable.remove(pointerObserver);
		pointerObserver = null;
	}

	if (gizmoManager) {
		gizmoManager.dispose();
		gizmoManager = null;
	}
	if (selectionAnchor) {
		selectionAnchor.dispose();
		selectionAnchor = null;
	}
}

export function setupGizmos(scene) {
	disposeGizmos(); // This will now clean up the previous observer

	gizmoManager = new GizmoManager(scene);

	// Default to Position Gizmo only
	gizmoManager.positionGizmoEnabled = true;
	gizmoManager.rotationGizmoEnabled = false;
	gizmoManager.scaleGizmoEnabled = false;
	gizmoManager.boundingBoxGizmoEnabled = false;

	gizmoManager.usePointerToAttachGizmos = false;
	gizmoManager.clearGizmoOnEmptyPointerEvent = false;

	selectionAnchor = new TransformNode("selectionAnchor", scene);
	selectionAnchor.rotationQuaternion = Quaternion.Identity();
	selectionAnchor.metadata = { isInternal: true };

	// 3. Assign the observer to the variable
	pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
		if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
			if (pointerInfo.event.button !== 0) return;

			const pick = pointerInfo.pickInfo;
			const isMulti = pointerInfo.event.shiftKey;

			if (pick.hit && pick.pickedMesh && isMulti) {
				const mesh = pick.pickedMesh;
				if (mesh.isGizmoMesh || mesh.name.startsWith("gizmo_")) return;

				let target = null;

				if (mesh.metadata && mesh.metadata.isTransformNodeProxy) {
					target = mesh.parent;
				}
				else if (mesh.metadata && mesh.metadata.isCSGResult) {
					target = scene.getMeshByID(mesh.metadata.originalMeshId);
				}
				else {
					target = mesh;
				}

				if (target) {
					selectNode(target, isMulti);
				}
			} if (!pick.hit && isMulti) {
				selectNode(null);
			}
		}
	});

	attachDragObservers();
}

// Called by selectionManager when selection changes
export function updateGizmoAttachment(nodes) {
	if (!gizmoManager) return;

	if (nodes.length === 0) {
		gizmoManager.attachToMesh(null);
		gizmoManager.attachToNode(null);
		return;
	}

	if (nodes.length === 1) {
		// Single Select: Attach directly
		const target = nodes[0];
		if (target.getClassName() === "TransformNode" || (target.metadata && target.metadata.isTransformNode)) {
			gizmoManager.attachToNode(target);
		} else {
			gizmoManager.attachToMesh(target);
		}
	} else {
		// Multi Select: Attach to Anchor
		updateAnchorPosition(nodes);
		gizmoManager.attachToNode(selectionAnchor);
	}
}

function updateAnchorPosition(nodes) {
	if (!selectionAnchor || nodes.length === 0) return;

	// Calculate center
	let center = Vector3.Zero();
	nodes.forEach(n => center.addInPlace(n.absolutePosition));
	center.scaleInPlace(1.0 / nodes.length);

	selectionAnchor.position.copyFrom(center);
	selectionAnchor.rotationQuaternion = Quaternion.Identity();
	selectionAnchor.scaling.setAll(1);
}

// Function to switch gizmo modes
export function setGizmoMode(mode) {
	if (!gizmoManager) return;

	gizmoManager.positionGizmoEnabled = (mode === "position");
	gizmoManager.rotationGizmoEnabled = (mode === "rotation");
	gizmoManager.scaleGizmoEnabled = (mode === "scale");

	attachDragObservers();
}

// Helper to attach observers to active gizmos
function attachDragObservers() {
	if (!gizmoManager || !gizmoManager.gizmos) return;

	const gizmos = [
		gizmoManager.gizmos.positionGizmo,
		gizmoManager.gizmos.rotationGizmo,
		gizmoManager.gizmos.scaleGizmo
	];

	gizmos.forEach(g => {
		if (g && !g._hasObserver) {

			// --- Drag Start: Parent nodes to Anchor ---
			g.onDragStartObservable.add(() => {
				const nodes = getSelectedNodes();
				if (nodes.length > 1 && selectionAnchor) {
					originalParents.clear();

					nodes.forEach(node => {
						// Store original parent
						originalParents.set(node.id, node.parent);

						// Parent to anchor, maintaining world position
						node.setParent(selectionAnchor);
					});
				}

				// Temporarily show original meshes and hide CSG results during drag
				part.meshes.forEach(m => {
					if (m.metadata && m.metadata.isCSGResult) m.isVisible = false;
					if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape) && !m.metadata.isNegative && m.isEnabled()) m.isVisible = true;
				});
			});

			// --- Drag End: Restore parents & Record ---
			g.onDragEndObservable.add(() => {
				const nodes = getSelectedNodes();

				if (nodes.length > 1 && selectionAnchor) {
					nodes.forEach(node => {
						const originalParent = originalParents.get(node.id);
						// Restore parent, maintaining world position (which is now modified)
						node.setParent(originalParent);
					});
					originalParents.clear();

					// Reset anchor rotation/scale for next time, but keep position at center
					// Actually, simpler to just re-calculate anchor from new centers
					updateAnchorPosition(nodes);
				}

				updateCSG(); // Recompute CSG after transform changes
				markModified();
				recordState();
			});

			g._hasObserver = true;
		}
	});
}

// Deprecated export kept for compatibility if needed, but redirects to manager
export function selectMesh(target) {
	selectNode(target, false);
}