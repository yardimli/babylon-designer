import { PointLight, DirectionalLight, Vector3, Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { createShadowGenerator } from "./shadowManager.js"; // Import new manager

export function createLight(type, savedData = null, scene) {
	let light;
	// Use saved ID or generate new
	const id = savedData ? savedData.id : `light_${Date.now()}`;
	
	// 1. Create the Babylon Light
	if (type === "point") {
		light = new PointLight(id, new Vector3(0, 5, 0), scene);
	} else if (type === "directional") {
		light = new DirectionalLight(id, new Vector3(0, -1, 0.5), scene);
	}
	
	if (light) {
		// 2. Apply Properties
		if (savedData) {
			light.position = new Vector3(savedData.position.x, savedData.position.y, savedData.position.z);
			light.intensity = savedData.intensity;
			light.diffuse = new Color3(savedData.diffuse.r, savedData.diffuse.g, savedData.diffuse.b);
			if (type === "directional" && savedData.direction) {
				light.direction = new Vector3(savedData.direction.x, savedData.direction.y, savedData.direction.z);
			}
		} else {
			// Defaults
			light.intensity = 1.0;
			light.diffuse = new Color3(1, 1, 1);
			light.position = new Vector3(0, 5, 0);
		}
		
		// --- NEW: Initialize Shadows ---
		createShadowGenerator(light);
		// -------------------------------
		
		// 3. Create Proxy Mesh for Gizmo Selection
		const proxy = MeshBuilder.CreateSphere(id + "_proxy", { diameter: 0.5 }, scene);
		proxy.material = new StandardMaterial("lightMat", scene);
		proxy.material.emissiveColor = Color3.Yellow();
		proxy.position = light.position; // Sync initial position
		
		// Metadata for Save/Load
		proxy.metadata = {
			isLightProxy: true,
			lightId: light.id,
			lightType: type
		};
		
		// 4. Sync Logic
		setupLightSync(proxy, light, scene);
		
		return proxy;
	}
	return null;
}

function setupLightSync(proxy, light, scene) {
	if (proxy._lightObserver) scene.onBeforeRenderObservable.remove(proxy._lightObserver);
	
	proxy._lightObserver = scene.onBeforeRenderObservable.add(() => {
		light.position = proxy.position;
		if (light instanceof DirectionalLight) {
			light.direction = proxy.forward;
		}
	});
}

// Helper to reconnect after load if needed (though createLight handles it now)
export function restoreLightProxies(scene) {
	// Not strictly needed if we use createLight during load,
	// but good for safety if logic changes.
}
