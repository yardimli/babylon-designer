import { GizmoManager, PointerEventTypes, TransformNode, Vector3, Quaternion, Space } from "@babylonjs/core";
import { markModified } from "./sceneManager.js";
import { recordState } from "./historyManager.js";
import { selectNode, getSelectedNodes } from "./selectionManager.js";
import { scene } from "./scene.js";

export let gizmoManager;
let selectionAnchor = null;
let originalParents = new Map(); // Stores { nodeId: parentNode } during drag

export function disposeGizmos() {
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
	
	// Disable default pointer attachment. We handle picking manually.
	gizmoManager.usePointerToAttachGizmos = false;
	gizmoManager.clearGizmoOnEmptyPointerEvent = false;
	
	// Create the Multi-Selection Anchor (hidden node)
	selectionAnchor = new TransformNode("selectionAnchor", scene);
	selectionAnchor.rotationQuaternion = Quaternion.Identity();
	// Ensure it doesn't get saved or shown in tree
	selectionAnchor.metadata = { isInternal: true };
	
	// Custom Selection Logic
	scene.onPointerObservable.add((pointerInfo) => {
		if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
			// Only react to Left Click (button 0)
			if (pointerInfo.event.button !== 0) return;
			
			const pick = pointerInfo.pickInfo;
			const isMulti = pointerInfo.event.shiftKey;
			
			if (pick.hit && pick.pickedMesh) {
				const mesh = pick.pickedMesh;
				
				// Don't select the gizmos themselves
				if (mesh.isGizmoMesh || mesh.name.startsWith("gizmo_")) return;
				
				let target = null;
				
				// 1. Check if we clicked a TransformNode Proxy
				if (mesh.metadata && mesh.metadata.isTransformNodeProxy) {
					target = mesh.parent;
				}
				// 2. Standard Mesh or Light Proxy
				else {
					target = mesh;
				}
				
				if (target) {
					selectNode(target, isMulti);
				}
			} else {
				// Clicked on empty space - Deselect
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
