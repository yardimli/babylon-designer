import { GizmoManager, PointerEventTypes, TransformNode, Vector3, Quaternion, Space } from "@babylonjs/core";
import { markModified } from "./assembly_manager.js";
import { recordState } from "./assembly_historyManager.js";
import { selectNode, getSelectedNodes } from "./assembly_selectionManager.js";
import { scene } from "./assembly_scene.js";
import { updateCSG } from "./assembly_csgManager.js";
import { part } from "./part.js";

export let gizmoManager;
let selectionAnchor = null;
let originalParents = new Map();
let pointerObserver = null;

export function disposeGizmos() {

	if (pointerObserver) {
		scene.onPointerObservable.remove(pointerObserver);
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
	disposeGizmos();

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
					let check = target;
					let foundRoot = null;
					while (check) {
						if (check.metadata && check.metadata.isAssemblyRoot) {
							foundRoot = check;
							break;
						}
						check = check.parent;
					}
					if (foundRoot) target = foundRoot;
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

export function updateGizmoAttachment(nodes) {
	if (!gizmoManager) return;

	// Check if any selected node is locked
	const isLocked = nodes.some(n => n.metadata && n.metadata.isLocked);

	if (nodes.length === 0 || isLocked) {
		// Detach if empty or locked
		gizmoManager.attachToMesh(null);
		gizmoManager.attachToNode(null);
		return;
	}

	if (nodes.length === 1) {
		const target = nodes[0];
		if (target.getClassName() === "TransformNode" || (target.metadata && target.metadata.isTransformNode)) {
			gizmoManager.attachToNode(target);
		} else {
			gizmoManager.attachToMesh(target);
		}
	} else {
		updateAnchorPosition(nodes);
		gizmoManager.attachToNode(selectionAnchor);
	}
}

function updateAnchorPosition(nodes) {
	if (!selectionAnchor || nodes.length === 0) return;

	let center = Vector3.Zero();
	nodes.forEach(n => center.addInPlace(n.absolutePosition));
	center.scaleInPlace(1.0 / nodes.length);

	selectionAnchor.position.copyFrom(center);
	selectionAnchor.rotationQuaternion = Quaternion.Identity();
	selectionAnchor.scaling.setAll(1);
}

export function setGizmoMode(mode) {
	if (!gizmoManager) return;

	gizmoManager.positionGizmoEnabled = (mode === "position");
	gizmoManager.rotationGizmoEnabled = (mode === "rotation");
	gizmoManager.scaleGizmoEnabled = (mode === "scale");

	attachDragObservers();
}

function attachDragObservers() {
	if (!gizmoManager || !gizmoManager.gizmos) return;

	const gizmos = [
		gizmoManager.gizmos.positionGizmo,
		gizmoManager.gizmos.rotationGizmo,
		gizmoManager.gizmos.scaleGizmo
	];

	gizmos.forEach(g => {
		if (g && !g._hasObserver) {

			g.onDragStartObservable.add(() => {
				const nodes = getSelectedNodes();
				// Double check locking
				if (nodes.some(n => n.metadata && n.metadata.isLocked)) return;

				if (nodes.length > 1 && selectionAnchor) {
					originalParents.clear();

					nodes.forEach(node => {
						originalParents.set(node.id, node.parent);
						node.setParent(selectionAnchor);
					});
				}

				scene.meshes.forEach(m => {
					if (m.metadata && m.metadata.isCSGResult) m.isVisible = false;
					if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape) && !m.metadata.isNegative && m.isEnabled()) m.isVisible = true;
				});
			});

			g.onDragEndObservable.add(() => {
				const nodes = getSelectedNodes();
				// Double check locking
				if (nodes.some(n => n.metadata && n.metadata.isLocked)) return;

				if (nodes.length > 1 && selectionAnchor) {
					nodes.forEach(node => {
						const originalParent = originalParents.get(node.id);
						node.setParent(originalParent);
					});
					originalParents.clear();

					updateAnchorPosition(nodes);
				}

				updateCSG();
				markModified();
				recordState();
			});

			g._hasObserver = true;
		}
	});
}

export function selectMesh(target) {
	selectNode(target, false);
}