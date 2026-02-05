import { updateGizmoAttachment } from "./scene_gizmoControl.js";
import { updatePropertyEditor } from "./scene_propertyEditor.js";
import { highlightInTree } from "./scene_treeViewManager.js";

let selectedNodes = [];

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
}
