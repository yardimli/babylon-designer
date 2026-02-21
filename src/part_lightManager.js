import { PointLight, SpotLight, Vector3, Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core"; // Changed: Imported SpotLight
import { createShadowGenerator } from "./part_shadowManager.js";
import { getUniqueId } from "./part.js";

export function createLight(type, savedData = null, scene) {
	let light;
	const baseId = savedData ? savedData.id : `light_${Date.now()}`;
	// Ensure ID is unique
	const id = getUniqueId(scene, baseId);

	if (type === "point") {
		light = new PointLight(id, new Vector3(0, 5, 0), scene);
	} else if (type === "spot") { // Changed: Handle Spot Light
		// Default angle 60 degrees (Math.PI / 3), exponent 2
		light = new SpotLight(id, new Vector3(0, 5, 0), new Vector3(0, -1, 0.5), Math.PI / 3, 2, scene);
	}

	if (light) {
		if (savedData) {
			light.position = new Vector3(savedData.position.x, savedData.position.y, savedData.position.z);
			light.intensity = savedData.intensity;
			light.diffuse = new Color3(savedData.diffuse.r, savedData.diffuse.g, savedData.diffuse.b);
			if (type === "spot" && savedData.direction) { // Changed: Restore Spot Light properties
				light.direction = new Vector3(savedData.direction.x, savedData.direction.y, savedData.direction.z);
				if (savedData.angle !== undefined) light.angle = savedData.angle;
				if (savedData.exponent !== undefined) light.exponent = savedData.exponent;
			}
			// Restore visibility if saved
			if (savedData.visible !== undefined) {
				light.setEnabled(savedData.visible);
			}
		} else {
			light.intensity = 0.5;
			light.diffuse = new Color3(1, 1, 1);
			light.position = new Vector3(0, 5, 0);
		}

		createShadowGenerator(light);

		// Create Proxy Mesh for Gizmo Selection
		const proxy = MeshBuilder.CreateSphere(id + "_proxy", { diameter: 0.5 }, scene);
		proxy.material = new StandardMaterial("lightMat", scene);
		proxy.material.emissiveColor = Color3.Yellow();
		proxy.position = light.position; // Sync initial position

		// Sync initial visibility
		proxy.setEnabled(light.isEnabled());

		if (type === "spot") { // Changed: Look at direction for Spot Light
			const target = proxy.position.add(light.direction);
			proxy.lookAt(target);
		}

		proxy.metadata = {
			isLightProxy: true,
			lightId: light.id,
			lightType: type
		};

		setupLightSync(proxy, light, scene);

		return proxy;
	}
	return null;
}

function setupLightSync(proxy, light, scene) {
	if (proxy._lightObserver) scene.onBeforeRenderObservable.remove(proxy._lightObserver);

	proxy._lightObserver = scene.onBeforeRenderObservable.add(() => {
		// Sync Position
		light.position = proxy.position;

		// Sync Enabled State (Visibility)
		if (light.isEnabled() !== proxy.isEnabled()) {
			light.setEnabled(proxy.isEnabled());
		}

		if (light instanceof SpotLight) { // Changed: Sync Spot Light direction
			if (light.parent) {
				// Transform World Forward to Local Space
				const parentWorldMatrix = light.parent.getWorldMatrix();
				const invertParentWorld = parentWorldMatrix.clone().invert();

				// TransformNormal ignores translation, which is what we want for direction
				const localDir = Vector3.TransformNormal(proxy.forward, invertParentWorld);
				light.direction = localDir;
			} else {
				light.direction = proxy.forward;
			}
		}
	});
}

export function restoreLightProxies(scene) {
	// Not strictly needed if we use createLight during load
}