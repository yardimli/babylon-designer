import { ShadowGenerator } from "@babylonjs/core";
import { scene } from "./scene.js";

// Store active generators to easily add meshes to all lights
const shadowGenerators = [];

/**
 * Creates a ShadowGenerator for a specific light.
 * @param {Light} light - The BabylonJS light object.
 */
export function createShadowGenerator(light) {
	// ShadowGenerator requires a size (1024) and the light source
	const sg = new ShadowGenerator(1024, light);
	
	// Make shadows look smoother
	sg.useBlurExponentialShadowMap = true;
	sg.blurKernel = 32;
	
	// 0 is PointLight
	if (light.getTypeID() === 0) {
		// Fix: Point lights need a smaller minZ to cast shadows from close objects
		// and a defined maxZ to ensure the depth map resolution is utilized correctly.
		light.shadowMinZ = 0.1;
		light.shadowMaxZ = 100;
	}
	
	// 1 is DirectionalLight
	if (light.getTypeID() === 1) {
		// Fix: Automatically calculate the shadow projection bounds.
		// This ensures that when the directional light (and its proxy) is moved,
		// the shadow frustum updates to include the meshes in the scene.
		// Without this, moving the light might cause meshes to fall out of the shadow projection.
		light.autoCalcShadowZBounds = true;
	}
	
	// Store reference on the light for easy disposal later
	light._shadowGenerator = sg;
	shadowGenerators.push(sg);
	
	// Add existing meshes that are marked as shadow casters
	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.castShadows) {
			sg.addShadowCaster(mesh, true);
		}
	});
	
	return sg;
}

/**
 * Disposes the ShadowGenerator associated with a light.
 * @param {Light} light - The BabylonJS light object.
 */
export function disposeShadowGenerator(light) {
	if (light._shadowGenerator) {
		const index = shadowGenerators.indexOf(light._shadowGenerator);
		if (index > -1) {
			shadowGenerators.splice(index, 1);
		}
		light._shadowGenerator.dispose();
		light._shadowGenerator = null;
	}
}

/**
 * Registers or unregisters a mesh as a shadow caster for ALL active lights.
 * @param {Mesh} mesh - The mesh to update.
 * @param {boolean} shouldCast - True to cast shadows, false to stop.
 */
export function setShadowCaster(mesh, shouldCast) {
	// Ensure metadata exists and is updated
	if (!mesh.metadata) mesh.metadata = {};
	mesh.metadata.castShadows = shouldCast;
	
	shadowGenerators.forEach(sg => {
		if (shouldCast) {
			// Second argument 'true' includes children
			sg.addShadowCaster(mesh, true);
		} else {
			sg.removeShadowCaster(mesh, true);
		}
	});
}

/**
 * Clears all internal references (used when clearing scene).
 */
export function clearShadowManagers() {
	shadowGenerators.length = 0;
}
