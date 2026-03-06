import { CSG, StandardMaterial, Color3, Matrix } from "@babylonjs/core";
import { scene } from "./assembly_scene.js";
import { setShadowCaster } from "./assembly_shadowManager.js";

let negativeMaterial = null;

// Creates and returns a special material used to visualize negative (subtraction) meshes
export function getNegativeMaterial(scene) {
	if (!negativeMaterial) {
		negativeMaterial = new StandardMaterial("negativeMat", scene);
		negativeMaterial.diffuseColor = new Color3(1, 0.2, 0.2);
		negativeMaterial.alpha = 0; //full transparent
		negativeMaterial.specularColor = new Color3(0, 0, 0);
		// Prevent this internal material from being exported
		negativeMaterial.metadata = { isInternal: true };
	}
	return negativeMaterial;
}

// Recomputes Constructive Solid Geometry (CSG) for the entire assembly scene
export function updateCSG() {
	if (!scene) return;

	// 1. Clean up old CSG results
	const oldResults = scene.meshes.filter(m => m.metadata && m.metadata.isCSGResult);
	oldResults.forEach(m => {
		setShadowCaster(m, false);
		m.dispose();
	});

	// 2. Group meshes by Parent (TransformNode or Assembly Root)
	// Map<ParentID, { parent: Node, positives: [], negatives: [] }>
	const csgGroups = new Map();

	scene.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape)) {

			// Restore visibility of positive meshes (will be hidden later if they participate in CSG)
			if (!m.metadata.isNegative && m.isEnabled()) {
				m.isVisible = true;
			}

			// Check if mesh belongs to a Parent (Part Root or TransformNode)
			// In Assembly, parts are always parented to a root node.
			const parent = m.parent;
			if (parent) {
				if (!csgGroups.has(parent.id)) {
					csgGroups.set(parent.id, {
						parent: parent,
						positives: [],
						negatives: []
					});
				}

				const group = csgGroups.get(parent.id);

				if (m.metadata.isNegative) {
					if (m.isEnabled()) group.negatives.push(m);
				} else {
					if (m.isEnabled()) group.positives.push(m);
				}
			}
		}
	});

	// 3. Perform CSG Subtractions per Group
	csgGroups.forEach(group => {
		if (group.negatives.length === 0 || group.positives.length === 0) return;

		// Calculate Inverse Parent Matrix to transform World Space CSG back to Local Space
		// This is crucial in Assembly because parts are rotated/moved in the scene.
		const parentMatrix = group.parent.computeWorldMatrix(true);
		const invertParentMatrix = parentMatrix.clone().invert();

		group.positives.forEach(pos => {
			let csgPos = null;
			let modified = false;

			// Ensure world matrix is up to date before CSG conversion
			pos.computeWorldMatrix(true);

			group.negatives.forEach(neg => {
				neg.computeWorldMatrix(true);
				// Fast pre-check using bounding boxes
				if (pos.intersectsMesh(neg, true)) {
					try {
						if (!csgPos) csgPos = CSG.FromMesh(pos);
						const csgNeg = CSG.FromMesh(neg);
						csgPos = csgPos.subtract(csgNeg);
						modified = true;
					} catch (e) {
						console.warn("CSG failed for meshes", pos.name, neg.name, e);
					}
				}
			});

			if (modified && csgPos) {
				// Create the result mesh (keepSubMeshes = false to inherit positive mesh material)
				const resultMesh = csgPos.toMesh(pos.name + "_csg", pos.material, scene, false);
				resultMesh.metadata = {
					isCSGResult: true,
					originalMeshId: pos.id,
					isInternal: true // Keep it hidden from tree in assembly
				};

				// Parent the result to the group parent
				resultMesh.parent = group.parent;

				// Match shadow properties of the original mesh
				resultMesh.receiveShadows = pos.receiveShadows;
				if (pos.metadata && pos.metadata.castShadows) {
					setShadowCaster(resultMesh, true);
				}

				// Hide the original positive mesh so only the CSG result is visible
				pos.isVisible = false;
			}
		});
	});
}
