import { PointLight, DirectionalLight, Vector3, Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { createShadowGenerator } from "./shadowManager.js";
import { getUniqueId } from "./scene.js";

export function createLight(type, savedData = null, scene) {
	let light;
	const baseId = savedData ? savedData.id : `light_${Date.now()}`;
	// Ensure ID is unique
	const id = getUniqueId(scene, baseId);
	
	if (type === "point") {
		light = new PointLight(id, new Vector3(0, 5, 0), scene);
	} else if (type === "directional") {
		light = new DirectionalLight(id, new Vector3(0, -1, 0.5), scene);
	}
	
	if (light) {
		if (savedData) {
			light.position = new Vector3(savedData.position.x, savedData.position.y, savedData.position.z);
			light.intensity = savedData.intensity;
			light.diffuse = new Color3(savedData.diffuse.r, savedData.diffuse.g, savedData.diffuse.b);
			if (type === "directional" && savedData.direction) {
				light.direction = new Vector3(savedData.direction.x, savedData.direction.y, savedData.direction.z);
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
		
		if (type === "directional") {
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
		// If light and proxy share the same parent, local sync is sufficient.
		// If proxy is parented but light is not (should not happen with updated propertyEditor),
		// we might want to sync absolute position, but BabylonJS handles hierarchy best if structure matches.
		light.position = proxy.position;
		
		if (light instanceof DirectionalLight) {
			// Directional Light direction is defined in World Space usually,
			// but if parented, it becomes relative to parent.
			// Proxy forward is World Space direction.
			
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
