import {camera, scene} from "./assembly_scene.js";
import { setGizmoMode } from "./assembly_gizmoControl.js";
import { createLight } from "./assembly_lightManager.js";
import { markModified } from "./assembly_manager.js";
import { refreshSceneGraph } from "./assembly_treeViewManager.js";
import { recordState } from "./assembly_historyManager.js";
import { selectNode } from "./assembly_selectionManager.js";
import { importSceneAsAsset } from "./assembly_manager.js";

const lights = ["Point", "Spot"];

export function setupAssemblyUI() {
	const sList = document.getElementById("parts-list");
	const lList = document.getElementById("lights-list");
	const canvas = document.getElementById("renderCanvas");

	setupGizmoButtons();
	loadAvailableScenes(sList);
	setupCameraControls();
	const btnRefreshParts = document.getElementById("btn-refresh-parts");
	if (btnRefreshParts) {
		btnRefreshParts.onclick = () => loadAvailableScenes(sList);
	}

	window.addEventListener("keydown", (e) => {
		console.log("Key pressed:", e.key); // Debug log for key presses
		if (e.key === "Escape") {
			// Check if any modal is open to prevent accidental deselection when closing a modal
			if (document.querySelector("dialog[open]")) return;

			selectNode(null);
		}
	});

	lights.forEach(type => {
		const div = createDraggableItem(type, "light");
		lList.appendChild(div);
	});

	canvas.addEventListener("dragover", (e) => e.preventDefault());
	canvas.addEventListener("drop", async (e) => {
		e.preventDefault();
		const type = e.dataTransfer.getData("type");
		const category = e.dataTransfer.getData("category");

		let createdNode = null;

		if (category === "scene") {
			// Import Scene
			createdNode = await importSceneAsAsset(type);
		} else if (category === "light") {
			createdNode = createLight(type.toLowerCase(), null, scene);
		}

		if (createdNode) {
			selectNode(createdNode, false);
			markModified();
			refreshSceneGraph();
			recordState();
		}
	});
}

function setupGizmoButtons() {
	const btnPos = document.getElementById("btn-gizmo-pos");
	const btnRot = document.getElementById("btn-gizmo-rot");
	const btnScl = document.getElementById("btn-gizmo-scl");

	const setActive = (activeBtn) => {[btnPos, btnRot, btnScl].forEach(btn => {
		if (btn === activeBtn) btn.classList.add("btn-active");
		else btn.classList.remove("btn-active");
	});
	};

	btnPos.onclick = () => {
		setGizmoMode("position");
		setActive(btnPos);
	};

	btnRot.onclick = () => {
		setGizmoMode("rotation");
		setActive(btnRot);
	};

	btnScl.onclick = () => {
		setGizmoMode("scale");
		setActive(btnScl);
	};
}

function setupCameraControls() {
	const setView = (alpha, beta) => {
		if (!camera) return;
		camera.alpha = alpha;
		camera.beta = beta;
	};

	const map = {
		"top": { a: -Math.PI / 2, b: 0 },
		"bottom": { a: -Math.PI / 2, b: Math.PI },
		"front": { a: -Math.PI / 2, b: Math.PI / 2 },
		"back": { a: Math.PI / 2, b: Math.PI / 2 },
		"left": { a: Math.PI, b: Math.PI / 2 },
		"right": { a: 0, b: Math.PI / 2 }
	};

	Object.keys(map).forEach(id => {
		const btn = document.getElementById(`btn-view-${id}`);
		if (btn) {
			btn.onclick = () => setView(map[id].a, map[id].b);
		}
	});
}

function createDraggableItem(name, category, dataValue = null) {
	const div = document.createElement("div");
	div.className = "btn btn-sm btn-outline btn-secondary cursor-grab";
	div.innerText = name;
	div.draggable = true;
	div.addEventListener("dragstart", (e) => {
		// Use dataValue if provided, otherwise fallback to the display name
		e.dataTransfer.setData("type", dataValue || name);
		e.dataTransfer.setData("category", category);
	});
	return div;
}

async function loadAvailableScenes(container) {
	container.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/parts');
		const data = await res.json();
		container.innerHTML = "";

		if (!data.files || data.files.length === 0) {
			container.innerHTML = "<p class='text-sm opacity-50'>No scenes found.</p>";
			return;
		}

		data.files.forEach(file => {
			// Remove .json extension for a cleaner display
			const displayName = file.replace('.json', '');

			// Pass the original file name as dataValue so importSceneAsAsset can fetch it correctly
			const div = createDraggableItem(displayName, "scene", file);

			// Changed btn-sm to btn-xs and added w-full for a more compact list layout
			div.className = "btn btn-xs btn-outline btn-primary cursor-grab justify-start normal-case overflow-hidden w-full";
			container.appendChild(div);
		});

	} catch (e) {
		container.innerHTML = "<p class='text-error'>Failed to load parts.</p>";
	}
}
