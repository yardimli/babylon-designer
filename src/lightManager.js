import { PointLight, DirectionalLight, Vector3, Color3 } from "@babylonjs/core";

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
		// Add a small mesh to represent the light so we can select it with Gizmos
		// (Babylon lights aren't meshes, so we attach a proxy mesh)
		// For simplicity in this demo, we treat lights as nodes, but GizmoManager prefers Meshes.
		// We will attach a dummy sphere to the light for selection.
		const proxy = BABYLON.MeshBuilder.CreateSphere(id + "_proxy", {diameter: 0.5}, scene);
		proxy.material = new BABYLON.StandardMaterial("lightMat", scene);
		proxy.material.emissiveColor = Color3.Yellow();
		proxy.position = light.position;
		proxy.isLightProxy = true;
		proxy.linkedLight = light;
		
		// Sync light position to proxy
		scene.onBeforeRenderObservable.add(() => {
			light.position = proxy.position;
			if(type === "directional") {
				light.direction = proxy.forward; // Simplified direction control
			}
		});
		
		return proxy;
	}
	return null;
}
