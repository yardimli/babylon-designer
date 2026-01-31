import { GizmoManager } from "@babylonjs/core";
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
	
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		console.log("Gizmo attached to mesh:", mesh ? mesh.name : "none");
		updatePropertyEditor(mesh);
		// Attach drag listeners to gizmos when they become active
		if (mesh) {
			attachDragObservers();
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

// Helper to manually select a mesh (used by TreeView)
export function selectMesh(mesh) {
	if (gizmoManager) {
		gizmoManager.attachToMesh(mesh);
	}
}
