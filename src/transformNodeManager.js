import { TransformNode, MeshBuilder, StandardMaterial, Color3, Quaternion } from "@babylonjs/core";
import { gizmoManager } from "./gizmoControl.js";

export function createTransformNode(savedData = null, scene) {
	const id = savedData ? savedData.id : `node_${Date.now()}`;
	const node = new TransformNode(id, scene);
	
	if (savedData) {
		node.position.set(savedData.position.x, savedData.position.y, savedData.position.z);
		if (savedData.rotation) {
			node.rotationQuaternion = new Quaternion(
				savedData.rotation.x,
				savedData.rotation.y,
				savedData.rotation.z,
				savedData.rotation.w
			);
		}
		node.scaling.set(savedData.scaling.x, savedData.scaling.y, savedData.scaling.z);
		if (savedData.name) node.name = savedData.name;
	} else {
		node.position.y = 1;
	}
	
	// Create Proxy Mesh for selection
	const proxy = MeshBuilder.CreateBox(id + "_proxy", { size: 0.5 }, scene);
	proxy.parent = node;
	proxy.isPickable = true;
	
	// Proxy Material (Wireframe/Transparent)
	const mat = new StandardMaterial("transformNodeMat", scene);
	mat.emissiveColor = Color3.Purple();
	mat.alpha = 0.5;
	mat.wireframe = true;
	mat.disableLighting = true;
	proxy.material = mat;
	
	// Metadata
	proxy.metadata = {
		isTransformNodeProxy: true,
		nodeId: node.id
	};
	
	node.metadata = {
		isTransformNode: true,
		proxyId: proxy.id
	};
	
	// Auto-select if created new (not loading)
	if (!savedData && gizmoManager) {
		gizmoManager.attachToNode(node);
	}
	
	return node;
}
