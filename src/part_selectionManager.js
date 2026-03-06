import { HighlightLayer, Color3, AbstractMesh } from "@babylonjs/core";
import { part } from "./part.js";
import { updateGizmoAttachment } from "./part_gizmoControl.js";
import { updatePropertyEditor } from "./part_propertyEditor.js";
import { highlightInTree } from "./part_treeViewManager.js";
import { updateAlignButton } from "./part_alignmentManager.js";

let selectedNodes = [];
let highlightLayer = null;

export function getSelectedNodes() {
	return selectedNodes;
}

export function isSelected(node) {
	return selectedNodes.includes(node);
}

export function clearSelection() {
	selectedNodes = [];
	notifySelectionChanged();
}

export function selectNode(node, multi = false) {
	if (!node) {
		clearSelection();
		return;
	}

	if (multi) {
		const index = selectedNodes.indexOf(node);
		if (index > -1) {
			// Toggle off
			selectedNodes.splice(index, 1);
		} else {
			// Toggle on
			selectedNodes.push(node);
		}
	} else {
		// Single selection replace
		selectedNodes = [node];
	}
	notifySelectionChanged();
}

export function setSelection(nodes) {
	selectedNodes = [...nodes];
	notifySelectionChanged();
}

function notifySelectionChanged() {
	// 1. Update Gizmo (Visuals & Controls)
	updateGizmoAttachment(selectedNodes);

	// 2. Update Property Editor (Inputs)
	updatePropertyEditor(selectedNodes);

	// 3. Update Tree View (Highlighting)
	highlightInTree(selectedNodes);

	// 4. Update Alignment Button state
	updateAlignButton(selectedNodes.length);

	// 5. Update Selection Outline
	updateSelectionOutline(selectedNodes);
}

function updateSelectionOutline(nodes) {
	if (!part) return;

	// Lazy initialization of HighlightLayer
	if (!highlightLayer) {
		const existing = part.effectLayers.find(l => l.name === "selectionHighlight");
		if (existing) {
			highlightLayer = existing;
		} else {
			highlightLayer = new HighlightLayer("selectionHighlight", part);
			highlightLayer.innerGlow = false;
			highlightLayer.outerGlow = true;
			highlightLayer.blurHorizontalSize = 0.5;
			highlightLayer.blurVerticalSize = 0.5;
		}
	}

	highlightLayer.removeAllMeshes();

	if (nodes.length === 0) return;

	const selectionColor = new Color3(0, 0.8, 1); // Cyan
	const meshesToHighlight = new Set();

	nodes.forEach(node => {
		// If the node itself is a visible mesh
		if (node instanceof AbstractMesh && isHighlightable(node)) {
			meshesToHighlight.add(node);
		}

		// Add all descendant meshes (useful for TransformNodes)
		node.getChildMeshes(false).forEach(child => {
			if (isHighlightable(child)) {
				meshesToHighlight.add(child);
			}
		});
	});

	meshesToHighlight.forEach(mesh => {
		highlightLayer.addMesh(mesh, selectionColor);
	});
}

function isHighlightable(mesh) {
	// Filter out gizmos, skybox, hidden meshes, etc.
	return mesh.isEnabled() &&
		mesh.isVisible &&
		mesh.name !== "previewSphere" &&
		mesh.name !== "hdrSkyBox" &&
		!mesh.name.startsWith("gizmo_") &&
		!mesh.name.startsWith("bbox_");
}
