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
	
	gizmoManager.positionGizmoEnabled = true;
	gizmoManager.rotationGizmoEnabled = true;
	gizmoManager.scaleGizmoEnabled = true;
	gizmoManager.boundingBoxGizmoEnabled = false;
	
	gizmoManager.usePointerToAttachGizmos = true;
	gizmoManager.clearGizmoOnEmptyPointerEvent = true;
	
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		updatePropertyEditor(mesh);
		
		// Attach drag listeners to gizmos when they become active
		if (mesh) {
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
	});
}
