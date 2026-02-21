import { Engine, Scene, Vector3, Color3, StandardMaterial, MeshBuilder, HemisphericLight, ArcRotateCamera, Texture } from '@babylonjs/core';

const canvas = document.getElementById('previewCanvas');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
let previewMaterial;

// NEW: Store shapes for preview switching
const previewShapes = {};

// State
let currentFilename = null;
let currentLibrary = []; // Array of material data objects
let selectedIndex = -1;

// UI Elements
const ui = {
	fileList: document.getElementById('file-list'),
	matList: document.getElementById('mat-list'),
	inpFilename: document.getElementById('inp-filename'),
	shapeSelector: document.getElementById('preview-shape'), // NEW

	// Material Inputs
	name: document.getElementById('mat-name'),

	// Colors
	diffuse: document.getElementById('mat-diffuse'),
	specular: document.getElementById('mat-specular'),
	emissive: document.getElementById('mat-emissive'),
	ambient: document.getElementById('mat-ambient'),

	// Sliders
	alpha: document.getElementById('mat-alpha'),
	specularPower: document.getElementById('mat-specular-power'),
	bumpLevel: document.getElementById('mat-bump-level'),
	parallaxBias: document.getElementById('mat-parallax-bias'),

	// Labels
	lAlpha: document.getElementById('val-alpha'),
	lSpecularPower: document.getElementById('val-specular-power'),
	lBumpLevel: document.getElementById('val-bump-level'),
	lParallaxBias: document.getElementById('val-parallax-bias'),

	// Textures
	diffuseFile: document.getElementById('mat-diffuse-file'),
	diffusePath: document.getElementById('mat-diffuse-path'),
	btnClearDiffuse: document.getElementById('btn-clear-diffuse'),

	bumpFile: document.getElementById('mat-bump-file'),
	bumpPath: document.getElementById('mat-bump-path'),
	btnClearBump: document.getElementById('btn-clear-bump'),

	// Checkboxes
	useParallax: document.getElementById('mat-use-parallax'),
	useParallaxOcclusion: document.getElementById('mat-use-parallax-occlusion'),

	// Buttons
	btnRefresh: document.getElementById('btn-refresh-files'),
	btnNewLib: document.getElementById('btn-new-lib'),
	btnAddMat: document.getElementById('btn-add-mat'),
	btnSaveLib: document.getElementById('btn-save-lib'),
	btnDeleteMat: document.getElementById('btn-delete-mat'),

	status: document.getElementById('status-msg')
};

function initScene () {
	scene.clearColor = new Color3(0.1, 0.1, 0.1);

	const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 3, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;

	const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
	light.intensity = 1.0;

	previewMaterial = new StandardMaterial('previewMat', scene);

	// NEW: Create multiple shapes for previewing
	previewShapes.sphere = MeshBuilder.CreateSphere('sphere', { diameter: 1.5, segments: 32 }, scene);
	previewShapes.box = MeshBuilder.CreateBox('box', { size: 1.2 }, scene);
	previewShapes.cylinder = MeshBuilder.CreateCylinder('cylinder', { height: 1.5, diameter: 1.2 }, scene);

	Object.values(previewShapes).forEach(shape => {
		shape.material = previewMaterial;
		shape.isVisible = false;
	});

	// Default to sphere
	previewShapes.sphere.isVisible = true;

	engine.runRenderLoop(() => scene.render());
	window.addEventListener('resize', () => engine.resize());
}

// --- Logic ---

// MODIFIED: Updated default data structure for StandardMaterial
function createDefaultMaterialData (name) {
	return {
		name: name || 'New Material',
		diffuse: [1, 1, 1],
		specular: [1, 1, 1],
		emissive: [0, 0, 0],
		ambient: [0, 0, 0],
		alpha: 1.0,
		specularPower: 128,
		diffuseTexture: null,
		bumpTexture: null,
		bumpLevel: 1.0,
		useParallax: false,
		useParallaxOcclusion: false,
		parallaxScaleBias: 0.05
	};
}

// MODIFIED: Apply StandardMaterial properties
function updatePreviewFromData (data) {
	if (!data) return;

	previewMaterial.diffuseColor = new Color3(...data.diffuse);
	previewMaterial.specularColor = new Color3(...data.specular);
	previewMaterial.emissiveColor = new Color3(...data.emissive);
	previewMaterial.ambientColor = new Color3(...data.ambient);

	previewMaterial.alpha = data.alpha;
	previewMaterial.specularPower = data.specularPower;

	// Handle Diffuse Texture
	if (data.diffuseTexture) {
		if (!previewMaterial.diffuseTexture || previewMaterial.diffuseTexture.name !== data.diffuseTexture) {
			if (previewMaterial.diffuseTexture) previewMaterial.diffuseTexture.dispose();
			previewMaterial.diffuseTexture = new Texture(data.diffuseTexture, scene);
		}
	} else {
		if (previewMaterial.diffuseTexture) previewMaterial.diffuseTexture.dispose();
		previewMaterial.diffuseTexture = null;
	}

	// Handle Bump Texture & Parallax
	if (data.bumpTexture) {
		if (!previewMaterial.bumpTexture || previewMaterial.bumpTexture.name !== data.bumpTexture) {
			if (previewMaterial.bumpTexture) previewMaterial.bumpTexture.dispose();
			previewMaterial.bumpTexture = new Texture(data.bumpTexture, scene);
		}
		previewMaterial.bumpTexture.level = data.bumpLevel;
		previewMaterial.useParallax = data.useParallax;
		previewMaterial.useParallaxOcclusion = data.useParallaxOcclusion;
		previewMaterial.parallaxScaleBias = data.parallaxScaleBias;
	} else {
		if (previewMaterial.bumpTexture) previewMaterial.bumpTexture.dispose();
		previewMaterial.bumpTexture = null;
	}
}

// MODIFIED: Sync UI to new data structure
function updateUIFromData (data) {
	if (!data) {
		ui.name.value = '';
		return;
	}
	ui.name.value = data.name;

	// Colors
	ui.diffuse.value = new Color3(...data.diffuse).toHexString();
	ui.specular.value = new Color3(...data.specular).toHexString();
	ui.emissive.value = new Color3(...data.emissive).toHexString();
	ui.ambient.value = new Color3(...data.ambient).toHexString();

	// Sliders
	ui.alpha.value = data.alpha;
	ui.specularPower.value = data.specularPower;
	ui.bumpLevel.value = data.bumpLevel;
	ui.parallaxBias.value = data.parallaxScaleBias;

	// Labels
	ui.lAlpha.innerText = data.alpha.toFixed(2);
	ui.lSpecularPower.innerText = data.specularPower;
	ui.lBumpLevel.innerText = data.bumpLevel.toFixed(2);
	ui.lParallaxBias.innerText = data.parallaxScaleBias.toFixed(3);

	// Checkboxes
	ui.useParallax.checked = data.useParallax;
	ui.useParallaxOcclusion.checked = data.useParallaxOcclusion;

	// Textures
	ui.diffusePath.innerText = data.diffuseTexture || 'No file selected';
	ui.bumpPath.innerText = data.bumpTexture || 'No file selected';
}

// MODIFIED: Sync Data from UI
function updateDataFromUI () {
	if (selectedIndex < 0 || !currentLibrary[selectedIndex]) return;

	const data = currentLibrary[selectedIndex];

	data.name = ui.name.value;

	data.diffuse = Color3.FromHexString(ui.diffuse.value).asArray();
	data.specular = Color3.FromHexString(ui.specular.value).asArray();
	data.emissive = Color3.FromHexString(ui.emissive.value).asArray();
	data.ambient = Color3.FromHexString(ui.ambient.value).asArray();

	data.alpha = parseFloat(ui.alpha.value);
	data.specularPower = parseFloat(ui.specularPower.value);
	data.bumpLevel = parseFloat(ui.bumpLevel.value);
	data.parallaxScaleBias = parseFloat(ui.parallaxBias.value);

	data.useParallax = ui.useParallax.checked;
	data.useParallaxOcclusion = ui.useParallaxOcclusion.checked;

	// Update Labels
	ui.lAlpha.innerText = data.alpha.toFixed(2);
	ui.lSpecularPower.innerText = data.specularPower;
	ui.lBumpLevel.innerText = data.bumpLevel.toFixed(2);
	ui.lParallaxBias.innerText = data.parallaxScaleBias.toFixed(3);

	// Update Preview
	updatePreviewFromData(data);

	// Update List Name
	const btn = ui.matList.children[selectedIndex];
	if (btn) btn.innerText = data.name;
}

// MODIFIED: Handle multiple texture types
async function handleFileUpload (e, type) {
	const file = e.target.files[0];
	if (!file) return;

	if (selectedIndex < 0) return;
	const data = currentLibrary[selectedIndex];

	const pathLabel = type === 'diffuse' ? ui.diffusePath : ui.bumpPath;
	pathLabel.innerText = 'Uploading...';

	try {
		const res = await fetch(`/api/upload-texture?name=${encodeURIComponent(file.name)}`, {
			method: 'POST',
			body: file
		});

		const result = await res.json();

		if (result.success) {
			if (type === 'diffuse') data.diffuseTexture = result.path;
			if (type === 'bump') data.bumpTexture = result.path;

			pathLabel.innerText = result.path;
			updatePreviewFromData(data);
		} else {
			alert('Upload failed: ' + result.error);
			pathLabel.innerText = 'Error';
		}
	} catch (err) {
		console.error(err);
		alert('Upload error');
		pathLabel.innerText = 'Error';
	}

	// Reset input
	e.target.value = '';
}

function selectMaterial (index) {
	selectedIndex = index;

	// Highlight UI
	Array.from(ui.matList.children).forEach((child, i) => {
		if (i === index) child.classList.add('btn-active');
		else child.classList.remove('btn-active');
	});

	if (index >= 0) {
		const data = currentLibrary[index];
		updateUIFromData(data);
		updatePreviewFromData(data);
		ui.btnDeleteMat.disabled = false;
	} else {
		ui.btnDeleteMat.disabled = true;
	}
}

function renderMaterialList () {
	ui.matList.innerHTML = '';
	if (currentLibrary.length === 0) {
		ui.matList.innerHTML = "<div class='text-xs opacity-50 p-2 text-center'>Empty Library</div>";
		return;
	}

	currentLibrary.forEach((mat, index) => {
		const btn = document.createElement('button');
		btn.className = 'btn btn-sm btn-ghost justify-start font-normal normal-case text-left w-full truncate';
		btn.innerText = mat.name;
		btn.onclick = () => selectMaterial(index);
		ui.matList.appendChild(btn);
	});
}

function renderFileList (files) {
	ui.fileList.innerHTML = '';
	if (!files || files.length === 0) {
		ui.fileList.innerHTML = "<div class='text-xs opacity-50 p-2'>No libraries found.</div>";
		return;
	}

	files.forEach(file => {
		const row = document.createElement('div');
		row.className = 'flex justify-between items-center bg-base-100 p-1 rounded hover:bg-base-content/10 cursor-pointer mb-1';
		if (currentFilename === file) row.classList.add('border', 'border-primary');

		const span = document.createElement('span');
		span.innerText = file.replace('.json', '');
		span.className = 'text-sm truncate flex-1 px-1';
		span.onclick = () => loadLibrary(file);

		const btnDel = document.createElement('button');
		btnDel.innerText = '×';
		btnDel.className = 'btn btn-xs btn-ghost text-error px-1';
		btnDel.onclick = (e) => {
			e.stopPropagation();
			if (confirm(`Delete library "${file}"?`)) deleteLibrary(file);
		};

		row.appendChild(span);
		row.appendChild(btnDel);
		ui.fileList.appendChild(row);
	});
}

// --- API Calls ---

async function fetchFiles () {
	ui.fileList.innerHTML = "<span class='loading loading-spinner loading-xs'></span>";
	try {
		const res = await fetch('/api/materials');
		const data = await res.json();
		renderFileList(data.files);
	} catch (e) {
		console.error(e);
	}
}

async function loadLibrary (filename) {
	try {
		const res = await fetch(`/api/materials?file=${filename}`);
		const json = await res.json();

		if (json.success) {
			currentFilename = filename;

			// Handle legacy single-object files vs new array files
			if (Array.isArray(json.data)) {
				// Map legacy PBR properties to StandardMaterial if loading older files
				currentLibrary = json.data.map(mat => {
					if (mat.albedo) {
						return {
							name: mat.name,
							diffuse: mat.albedo,
							specular: [1,1,1],
							emissive: mat.emissive || [0,0,0],
							ambient: [0,0,0],
							alpha: mat.alpha !== undefined ? mat.alpha : 1.0,
							specularPower: 128,
							diffuseTexture: mat.texturePath || null,
							bumpTexture: null,
							bumpLevel: 1.0,
							useParallax: false,
							useParallaxOcclusion: false,
							parallaxScaleBias: 0.05
						};
					}
					return mat;
				});
			} else {
				currentLibrary = [json.data];
			}

			ui.inpFilename.value = filename.replace('.json', '');
			ui.btnAddMat.disabled = false;
			ui.btnSaveLib.disabled = false;

			renderFileList(await (await fetch('/api/materials')).json().files); // Refresh highlight
			renderMaterialList();

			// Select first
			if (currentLibrary.length > 0) selectMaterial(0);
			else selectMaterial(-1);
		}
	} catch (e) {
		console.error(e);
		alert('Failed to load library.');
	}
}

async function saveLibrary () {
	const name = ui.inpFilename.value.trim();
	if (!name) {
		alert('Please enter a library name.');
		return;
	}

	try {
		const res = await fetch('/api/materials', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, data: currentLibrary })
		});
		const result = await res.json();
		if (result.success) {
			currentFilename = result.filename;
			showStatus('Saved: ' + result.filename);
			fetchFiles(); // Refresh list to show new file or update highlight
		} else {
			alert('Error: ' + result.error);
		}
	} catch (e) {
		console.error(e);
		alert('Save failed.');
	}
}

async function deleteLibrary (filename) {
	await fetch(`/api/materials?file=${filename}`, { method: 'DELETE' });
	if (currentFilename === filename) {
		currentFilename = null;
		currentLibrary = [];
		renderMaterialList();
		ui.btnAddMat.disabled = true;
		ui.btnSaveLib.disabled = true;
		ui.inpFilename.value = '';
	}
	fetchFiles();
}

function showStatus (msg) {
	ui.status.innerText = msg;
	setTimeout(() => { ui.status.innerText = ''; }, 3000);
}

// --- Event Listeners ---

function bindEvents () {
	// Inputs
	[
		ui.name, ui.diffuse, ui.specular, ui.emissive, ui.ambient,
		ui.alpha, ui.specularPower, ui.bumpLevel, ui.parallaxBias
	].forEach(el => {
		el.addEventListener('input', updateDataFromUI);
	});

	[ui.useParallax, ui.useParallaxOcclusion].forEach(el => {
		el.addEventListener('change', updateDataFromUI);
	});

	// Textures
	ui.diffuseFile.addEventListener('change', (e) => handleFileUpload(e, 'diffuse'));
	ui.bumpFile.addEventListener('change', (e) => handleFileUpload(e, 'bump'));

	ui.btnClearDiffuse.onclick = () => {
		if (selectedIndex > -1) {
			currentLibrary[selectedIndex].diffuseTexture = null;
			updateUIFromData(currentLibrary[selectedIndex]);
			updatePreviewFromData(currentLibrary[selectedIndex]);
		}
	};

	ui.btnClearBump.onclick = () => {
		if (selectedIndex > -1) {
			currentLibrary[selectedIndex].bumpTexture = null;
			updateUIFromData(currentLibrary[selectedIndex]);
			updatePreviewFromData(currentLibrary[selectedIndex]);
		}
	};

	// NEW: Shape Selector
	ui.shapeSelector.addEventListener('change', (e) => {
		Object.values(previewShapes).forEach(shape => shape.isVisible = false);
		if (previewShapes[e.target.value]) {
			previewShapes[e.target.value].isVisible = true;
		}
	});

	ui.btnRefresh.onclick = fetchFiles;

	ui.btnNewLib.onclick = () => {
		const name = ui.inpFilename.value.trim();
		if (!name) return;
		currentFilename = null; // Will be set on save
		currentLibrary = [];
		renderMaterialList();
		ui.btnAddMat.disabled = false;
		ui.btnSaveLib.disabled = false;
		// Auto add one material
		currentLibrary.push(createDefaultMaterialData('New Material'));
		renderMaterialList();
		selectMaterial(0);
	};

	ui.btnAddMat.onclick = () => {
		currentLibrary.push(createDefaultMaterialData(`Material ${currentLibrary.length + 1}`));
		renderMaterialList();
		selectMaterial(currentLibrary.length - 1);
	};

	ui.btnDeleteMat.onclick = () => {
		if (selectedIndex > -1) {
			if (confirm('Delete material?')) {
				currentLibrary.splice(selectedIndex, 1);
				renderMaterialList();
				selectMaterial(Math.max(0, selectedIndex - 1));
				if (currentLibrary.length === 0) selectMaterial(-1);
			}
		}
	};

	ui.btnSaveLib.onclick = saveLibrary;
}

// Init
initScene();
bindEvents();
fetchFiles();