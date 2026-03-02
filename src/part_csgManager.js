import { CSG, StandardMaterial, Color3, Matrix } from "@babylonjs/core";
import { part } from "./part.js";
import { setShadowCaster } from "./part_shadowManager.js";

let negativeMaterial = null;

// Creates and returns a special material used to visualize negative (subtraction) meshes
export function getNegativeMaterial(scene) {
	if (!negativeMaterial) {
		negativeMaterial = new StandardMaterial("negativeMat", scene);
		negativeMaterial.diffuseColor = new Color3(1, 0.2, 0.2);
		negativeMaterial.alpha = 0.1;
		negativeMaterial.specularColor = new Color3(0, 0, 0);
		// Prevent this internal material from being exported
		negativeMaterial.metadata = { isInternal: true };
	}
	return negativeMaterial;
}

// Recomputes Constructive Solid Geometry (CSG) for the entire scene
export function updateCSG() {
	if (!part) return;

	// 1. Clean up old CSG results
	const oldResults = part.meshes.filter(m => m.metadata && m.metadata.isCSGResult);
	oldResults.forEach(m => {
		setShadowCaster(m, false);
		m.dispose();
	});

	// 2. Group meshes by Parent (TransformNode) OR Root
	// Map<GroupID, { parent: Node|null, positives: [], negatives: [] }>
	const csgGroups = new Map();

	part.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape)) {

			// Reset visibility of positive meshes (will be hidden later if they participate in CSG)
			if (!m.metadata.isNegative && m.isEnabled()) {
				m.isVisible = true;
			}

			// Determine Group ID
			const parent = m.parent;
			let groupId = "root";
			let groupParent = null;

			// If mesh is child of a TransformNode, use that as group
			if (parent && parent.metadata && parent.metadata.isTransformNode) {
				groupId = parent.id;
				groupParent = parent;
			}

			// Init Group
			if (!csgGroups.has(groupId)) {
				csgGroups.set(groupId, {
					parent: groupParent,
					positives: [],
					negatives: []
				});
			}

			const group = csgGroups.get(groupId);

			if (m.metadata.isNegative) {
				if (m.isEnabled()) group.negatives.push(m);
			} else {
				if (m.isEnabled()) group.positives.push(m);
			}
		}
	});

	// 3. Perform CSG Subtractions per Group
	csgGroups.forEach(group => {
		if (group.negatives.length === 0 || group.positives.length === 0) return;

		// Calculate Inverse Parent Matrix to transform World Space CSG back to Local Space
		// If parent is null (root), transform is Identity
		let invertParentMatrix = Matrix.Identity();
		if (group.parent) {
			const parentMatrix = group.parent.computeWorldMatrix(true);
			invertParentMatrix = parentMatrix.clone().invert();
		}

		group.positives.forEach(pos => {
			let csgPos = null;
			let modified = false;

			// Ensure world matrix is up to date before CSG conversion
			pos.computeWorldMatrix(true);

			group.negatives.forEach(neg => {
				neg.computeWorldMatrix(true);
				// Fast pre-check using bounding boxes
				if (pos.intersectsMesh(neg, true)) {
					if (!csgPos) csgPos = CSG.FromMesh(pos);
					const csgNeg = CSG.FromMesh(neg);
					csgPos = csgPos.subtract(csgNeg);
					modified = true;
				}
			});

			if (modified) {
				// Create the result mesh
				// keepSubMeshes = false to inherit positive mesh material
				const resultMesh = csgPos.toMesh(pos.name + "_csg", pos.material, part, false);
				resultMesh.metadata = {
					isCSGResult: true,
					originalMeshId: pos.id
				};

				// Parent the result to the TransformNode (or null for root)
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