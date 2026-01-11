import { GizmoManager } from "@babylonjs/core";
import { updatePropertyEditor } from "./propertyEditor.js";
import { markModified } from "./sceneManager.js"; // Import

export let gizmoManager;

export function setupGizmos(scene) {
	gizmoManager = new GizmoManager(scene);
	
	// Enable all gizmos
	gizmoManager.positionGizmoEnabled = true;
	gizmoManager.rotationGizmoEnabled = true;
	gizmoManager.scaleGizmoEnabled = true;
	gizmoManager.boundingBoxGizmoEnabled = false;
	
	// Use pointer to attach
	gizmoManager.usePointerToAttachGizmos = true;
	gizmoManager.clearGizmoOnEmptyPointerEvent = true;
	
	// Event: When a mesh is selected/deselected
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		updatePropertyEditor(mesh);
	});
	
	// Detect changes via Gizmos to mark scene as modified
	const attachDragListener = (gizmo) => {
		if (gizmo) {
			gizmo.onDragEndObservable.add(() => {
				markModified();
			});
		}
	};
	
	// We need to attach listeners to the gizmos themselves.
	// GizmoManager creates them lazily or keeps them available.
	// A robust way in Babylon is to check when they are created/enabled.
	// However, GizmoManager exposes the specific gizmos directly.
	
	// Note: These might be null if not yet created by the manager,
	// but setting '...Enabled = true' usually initializes them.
	if(gizmoManager.gizmos.positionGizmo) attachDragListener(gizmoManager.gizmos.positionGizmo);
	if(gizmoManager.gizmos.rotationGizmo) attachDragListener(gizmoManager.gizmos.rotationGizmo);
	if(gizmoManager.gizmos.scaleGizmo) attachDragListener(gizmoManager.gizmos.scaleGizmo);
	
	// Also, since GizmoManager wraps internal gizmos, we can listen to the manager's DragEnd if available?
	// Not directly. The safest generic way for GizmoManager is to observe the scene for transform changes
	// on the selected mesh, but we already do that in PropertyEditor.
	// However, we need to set 'isModified' specifically.
	
	// Alternative: Re-attach whenever a mesh is attached
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		if(mesh) {
			// Ensure the gizmos have the listener
			[gizmoManager.gizmos.positionGizmo, gizmoManager.gizmos.rotationGizmo, gizmoManager.gizmos.scaleGizmo].forEach(g => {
				if(g && !g._hasObserver) {
					g.onDragEndObservable.add(() => markModified());
					g._hasObserver = true; // Hack to prevent double add
				}
			});
		}
	});
}
