import { PBRMaterial, Color3 } from "@babylonjs/core";
import { scene } from "./scene.js";
import { updatePropertyEditor } from "./scene_propertyEditor.js";

// Tracks which external files have been loaded into the scene
// Set<string> (filenames)
const loadedMaterialFiles = new Set();

export function setupMaterialManager() {
	const btnImport = document.getElementById("btn-import-mat");
	const modal = document.getElementById("import_mat_modal");
	const listContainer = document.getElementById("import-mat-list");
	
	if (btnImport) {
		btnImport.onclick = () => {
			refreshServerMaterialList(listContainer, modal);
			modal.showModal();
		};
	}
}

export function getLoadedMaterialFiles() {
	return Array.from(loadedMaterialFiles);
}

export function clearMaterialManager() {
	loadedMaterialFiles.clear();
}

// Called by sceneManager when loading a scene
export async function loadMaterialFile(filename) {
	if (loadedMaterialFiles.has(filename)) return; // Already loaded
	
	try {
		const res = await fetch(`/api/materials?file=${filename}`);
		const result = await res.json();
		
		if (result.success) {
			// Handle both legacy (single object) and new (array) formats
			const materials = Array.isArray(result.data) ? result.data : [result.data];
			
			materials.forEach(matData => {
				createMaterialFromData(matData, filename);
			});
			
			loadedMaterialFiles.add(filename);
			console.log(`Loaded library: ${filename} (${materials.length} materials)`);
		} else {
			console.warn(`Failed to load material file: ${filename}`);
		}
	} catch (e) {
		console.error(`Error fetching material ${filename}:`, e);
	}
}

function createMaterialFromData(data, filename) {
	// Use the material name as ID.
	// If a material with this name exists, we assume it's the same one or user wants to overwrite/use it.
	const matId = data.name;
	
	let mat = scene.getMaterialByID(matId);
	if (!mat) {
		mat = new PBRMaterial(data.name, scene);
		mat.id = matId;
	}
	
	// Update properties
	mat.albedoColor = new Color3(...data.albedo);
	mat.emissiveColor = new Color3(...data.emissive);
	mat.metallic = data.metallic;
	mat.roughness = data.roughness;
	mat.alpha = data.alpha;
	
	// Tag it so we know it came from a file
	mat.metadata = {
		...mat.metadata,
		isExternal: true,
		sourceFile: filename
	};
}

async function refreshServerMaterialList(container, modal) {
	container.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/materials');
		const data = await res.json();
		container.innerHTML = "";
		
		if (!data.files || data.files.length === 0) {
			container.innerHTML = "<p class='text-sm opacity-50'>No libraries found on server.</p>";
			return;
		}
		
		data.files.forEach(file => {
			const btn = document.createElement("button");
			btn.className = "btn btn-sm btn-ghost justify-start font-normal normal-case text-left w-full";
			
			// Check if already loaded
			if (loadedMaterialFiles.has(file)) {
				btn.innerHTML = `<span>${file}</span> <span class="badge badge-xs badge-success ml-auto">Loaded</span>`;
				btn.disabled = true;
			} else {
				btn.innerText = file;
				btn.onclick = async () => {
					await loadMaterialFile(file);
					modal.close();
					// Refresh property editor if something is selected to show new materials in dropdown
					const selected = scene.meshes.find(m => m.showBoundingBox);
					if (selected) updatePropertyEditor(selected);
				};
			}
			container.appendChild(btn);
		});
		
	} catch (e) {
		container.innerHTML = "<p class='text-error'>Connection failed.</p>";
	}
}
