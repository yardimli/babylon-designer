import { Engine, Scene, Vector3, Color3, PBRMaterial, MeshBuilder, HemisphericLight, ArcRotateCamera, DynamicTexture, Texture } from '@babylonjs/core';

const canvas = document.getElementById('previewCanvas');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
let previewMaterial;

// State
let currentFilename = null;
let currentLibrary = []; // Array of material data objects
let selectedIndex = -1;

// UI Elements
const ui = {
	fileList: document.getElementById('file-list'),
	matList: document.getElementById('mat-list'),
	inpFilename: document.getElementById('inp-filename'),

	// Material Inputs
	name: document.getElementById('mat-name'),
	albedoType: document.getElementById('mat-albedo-type'),

	// Type: Color
	ctrlColor: document.getElementById('ctrl-color'),
	albedo: document.getElementById('mat-albedo'),

	// Type: Gradient
	ctrlGradient: document.getElementById('ctrl-gradient'),
	grad1: document.getElementById('mat-grad-1'),
	grad2: document.getElementById('mat-grad-2'),

	// Type: Image
	ctrlImage: document.getElementById('ctrl-image'),
	fileInput: document.getElementById('mat-file-input'),
	texPreview: document.getElementById('mat-texture-preview'),
	texPath: document.getElementById('mat-texture-path'),

	emissive: document.getElementById('mat-emissive'),
	metallic: document.getElementById('mat-metallic'),
	roughness: document.getElementById('mat-roughness'),
	alpha: document.getElementById('mat-alpha'),

	// Labels
	lMetallic: document.getElementById('val-metallic'),
	lRoughness: document.getElementById('val-roughness'),
	lAlpha: document.getElementById('val-alpha'),

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

	const sphere = MeshBuilder.CreateSphere('sphere', { diameter: 1.5, segments: 32 }, scene);
	previewMaterial = new PBRMaterial('previewMat', scene);
	sphere.material = previewMaterial;

	engine.runRenderLoop(() => scene.render());
	window.addEventListener('resize', () => engine.resize());
}

// --- Logic ---

function createDefaultMaterialData (name) {
	return {
		name: name || 'New Material',
		albedoType: 'color', // color, gradient, image
		albedo: [1, 1, 1],
		gradient: { top: [1, 1, 1], bottom: [0, 0, 0] },
		texturePath: null,
		emissive: [0, 0, 0],
		metallic: 0,
		roughness: 1,
		alpha: 1
	};
}

function updatePreviewFromData (data) {
	if (!data) return;

	// Reset textures
	previewMaterial.albedoTexture = null;

	// Handle Albedo Type
	if (data.albedoType === 'gradient') {
		// Generate Gradient Texture
		const dt = new DynamicTexture('gradTex', { width: 256, height: 256 }, scene, false);
		const ctx = dt.getContext();
		const grad = ctx.createLinearGradient(0, 0, 0, 256);

		const c1 = new Color3(...(data.gradient?.top || [1, 1, 1]));
		const c2 = new Color3(...(data.gradient?.bottom || [0, 0, 0]));

		grad.addColorStop(0, c1.toHexString());
		grad.addColorStop(1, c2.toHexString());

		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 256, 256);
		dt.update();

		previewMaterial.albedoTexture = dt;
		previewMaterial.albedoColor = new Color3(1, 1, 1);
	} else if (data.albedoType === 'image' && data.texturePath) {
		// Load Image Texture
		previewMaterial.albedoTexture = new Texture(data.texturePath, scene);
		previewMaterial.albedoColor = new Color3(1, 1, 1);
	} else {
		// Solid Color
		previewMaterial.albedoColor = new Color3(...data.albedo);
	}

	previewMaterial.emissiveColor = new Color3(...data.emissive);
	previewMaterial.metallic = data.metallic;
	previewMaterial.roughness = data.roughness;
	previewMaterial.alpha = data.alpha;
}

function updateUIFromData (data) {
	if (!data) {
		ui.name.value = '';
		return;
	}
	ui.name.value = data.name;

	// Albedo Type
	const type = data.albedoType || 'color';
	ui.albedoType.value = type;

	// Toggle Visibility
	ui.ctrlColor.classList.toggle('hidden', type !== 'color');
	ui.ctrlGradient.classList.toggle('hidden', type !== 'gradient');
	ui.ctrlImage.classList.toggle('hidden', type !== 'image');

	// Values
	if (type === 'color') {
		ui.albedo.value = new Color3(...data.albedo).toHexString();
	} else if (type === 'gradient') {
		const g = data.gradient || { top: [1, 1, 1], bottom: [0, 0, 0] };
		ui.grad1.value = new Color3(...g.top).toHexString();
		ui.grad2.value = new Color3(...g.bottom).toHexString();
	} else if (type === 'image') {
		ui.texPath.innerText = data.texturePath || 'No file selected';
		if (data.texturePath) {
			ui.texPreview.style.backgroundImage = `url('${data.texturePath}')`;
		} else {
			ui.texPreview.style.backgroundImage = 'none';
		}
	}

	ui.emissive.value = new Color3(...data.emissive).toHexString();
	ui.metallic.value = data.metallic;
	ui.roughness.value = data.roughness;
	ui.alpha.value = data.alpha;

	ui.lMetallic.innerText = data.metallic.toFixed(2);
	ui.lRoughness.innerText = data.roughness.toFixed(2);
	ui.lAlpha.innerText = data.alpha.toFixed(2);
}

function updateDataFromUI () {
	if (selectedIndex < 0 || !currentLibrary[selectedIndex]) return;

	const data = currentLibrary[selectedIndex];

	data.name = ui.name.value;
	data.albedoType = ui.albedoType.value;

	if (data.albedoType === 'color') {
		data.albedo = Color3.FromHexString(ui.albedo.value).asArray();
	} else if (data.albedoType === 'gradient') {
		data.gradient = {
			top: Color3.FromHexString(ui.grad1.value).asArray(),
			bottom: Color3.FromHexString(ui.grad2.value).asArray()
		};
	}
	// Image path is updated via upload handler, not here directly

	data.emissive = Color3.FromHexString(ui.emissive.value).asArray();
	data.metallic = parseFloat(ui.metallic.value);
	data.roughness = parseFloat(ui.roughness.value);
	data.alpha = parseFloat(ui.alpha.value);

	// Update Labels
	ui.lMetallic.innerText = data.metallic.toFixed(2);
	ui.lRoughness.innerText = data.roughness.toFixed(2);
	ui.lAlpha.innerText = data.alpha.toFixed(2);

	// Update Preview
	updatePreviewFromData(data);

	// Update List Name
	const btn = ui.matList.children[selectedIndex];
	if (btn) btn.innerText = data.name;

	// Refresh UI visibility if type changed
	ui.ctrlColor.classList.toggle('hidden', data.albedoType !== 'color');
	ui.ctrlGradient.classList.toggle('hidden', data.albedoType !== 'gradient');
	ui.ctrlImage.classList.toggle('hidden', data.albedoType !== 'image');
}

async function handleFileUpload (e) {
	const file = e.target.files[0];
	if (!file) return;

	if (selectedIndex < 0) return;
	const data = currentLibrary[selectedIndex];

	// Show loading state
	ui.texPath.innerText = 'Uploading...';

	try {
		// Use raw binary upload
		const res = await fetch(`/api/upload-texture?name=${encodeURIComponent(file.name)}`, {
			method: 'POST',
			body: file
		});

		const result = await res.json();

		if (result.success) {
			data.texturePath = result.path;
			ui.texPath.innerText = result.path;
			ui.texPreview.style.backgroundImage = `url('${result.path}')`;
			updatePreviewFromData(data);
		} else {
			alert('Upload failed: ' + result.error);
			ui.texPath.innerText = 'Error';
		}
	} catch (err) {
		console.error(err);
		alert('Upload error');
		ui.texPath.innerText = 'Error';
	}
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
				currentLibrary = json.data;
			} else {
				// Wrap legacy single material
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
	[ui.name, ui.albedo, ui.emissive, ui.metallic, ui.roughness, ui.alpha, ui.grad1, ui.grad2].forEach(el => {
		el.addEventListener('input', updateDataFromUI);
	});

	ui.albedoType.addEventListener('change', updateDataFromUI);
	ui.fileInput.addEventListener('change', handleFileUpload);

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