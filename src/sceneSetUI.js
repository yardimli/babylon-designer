import { scene } from "./sceneset_scene.js"; // Updated
import { setGizmoMode } from "./sceneset_gizmoControl.js"; // Updated
import { createLight } from "./sceneset_lightManager.js"; // Updated
import { markModified } from "./sceneSetManager.js";
import { refreshSceneGraph } from "./sceneset_treeViewManager.js"; // Updated
import { recordState } from "./sceneset_historyManager.js"; // Updated
import { selectNode } from "./sceneset_selectionManager.js"; // Updated
import { importSceneAsAsset } from "./sceneSetManager.js";

const lights = ["Point", "Directional"];

export function setupSceneSetUI() {
	const sList = document.getElementById("scenes-list");
	const lList = document.getElementById("lights-list");
	const canvas = document.getElementById("renderCanvas");
	
	setupGizmoButtons();
	loadAvailableScenes(sList);
	
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
	
	const setActive = (activeBtn) => {
		[btnPos, btnRot, btnScl].forEach(btn => {
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

function createDraggableItem(name, category) {
	const div = document.createElement("div");
	div.className = "btn btn-sm btn-outline btn-secondary cursor-grab";
	div.innerText = name;
	div.draggable = true;
	div.addEventListener("dragstart", (e) => {
		e.dataTransfer.setData("type", name);
		e.dataTransfer.setData("category", category);
	});
	return div;
}

async function loadAvailableScenes(container) {
	container.innerHTML = "<span class='loading loading-spinner'></span>";
	try {
		const res = await fetch('/api/scenes');
		const data = await res.json();
		container.innerHTML = "";
		
		if (!data.files || data.files.length === 0) {
			container.innerHTML = "<p class='text-sm opacity-50'>No scenes found.</p>";
			return;
		}
		
		data.files.forEach(file => {
			const div = createDraggableItem(file, "scene");
			div.className = "btn btn-sm btn-outline btn-primary cursor-grab justify-start normal-case overflow-hidden";
			container.appendChild(div);
		});
		
	} catch (e) {
		container.innerHTML = "<p class='text-error'>Failed to load scenes.</p>";
	}
}
