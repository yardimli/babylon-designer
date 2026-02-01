import { AbstractMesh } from "@babylonjs/core";
import { scene } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectNode, isSelected } from "./selectionManager.js"; // Updated
import { recordState } from "./historyManager.js";

const collapsedNodes = new Set();

function isGraphNode(node) {
	if (node instanceof AbstractMesh) {
		return isUserMesh(node);
	}
	if (node.getClassName() === "TransformNode") {
		return node.metadata && node.metadata.isTransformNode;
	}
	return false;
}

function isUserMesh(mesh) {
	return mesh.name !== "previewSphere" &&
		!mesh.name.startsWith("gizmo") &&
		mesh.name !== "hdrSkyBox" &&
		(mesh.metadata?.isPrimitive || mesh.metadata?.isLightProxy);
}

function getSortedRoots() {
	return scene.rootNodes
		.filter(n => !n.parent && isGraphNode(n))
		.sort((a, b) => (a.metadata?.sortIndex || 0) - (b.metadata?.sortIndex || 0));
}

function getSortedChildren(node) {
	return node.getChildren()
		.filter(child => isGraphNode(child))
		.sort((a, b) => (a.metadata?.sortIndex || 0) - (b.metadata?.sortIndex || 0));
}

export function setNodeParent(node, parent) {
	node.setParent(parent);
	if (node.metadata && node.metadata.isLightProxy) {
		const light = scene.getLightByID(node.metadata.lightId);
		if (light) {
			light.parent = parent;
		}
	}
}

export function refreshSceneGraph() {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	container.innerHTML = "";
	
	container.ondragover = (e) => {
		e.preventDefault();
		if (e.target === container) container.classList.add("bg-base-content/5");
	};
	container.ondragleave = (e) => {
		if (e.target === container) container.classList.remove("bg-base-content/5");
	};
	container.ondrop = (e) => {
		e.preventDefault();
		container.classList.remove("bg-base-content/5");
		if (e.target === container) {
			const draggedId = e.dataTransfer.getData("nodeId");
			if (draggedId) {
				const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
				if (draggedNode && draggedNode.parent) {
					setNodeParent(draggedNode, null);
					const roots = getSortedRoots();
					const maxIndex = roots.length > 0 ? (roots[roots.length - 1].metadata?.sortIndex || 0) : 0;
					if (!draggedNode.metadata) draggedNode.metadata = {};
					draggedNode.metadata.sortIndex = maxIndex + 100;
					markModified();
					refreshSceneGraph();
					recordState();
				}
			}
		}
	};
	
	const roots = getSortedRoots();
	if (roots.length === 0) {
		container.innerHTML = "<div class='opacity-50 italic p-2'>Empty Scene</div>";
		return;
	}
	
	roots.forEach(node => {
		container.appendChild(createTreeNode(node, 0));
	});
	
	// Re-apply highlights after rebuild
	// We need to get current selection. Since we can't import getSelectedNodes due to circular dep risk if not careful,
	// we rely on the fact that highlightInTree is called by selectionManager.
	// But refreshSceneGraph is called by others. So we should trigger a highlight update.
	// Actually, we can import getSelectedNodes here safely if selectionManager doesn't import treeViewManager immediately at top level for execution.
	// But simpler: just let the next selection update handle it, or pass it.
	// For now, let's rely on the caller to update selection or add a small timeout.
}

function createTreeNode(node, level) {
	const wrapper = document.createElement("div");
	
	const row = document.createElement("div");
	row.className = "flex items-center hover:bg-base-content/10 rounded cursor-pointer p-1 border-transparent border-y-2";
	row.style.paddingLeft = `${level * 12 + 4}px`;
	row.dataset.meshId = node.id;
	
	// Highlight if selected
	if (isSelected(node)) {
		row.classList.add("bg-primary/20", "text-primary");
	}
	
	// --- Drag & Drop Logic ---
	row.draggable = true;
	row.ondragstart = (e) => {
		e.dataTransfer.setData("nodeId", node.id);
		e.dataTransfer.effectAllowed = "move";
		setTimeout(() => row.classList.add("opacity-50"), 0);
	};
	row.ondragend = () => row.classList.remove("opacity-50");
	row.ondragover = (e) => {
		e.preventDefault();
		e.stopPropagation();
		const draggedId = e.dataTransfer.getData("nodeId");
		if (draggedId === node.id) return;
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20");
		row.style.borderColor = "transparent";
		if (relY < height * 0.25) {
			row.classList.add("border-t-primary");
			row.style.borderTopColor = "oklch(var(--p))";
		} else if (relY > height * 0.75) {
			row.classList.add("border-b-primary");
			row.style.borderBottomColor = "oklch(var(--p))";
		} else {
			row.classList.add("bg-primary/20");
		}
	};
	row.ondragleave = () => {
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20");
		row.style.borderColor = "transparent";
	};
	row.ondrop = (e) => {
		e.preventDefault();
		e.stopPropagation();
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20", "opacity-50");
		row.style.borderColor = "transparent";
		const draggedId = e.dataTransfer.getData("nodeId");
		if (!draggedId || draggedId === node.id) return;
		const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
		if (!draggedNode) return;
		let check = node;
		while (check) {
			if (check === draggedNode) return;
			check = check.parent;
		}
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		let action = "inside";
		if (relY < height * 0.25) action = "before";
		else if (relY > height * 0.75) action = "after";
		handleNodeDrop(draggedNode, node, action);
	};
	
	// Expand/Collapse
	const children = getSortedChildren(node);
	const hasChildren = children.length > 0;
	const icon = document.createElement("span");
	icon.className = "w-4 h-4 mr-1 flex items-center justify-center font-mono text-xs opacity-70";
	if (hasChildren) {
		const isCollapsed = collapsedNodes.has(node.id);
		icon.innerText = isCollapsed ? "▶" : "▼";
		icon.onclick = (e) => {
			e.stopPropagation();
			if (isCollapsed) collapsedNodes.delete(node.id);
			else collapsedNodes.add(node.id);
			refreshSceneGraph();
		};
	} else {
		icon.innerText = "•";
	}
	row.appendChild(icon);
	
	const label = document.createElement("span");
	label.innerText = node.name;
	label.className = "truncate flex-1";
	if (node.metadata && node.metadata.isTransformNode) label.className += " text-secondary";
	row.appendChild(label);
	
	// Selection Logic (Updated for Shift)
	row.onclick = (e) => {
		selectNode(node, e.shiftKey);
	};
	
	wrapper.appendChild(row);
	
	if (hasChildren && !collapsedNodes.has(node.id)) {
		const childrenContainer = document.createElement("div");
		children.forEach(child => {
			childrenContainer.appendChild(createTreeNode(child, level + 1));
		});
		wrapper.appendChild(childrenContainer);
	}
	
	return wrapper;
}

function handleNodeDrop(draggedNode, targetNode, action) {
	if (action === "inside") {
		setNodeParent(draggedNode, targetNode);
		const siblings = getSortedChildren(targetNode);
		const maxIndex = siblings.length > 0 ? (siblings[siblings.length - 1].metadata?.sortIndex || 0) : 0;
		if (!draggedNode.metadata) draggedNode.metadata = {};
		draggedNode.metadata.sortIndex = maxIndex + 100;
		collapsedNodes.delete(targetNode.id);
	} else {
		setNodeParent(draggedNode, targetNode.parent);
		const parent = targetNode.parent;
		let siblings = parent ? getSortedChildren(parent) : getSortedRoots();
		siblings = siblings.filter(n => n !== draggedNode);
		const targetIndex = siblings.indexOf(targetNode);
		if (action === "before") siblings.splice(targetIndex, 0, draggedNode);
		else siblings.splice(targetIndex + 1, 0, draggedNode);
		siblings.forEach((sib, index) => {
			if (!sib.metadata) sib.metadata = {};
			sib.metadata.sortIndex = (index + 1) * 100;
		});
	}
	markModified();
	refreshSceneGraph();
	recordState();
}

export function highlightInTree(nodes) {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	// Clear all highlights
	container.querySelectorAll("[data-mesh-id]").forEach(el => {
		el.classList.remove("bg-primary/20", "text-primary");
	});
	
	// Apply new highlights
	if (Array.isArray(nodes)) {
		nodes.forEach(node => {
			const el = container.querySelector(`[data-mesh-id="${node.id}"]`);
			if (el) {
				el.classList.add("bg-primary/20", "text-primary");
			}
		});
	}
}
