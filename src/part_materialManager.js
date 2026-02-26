import { StandardMaterial, Color3, Texture } from "@babylonjs/core";
import { part } from "./part.js";
import { updatePropertyEditor } from "./part_propertyEditor.js";

// Tracks which external files have been loaded into the part
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

// Called by partManager when loading a part
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
	const matId = data.name;

	let mat = part.getMaterialByID(matId);
	if (!mat) {
		mat = new StandardMaterial(data.name, part);
		mat.id = matId;
	}

	// Clean up old textures
	if (mat.diffuseTexture) mat.diffuseTexture.dispose();
	if (mat.bumpTexture) mat.bumpTexture.dispose();
	mat.diffuseTexture = null;
	mat.bumpTexture = null;

	// Fallbacks included for legacy PBR files
	mat.diffuseColor = new Color3(...(data.diffuse || data.albedo || [1, 1, 1]));
	mat.specularColor = new Color3(...(data.specular || [1, 1, 1]));
	mat.emissiveColor = new Color3(...(data.emissive || [0, 0, 0]));
	mat.ambientColor = new Color3(...(data.ambient || [0, 0, 0]));

	mat.alpha = data.alpha !== undefined ? data.alpha : 1.0;
	mat.specularPower = data.specularPower !== undefined ? data.specularPower : 128;

	// Diffuse Texture (Legacy fallback to texturePath)
	const diffTexPath = data.diffuseTexture || data.texturePath;
	if (diffTexPath) {
		mat.diffuseTexture = new Texture(diffTexPath, part);
	}

	// Bump Texture & Parallax
	if (data.bumpTexture) {
		mat.bumpTexture = new Texture(data.bumpTexture, part);
		mat.bumpTexture.level = data.bumpLevel !== undefined ? data.bumpLevel : 1.0;
		mat.useParallax = !!data.useParallax;
		mat.useParallaxOcclusion = !!data.useParallaxOcclusion;
		mat.parallaxScaleBias = data.parallaxScaleBias !== undefined ? data.parallaxScaleBias : 0.05;
	}

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
					const selected = part.meshes.find(m => m.showBoundingBox);
					if (selected) updatePropertyEditor(selected);
				};
			}
			container.appendChild(btn);
		});

	} catch (e) {
		container.innerHTML = "<p class='text-error'>Connection failed.</p>";
	}
}