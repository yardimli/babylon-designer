import { PointLight, DirectionalLight, Vector3, Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";

export function createLight(type, scene) {
	let light;
	const id = `light_${Date.now()}`;
	
	if (type === "point") {
		light = new PointLight(id, new Vector3(0, 5, 0), scene);
		light.diffuse = new Color3(1, 1, 1);
	} else if (type === "directional") {
		light = new DirectionalLight(id, new Vector3(0, -1, 0.5), scene);
		light.position = new Vector3(0, 5, 0); // For gizmo visualization
	}
	
	if (light) {
		light.intensity = 1.0;
		
		// Create proxy mesh
		const proxy = MeshBuilder.CreateSphere(id + "_proxy", {diameter: 0.5}, scene);
		proxy.material = new StandardMaterial("lightMat", scene);
		proxy.material.emissiveColor = Color3.Yellow();
		proxy.position = light.position;
		
		// Store relationship in metadata so it survives serialization
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

// Helper to attach the behavior
function setupLightSync(proxy, light, scene) {
	// We use a unique observer wrapper to avoid adding duplicates if called multiple times
	if (proxy._lightObserver) {
		scene.onBeforeRenderObservable.remove(proxy._lightObserver);
	}
	
	proxy._lightObserver = scene.onBeforeRenderObservable.add(() => {
		light.position = proxy.position;
		if (light instanceof DirectionalLight) {
			light.direction = proxy.forward;
		}
	});
}

// Call this after loading a scene to reconnect proxies to lights
export function restoreLightProxies(scene) {
	scene.meshes.forEach(mesh => {
		if (mesh.metadata && mesh.metadata.isLightProxy && mesh.metadata.lightId) {
			const light = scene.getLightByID(mesh.metadata.lightId);
			if (light) {
				setupLightSync(mesh, light, scene);
			}
		}
	});
}
