import { CSG, StandardMaterial, Color3 } from "@babylonjs/core";
import { scene } from "./assembly_scene.js";
import { setShadowCaster } from "./assembly_shadowManager.js";

let negativeMaterial = null;

// Creates and returns a special material used to visualize negative (subtraction) meshes
export function getNegativeMaterial(scene) {
	if (!negativeMaterial) {
		negativeMaterial = new StandardMaterial("negativeMat", scene);
		negativeMaterial.diffuseColor = new Color3(1, 0.2, 0.2);
		negativeMaterial.alpha = 0.4;
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

	// 2. Identify positive and negative meshes
	const positives = [];
	const negatives =[];

	scene.meshes.forEach(m => {
		if (m.metadata && (m.metadata.isPrimitive || m.metadata.isShape)) {
			if (m.metadata.isNegative) {
				if (m.isEnabled()) negatives.push(m);
			} else {
				if (m.isEnabled()) {
					positives.push(m);
					m.isVisible = true; // Restore visibility of positive meshes
				}
			}
		}
	});

	if (negatives.length === 0) return;

	// 3. Perform CSG Subtractions
	positives.forEach(pos => {
		let csgPos = null;
		let modified = false;

		// Ensure world matrix is up to date before CSG conversion
		pos.computeWorldMatrix(true);

		negatives.forEach(neg => {
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

			// Match shadow properties of the original mesh
			resultMesh.receiveShadows = pos.receiveShadows;
			if (pos.metadata && pos.metadata.castShadows) {
				setShadowCaster(resultMesh, true);
			}

			// Hide the original positive mesh so only the CSG result is visible
			pos.isVisible = false;
		}
	});
}