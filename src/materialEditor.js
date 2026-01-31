import { Engine, Scene, Vector3, Color3, PBRMaterial, MeshBuilder, HemisphericLight } from "@babylonjs/core";
import {getSkipMaterialNames, scene} from "./scene.js";
import { updatePropertyEditor } from "./propertyEditor.js";

let previewEngine, previewScene, previewSphere, previewMaterial;

export function setupMaterialEditor() {
	const btnOpen = document.getElementById("btn-open-mat-editor");
	const modal = document.getElementById("material_modal");
	const btnCreate = document.getElementById("btn-create-material");
	const btnNew = document.getElementById("btn-new-material");
	
	initPreview();
	
	btnOpen.onclick = () => {
		refreshMaterialList();
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
	
	// New Material Button Logic
	if (btnNew) {
		btnNew.onclick = (e) => {
			e.preventDefault();
			resetEditor();
		};
	}
}

function initPreview() {
	const canvas = document.getElementById("materialPreviewCanvas");
	previewEngine = new Engine(canvas, true);
	previewScene = new Scene(previewEngine);
	previewScene.createDefaultCameraOrLight(true, true, true);
	
	// Better lighting for PBR
	const light = new HemisphericLight("light", new Vector3(0, 1, 0), previewScene);
	
	previewSphere = MeshBuilder.CreateSphere("previewSphere", { diameter: 2 }, previewScene);
	previewMaterial = new PBRMaterial("previewMat", previewScene);
	previewSphere.material = previewMaterial;
	
	previewEngine.runRenderLoop(() => {
		previewScene.render();
	});
}

function refreshMaterialList() {
	const listContainer = document.getElementById("material-list");
	if (!listContainer) return;
	
	listContainer.innerHTML = "";
	
	const skipNames = getSkipMaterialNames();
	
	// Filter out internal materials
	const materials = scene.materials.filter(m =>
		m.name !== "default material" &&
		m.name !== "lightMat" &&
		!m.name.startsWith("preview") &&
		!m.name.startsWith("gizmo") &&
		!skipNames.includes(m.name)
	);
	
	if (materials.length === 0) {
		listContainer.innerHTML = "<div class='text-xs opacity-50 p-2'>No custom materials</div>";
		return;
	}
	console.log(getSkipMaterialNames());
	
	materials.forEach(mat => {
		console.log(mat.name);
		const btn = document.createElement("button");
		btn.className = "btn btn-sm btn-ghost justify-start font-normal normal-case text-left w-full truncate";
		btn.innerHTML = `<span class="w-3 h-3 rounded-full mr-2 inline-block border border-base-content/20" style="background-color: ${mat.albedoColor.toHexString()}"></span>${mat.name}`;
		
		btn.onclick = (e) => {
			e.preventDefault();
			loadMaterialIntoEditor(mat);
			
			// Visual feedback for selection
			Array.from(listContainer.children).forEach(c => c.classList.remove("btn-active"));
			btn.classList.add("btn-active");
		};
		
		listContainer.appendChild(btn);
	});
}

function loadMaterialIntoEditor(sourceMat) {
	// 1. Update DOM Inputs
	document.getElementById("mat-name").value = sourceMat.name;
	document.getElementById("mat-albedo").value = sourceMat.albedoColor.toHexString();
	document.getElementById("mat-emissive").value = sourceMat.emissiveColor.toHexString();
	document.getElementById("mat-metallic").value = sourceMat.metallic || 0;
	document.getElementById("mat-roughness").value = sourceMat.roughness || 1;
	document.getElementById("mat-alpha").value = sourceMat.alpha || 1;
	
	// 2. Update Preview Material
	updatePreviewMaterial();
}

function resetEditor() {
	// Reset DOM Inputs to defaults
	document.getElementById("mat-name").value = "New Material";
	document.getElementById("mat-albedo").value = "#ffffff";
	document.getElementById("mat-emissive").value = "#000000";
	document.getElementById("mat-metallic").value = 0;
	document.getElementById("mat-roughness").value = 1;
	document.getElementById("mat-alpha").value = 1;
	
	// Clear selection in list
	const listContainer = document.getElementById("material-list");
	if (listContainer) {
		Array.from(listContainer.children).forEach(c => c.classList.remove("btn-active"));
	}
	
	// Update Preview
	updatePreviewMaterial();
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
	if (!mat) {
		mat = new PBRMaterial(name, scene);
	}
	
	mat.albedoColor = previewMaterial.albedoColor;
	mat.emissiveColor = previewMaterial.emissiveColor;
	mat.metallic = previewMaterial.metallic;
	mat.roughness = previewMaterial.roughness;
	mat.alpha = previewMaterial.alpha;
	
	// Refresh Property Editor Dropdown if a mesh is selected
	const selected = scene.meshes.find(m => m.showBoundingBox); // A bit hacky, better to use gizmo state
	if (selected) updatePropertyEditor(selected);
}
