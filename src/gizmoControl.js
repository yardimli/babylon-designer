import { GizmoManager, TransformNode } from "@babylonjs/core";
import { updatePropertyEditor } from "./propertyEditor.js";
import { markModified } from "./sceneManager.js";

export let gizmoManager;

export function disposeGizmos() {
	if (gizmoManager) {
		gizmoManager.dispose();
		gizmoManager = null;
	}
}

export function setupGizmos(scene) {
	disposeGizmos(); // Ensure we don't have duplicates
	
	gizmoManager = new GizmoManager(scene);
	
	// Default to Position Gizmo only
	gizmoManager.positionGizmoEnabled = true;
	gizmoManager.rotationGizmoEnabled = false;
	gizmoManager.scaleGizmoEnabled = false;
	gizmoManager.boundingBoxGizmoEnabled = false;
	
	gizmoManager.usePointerToAttachGizmos = true;
	gizmoManager.clearGizmoOnEmptyPointerEvent = true;
	
	// Handle Mesh Attachment
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		if (mesh) {
			// Check if it's a TransformNode Proxy
			if (mesh.metadata && mesh.metadata.isTransformNodeProxy) {
				// Redirect attachment to the parent Node
				// This will cause onAttachedToMeshObservable to fire again with null,
				// and then onAttachedToNodeObservable to fire with the node.
				gizmoManager.attachToNode(mesh.parent);
				return;
			}
			updatePropertyEditor(mesh);
			attachDragObservers();
		} else {
			// If we detached from mesh, check if we are attached to a node
			// If not, clear editor
			if (!gizmoManager.attachedNode) {
				updatePropertyEditor(null);
			}
		}
	});
	
	// Handle Node Attachment (for TransformNodes)
	gizmoManager.onAttachedToNodeObservable.add((node) => {
		if (node) {
			updatePropertyEditor(node);
			attachDragObservers();
		} else {
			if (!gizmoManager.attachedMesh) {
				updatePropertyEditor(null);
			}
		}
	});
}

// Function to switch gizmo modes
export function setGizmoMode(mode) {
	if (!gizmoManager) return;
	
	gizmoManager.positionGizmoEnabled = (mode === "position");
	gizmoManager.rotationGizmoEnabled = (mode === "rotation");
	gizmoManager.scaleGizmoEnabled = (mode === "scale");
	
	// Re-attach observers because new gizmos might have been created
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
			g.onDragEndObservable.add(() => markModified());
			g._hasObserver = true;
		}
	});
}

// Helper to manually select a mesh or node (used by TreeView)
export function selectMesh(target) {
	if (!gizmoManager) return;
	
	if (target instanceof TransformNode && target.getClassName() === "TransformNode") {
		gizmoManager.attachToNode(target);
	} else {
		gizmoManager.attachToMesh(target);
	}
}
