import { Engine, Scene, Vector3, Color3, PBRMaterial, MeshBuilder, HemisphericLight, ArcRotateCamera } from "@babylonjs/core";

const canvas = document.getElementById("previewCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
let previewMaterial;

// State
let currentFilename = null;
let currentLibrary = []; // Array of material data objects
let selectedIndex = -1;

// UI Elements
const ui = {
	fileList: document.getElementById("file-list"),
	matList: document.getElementById("mat-list"),
	inpFilename: document.getElementById("inp-filename"),
	
	// Material Inputs
	name: document.getElementById("mat-name"),
	albedo: document.getElementById("mat-albedo"),
	emissive: document.getElementById("mat-emissive"),
	metallic: document.getElementById("mat-metallic"),
	roughness: document.getElementById("mat-roughness"),
	alpha: document.getElementById("mat-alpha"),
	
	// Labels
	lMetallic: document.getElementById("val-metallic"),
	lRoughness: document.getElementById("val-roughness"),
	lAlpha: document.getElementById("val-alpha"),
	
	// Buttons
	btnRefresh: document.getElementById("btn-refresh-files"),
	btnNewLib: document.getElementById("btn-new-lib"),
	btnAddMat: document.getElementById("btn-add-mat"),
	btnSaveLib: document.getElementById("btn-save-lib"),
	btnDeleteMat: document.getElementById("btn-delete-mat"),
	
	status: document.getElementById("status-msg")
};

function initScene() {
	scene.clearColor = new Color3(0.1, 0.1, 0.1);
	
	const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.5, 3, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;
	
	const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
	light.intensity = 1.0;
	
	const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 1.5, segments: 32 }, scene);
	previewMaterial = new PBRMaterial("previewMat", scene);
	sphere.material = previewMaterial;
	
	engine.runRenderLoop(() => scene.render());
	window.addEventListener("resize", () => engine.resize());
}

// --- Logic ---

function createDefaultMaterialData(name) {
	return {
		name: name || "New Material",
		albedo: [1, 1, 1],
		emissive: [0, 0, 0],
		metallic: 0,
		roughness: 1,
		alpha: 1
	};
}

function updatePreviewFromData(data) {
	if (!data) return;
	previewMaterial.albedoColor = new Color3(...data.albedo);
	previewMaterial.emissiveColor = new Color3(...data.emissive);
	previewMaterial.metallic = data.metallic;
	previewMaterial.roughness = data.roughness;
	previewMaterial.alpha = data.alpha;
}

function updateUIFromData(data) {
	if (!data) {
		// Disable inputs?
		ui.name.value = "";
		return;
	}
	ui.name.value = data.name;
	ui.albedo.value = new Color3(...data.albedo).toHexString();
	ui.emissive.value = new Color3(...data.emissive).toHexString();
	ui.metallic.value = data.metallic;
	ui.roughness.value = data.roughness;
	ui.alpha.value = data.alpha;
	
	ui.lMetallic.innerText = data.metallic.toFixed(2);
	ui.lRoughness.innerText = data.roughness.toFixed(2);
	ui.lAlpha.innerText = data.alpha.toFixed(2);
}

function updateDataFromUI() {
	if (selectedIndex < 0 || !currentLibrary[selectedIndex]) return;
	
	const data = currentLibrary[selectedIndex];
	
	data.name = ui.name.value;
	data.albedo = Color3.FromHexString(ui.albedo.value).asArray();
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
}

function selectMaterial(index) {
	selectedIndex = index;
	
	// Highlight UI
	Array.from(ui.matList.children).forEach((child, i) => {
		if (i === index) child.classList.add("btn-active");
		else child.classList.remove("btn-active");
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

function renderMaterialList() {
	ui.matList.innerHTML = "";
	if (currentLibrary.length === 0) {
		ui.matList.innerHTML = "<div class='text-xs opacity-50 p-2 text-center'>Empty Library</div>";
		return;
	}
	
	currentLibrary.forEach((mat, index) => {
		const btn = document.createElement("button");
		btn.className = "btn btn-sm btn-ghost justify-start font-normal normal-case text-left w-full truncate";
		btn.innerText = mat.name;
		btn.onclick = () => selectMaterial(index);
		ui.matList.appendChild(btn);
	});
}

function renderFileList(files) {
	ui.fileList.innerHTML = "";
	if (!files || files.length === 0) {
		ui.fileList.innerHTML = "<div class='text-xs opacity-50 p-2'>No libraries found.</div>";
		return;
	}
	
	files.forEach(file => {
		const row = document.createElement("div");
		row.className = "flex justify-between items-center bg-base-100 p-1 rounded hover:bg-base-content/10 cursor-pointer mb-1";
		if (currentFilename === file) row.classList.add("border", "border-primary");
		
		const span = document.createElement("span");
		span.innerText = file.replace(".json", "");
		span.className = "text-sm truncate flex-1 px-1";
		span.onclick = () => loadLibrary(file);
		
		const btnDel = document.createElement("button");
		btnDel.innerText = "×";
		btnDel.className = "btn btn-xs btn-ghost text-error px-1";
		btnDel.onclick = (e) => {
			e.stopPropagation();
			if(confirm(`Delete library "${file}"?`)) deleteLibrary(file);
		};
		
		row.appendChild(span);
		row.appendChild(btnDel);
		ui.fileList.appendChild(row);
	});
}

// --- API Calls ---

async function fetchFiles() {
	ui.fileList.innerHTML = "<span class='loading loading-spinner loading-xs'></span>";
	try {
		const res = await fetch('/api/materials');
		const data = await res.json();
		renderFileList(data.files);
	} catch (e) {
		console.error(e);
	}
}

async function loadLibrary(filename) {
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
			
			ui.inpFilename.value = filename.replace(".json", "");
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
		alert("Failed to load library.");
	}
}

async function saveLibrary() {
	let name = ui.inpFilename.value.trim();
	if (!name) {
		alert("Please enter a library name.");
		return;
	}
	
	// Ensure extension for internal logic, though server handles it
	// We just send the name, server sanitizes
	
	try {
		const res = await fetch('/api/materials', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, data: currentLibrary })
		});
		const result = await res.json();
		if (result.success) {
			currentFilename = result.filename;
			showStatus("Saved: " + result.filename);
			fetchFiles(); // Refresh list to show new file or update highlight
		} else {
			alert("Error: " + result.error);
		}
	} catch (e) {
		console.error(e);
		alert("Save failed.");
	}
}

async function deleteLibrary(filename) {
	await fetch(`/api/materials?file=${filename}`, { method: 'DELETE' });
	if (currentFilename === filename) {
		currentFilename = null;
		currentLibrary = [];
		renderMaterialList();
		ui.btnAddMat.disabled = true;
		ui.btnSaveLib.disabled = true;
		ui.inpFilename.value = "";
	}
	fetchFiles();
}

function showStatus(msg) {
	ui.status.innerText = msg;
	setTimeout(() => { ui.status.innerText = ""; }, 3000);
}

// --- Event Listeners ---

function bindEvents() {
	// Inputs
	[ui.name, ui.albedo, ui.emissive, ui.metallic, ui.roughness, ui.alpha].forEach(el => {
		el.addEventListener("input", updateDataFromUI);
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
		currentLibrary.push(createDefaultMaterialData("New Material"));
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
			if (confirm("Delete material?")) {
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
