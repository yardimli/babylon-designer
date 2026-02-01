import { AbstractMesh } from "@babylonjs/core";
import { scene } from "./scene.js";
import { markModified } from "./sceneManager.js";
import { selectMesh } from "./gizmoControl.js";
import { recordState } from "./historyManager.js";

const collapsedNodes = new Set(); // Store IDs of collapsed nodes

// Helper to identify nodes that should appear in the tree
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

// Helper to sort nodes by metadata.sortIndex
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

// Helper to handle parenting logic including Light Proxies
// Exported so Property Editor can use it for the Dropdown
export function setNodeParent(node, parent) {
	node.setParent(parent);
	
	// If this is a light proxy, we must also parent the actual light
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
	
	// Enable dropping to root (unparenting)
	container.ondragover = (e) => {
		e.preventDefault();
		// Only highlight if we are over the container background, not a child
		if (e.target === container) {
			container.classList.add("bg-base-content/5");
		}
	};
	container.ondragleave = (e) => {
		if (e.target === container) {
			container.classList.remove("bg-base-content/5");
		}
	};
	container.ondrop = (e) => {
		e.preventDefault();
		container.classList.remove("bg-base-content/5");
		
		// If dropped directly on container, move to root
		if (e.target === container) {
			const draggedId = e.dataTransfer.getData("nodeId");
			if (draggedId) {
				const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
				if (draggedNode && draggedNode.parent) {
					setNodeParent(draggedNode, null);
					
					// Move to end of root list
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
	
	// We need to know the current selection to highlight it,
	// but we don't store state here. We can check the gizmo manager or
	// rely on the caller to handle selection, but for highlighting
	// we can check the DOM or pass the current selection.
	// Ideally, highlightInTree is called separately.
}

function createTreeNode(node, level) {
	const wrapper = document.createElement("div");
	
	// Row Container
	const row = document.createElement("div");
	row.className = "flex items-center hover:bg-base-content/10 rounded cursor-pointer p-1 border-transparent border-y-2";
	row.style.paddingLeft = `${level * 12 + 4}px`;
	row.dataset.meshId = node.id;
	
	// --- Drag & Drop Logic ---
	row.draggable = true;
	
	row.ondragstart = (e) => {
		e.dataTransfer.setData("nodeId", node.id);
		e.dataTransfer.effectAllowed = "move";
		// Small delay to let the ghost image form before hiding/styling
		setTimeout(() => row.classList.add("opacity-50"), 0);
	};
	
	row.ondragend = () => {
		row.classList.remove("opacity-50");
	};
	
	row.ondragover = (e) => {
		e.preventDefault(); // Allow drop
		e.stopPropagation(); // Handle here, don't bubble to container
		
		// Don't allow dropping on self
		const draggedId = e.dataTransfer.getData("nodeId");
		if (draggedId === node.id) return;
		
		// Determine drop zone: Top (Before), Middle (Inside), Bottom (After)
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		
		// Reset styles
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20");
		row.style.borderColor = "transparent";
		
		if (relY < height * 0.25) {
			// Zone: Before (Sibling)
			row.classList.add("border-t-primary");
			row.style.borderTopColor = "oklch(var(--p))"; // Force color if class fails
		} else if (relY > height * 0.75) {
			// Zone: After (Sibling)
			row.classList.add("border-b-primary");
			row.style.borderBottomColor = "oklch(var(--p))";
		} else {
			// Zone: Inside (Child)
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
		
		// Cleanup styles
		row.classList.remove("border-t-primary", "border-b-primary", "bg-primary/20", "opacity-50");
		row.style.borderColor = "transparent";
		
		const draggedId = e.dataTransfer.getData("nodeId");
		if (!draggedId || draggedId === node.id) return;
		
		const draggedNode = scene.getMeshByID(draggedId) || scene.getTransformNodeByID(draggedId);
		if (!draggedNode) return;
		
		// Circular check: Cannot drop parent into its own child
		let check = node;
		while (check) {
			if (check === draggedNode) return;
			check = check.parent;
		}
		
		// Determine Drop Action
		const rect = row.getBoundingClientRect();
		const relY = e.clientY - rect.top;
		const height = rect.height;
		
		let action = "inside";
		if (relY < height * 0.25) action = "before";
		else if (relY > height * 0.75) action = "after";
		
		handleNodeDrop(draggedNode, node, action);
	};
	
	// --- End Drag & Drop Logic ---
	
	// Expand/Collapse Icon
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
	
	// Name
	const label = document.createElement("span");
	label.innerText = node.name;
	label.className = "truncate flex-1";
	
	// Visual distinction for TransformNodes
	if (node.metadata && node.metadata.isTransformNode) {
		label.className += " text-secondary";
	}
	
	row.appendChild(label);
	
	// Selection Logic
	row.onclick = () => {
		selectMesh(node);
	};
	
	wrapper.appendChild(row);
	
	// Children Container
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
		// Reparent
		setNodeParent(draggedNode, targetNode);
		
		// Append to end of children list
		const siblings = getSortedChildren(targetNode);
		const maxIndex = siblings.length > 0 ? (siblings[siblings.length - 1].metadata?.sortIndex || 0) : 0;
		if (!draggedNode.metadata) draggedNode.metadata = {};
		draggedNode.metadata.sortIndex = maxIndex + 100;
		
		// Auto-expand target
		collapsedNodes.delete(targetNode.id);
	} else {
		// Reorder (Sibling)
		// 1. Ensure same parent
		setNodeParent(draggedNode, targetNode.parent);
		
		// 2. Get all siblings (including draggedNode which is now a sibling)
		const parent = targetNode.parent;
		let siblings = parent ? getSortedChildren(parent) : getSortedRoots();
		
		// Remove draggedNode from current position in array (it might be there if it was already a sibling)
		siblings = siblings.filter(n => n !== draggedNode);
		
		// Find index of target
		const targetIndex = siblings.indexOf(targetNode);
		
		// Insert draggedNode
		if (action === "before") {
			siblings.splice(targetIndex, 0, draggedNode);
		} else {
			siblings.splice(targetIndex + 1, 0, draggedNode);
		}
		
		// 3. Re-index all siblings to ensure stable float/int order
		siblings.forEach((sib, index) => {
			if (!sib.metadata) sib.metadata = {};
			sib.metadata.sortIndex = (index + 1) * 100;
		});
	}
	
	markModified();
	refreshSceneGraph();
	recordState();
}

export function highlightInTree(node) {
	const container = document.getElementById("scene-explorer");
	if (!container) return;
	
	container.querySelectorAll("[data-mesh-id]").forEach(el => {
		el.classList.remove("bg-primary/20", "text-primary");
	});
	
	if (node) {
		const el = container.querySelector(`[data-mesh-id="${node.id}"]`);
		if (el) {
			el.classList.add("bg-primary/20", "text-primary");
			// Ensure parent folders are expanded? (Optional, skipping for now)
		}
	}
}
