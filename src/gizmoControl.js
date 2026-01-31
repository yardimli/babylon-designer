import { GizmoManager, PointerEventTypes } from "@babylonjs/core";
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
	
	// --- FIX START ---
	// Disable default pointer attachment. We will handle picking manually
	// so we can redirect clicks on "Proxies" to their parent "Nodes".
	gizmoManager.usePointerToAttachGizmos = false;
	gizmoManager.clearGizmoOnEmptyPointerEvent = false; // We handle this manually too
	
	// Custom Selection Logic
	scene.onPointerObservable.add((pointerInfo) => {
		if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
			// Only react to Left Click (button 0)
			if (pointerInfo.event.button !== 0) return;
			
			const pick = pointerInfo.pickInfo;
			
			if (pick.hit && pick.pickedMesh) {
				const mesh = pick.pickedMesh;
				
				// 1. Check if we clicked a TransformNode Proxy
				if (mesh.metadata && mesh.metadata.isTransformNodeProxy) {
					// Select the PARENT Node, not the proxy sphere
					const node = mesh.parent;
					if (node) {
						gizmoManager.attachToNode(node);
					}
				}
				// 2. Standard Mesh or Light Proxy
				else {
					// Light Proxies are actual meshes that control the light, so we select them directly.
					// Standard meshes are selected directly.
					gizmoManager.attachToMesh(mesh);
				}
			} else {
				// Clicked on empty space - Deselect
				gizmoManager.attachToMesh(null);
				gizmoManager.attachToNode(null);
				updatePropertyEditor(null);
			}
		}
	});
	// --- FIX END ---
	
	// Listener for Meshes (Lights, Primitives)
	gizmoManager.onAttachedToMeshObservable.add((mesh) => {
		if (mesh) {
			console.log("Gizmo attached to mesh:", mesh.name);
			updatePropertyEditor(mesh);
			attachDragObservers();
		}
	});
	
	// Listener for Nodes (TransformNodes)
	gizmoManager.onAttachedToNodeObservable.add((node) => {
		if (node) {
			console.log("Gizmo attached to node:", node.name);
			updatePropertyEditor(node);
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
export function selectMesh(target) {
	if (!gizmoManager) return;
	
	// Check if it's a Node or a Mesh
	if (target.getClassName() === "TransformNode" || (target.metadata && target.metadata.isTransformNode)) {
		gizmoManager.attachToNode(target);
	} else {
		gizmoManager.attachToMesh(target);
	}
}
