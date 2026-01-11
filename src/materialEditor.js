import { Engine, Scene, Vector3, Color3, PBRMaterial, MeshBuilder, HemisphericLight } from "@babylonjs/core";
import { scene } from "./scene.js";
import { updatePropertyEditor } from "./propertyEditor.js";

let previewEngine, previewScene, previewSphere, previewMaterial;

export function setupMaterialEditor() {
	const btnOpen = document.getElementById("btn-open-mat-editor");
	const modal = document.getElementById("material_modal");
	const btnCreate = document.getElementById("btn-create-material");
	
	initPreview();
	
	btnOpen.onclick = () => {
		modal.showModal();
		previewEngine.resize();
	};
	
	// Live Update Preview
	const inputs = ["mat-albedo", "mat-emissive", "mat-metallic", "mat-roughness", "mat-alpha"];
	inputs.forEach(id => {
		document.getElementById(id).addEventListener("input", updatePreviewMaterial);
	});
	
	btnCreate.onclick = (e) => {
		e.preventDefault(); // prevent form submit closing modal immediately
		createMaterialInScene();
		modal.close();
	};
}

function initPreview() {
	const canvas = document.getElementById("materialPreviewCanvas");
	previewEngine = new Engine(canvas, true);
	previewScene = new Scene(previewEngine);
	previewScene.createDefaultCameraOrLight(true, true, true);
	
	// Better lighting for PBR
	const light = new HemisphericLight("light", new Vector3(0, 1, 0), previewScene);
	
	previewSphere = MeshBuilder.CreateSphere("previewSphere", {diameter: 2}, previewScene);
	previewMaterial = new PBRMaterial("previewMat", previewScene);
	previewSphere.material = previewMaterial;
	
	previewEngine.runRenderLoop(() => {
		previewScene.render();
	});
}

function updatePreviewMaterial() {
	const albedo = document.getElementById("mat-albedo").value;
	const emissive = document.getElementById("mat-emissive").value;
	const metallic = parseFloat(document.getElementById("mat-metallic").value);
	const roughness = parseFloat(document.getElementById("mat-roughness").value);
	const alpha = parseFloat(document.getElementById("mat-alpha").value);
	
	previewMaterial.albedoColor = Color3.FromHexString(albedo);
	previewMaterial.emissiveColor = Color3.FromHexString(emissive);
	previewMaterial.metallic = metallic;
	previewMaterial.roughness = roughness;
	previewMaterial.alpha = alpha;
}

function createMaterialInScene() {
	const name = document.getElementById("mat-name").value;
	
	// Check if exists or create new
	let mat = scene.getMaterialByName(name);
	if(!mat) {
		mat = new PBRMaterial(name, scene);
	}
	
	mat.albedoColor = previewMaterial.albedoColor;
	mat.emissiveColor = previewMaterial.emissiveColor;
	mat.metallic = previewMaterial.metallic;
	mat.roughness = previewMaterial.roughness;
	mat.alpha = previewMaterial.alpha;
	
	// Refresh Property Editor Dropdown if a mesh is selected
	const selected = scene.meshes.find(m => m.showBoundingBox); // A bit hacky, better to use gizmo state
	if(selected) updatePropertyEditor(selected);
}
