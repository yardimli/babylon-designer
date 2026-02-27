import { Vector3, AbstractMesh } from "@babylonjs/core";
import { getSelectedNodes } from "./assembly_selectionManager.js";
import { recordState } from "./assembly_historyManager.js";
import { markModified } from "./assembly_manager.js";
import { updateCSG } from "./assembly_csgManager.js";
import { scene } from "./assembly_scene.js";

let btnAlign = null;
let alignModal = null;

// UI Elements
let cbAxisX, cbAxisY, cbAxisZ;
let inputSpacing;

export function setupAlignmentManager() {
	btnAlign = document.getElementById("btn-menu-align");
	alignModal = document.getElementById("align_modal");

	if (btnAlign) {
		btnAlign.onclick = () => {
			if (getSelectedNodes().length > 1) {
				alignModal.showModal();
			}
		};
	}

	// Bind Modal Controls
	cbAxisX = document.getElementById("align-axis-x");
	cbAxisY = document.getElementById("align-axis-y");
	cbAxisZ = document.getElementById("align-axis-z");
	inputSpacing = document.getElementById("align-spacing-val");

	// Row 2: Alignment
	const bindAlign = (id, type) => {
		const btn = document.getElementById(id);
		if (btn) btn.onclick = () => performAlignment(type);
	};
	bindAlign("btn-align-min", "min");
	bindAlign("btn-align-center", "center");
	bindAlign("btn-align-max", "max");
	bindAlign("btn-align-pivot", "pivot");

	// Row 3: Distribution
	const bindDist = (id, type) => {
		const btn = document.getElementById(id);
		if (btn) btn.onclick = () => performDistribution(type);
	};
	bindDist("btn-dist-center", "center");
	bindDist("btn-dist-gap", "gap");

	// Row 4: Spacing
	const btnSpace = document.getElementById("btn-apply-spacing");
	if (btnSpace) btnSpace.onclick = () => performSpacing();
}

// Called by selectionManager when selection changes
export function updateAlignButton(selectedCount) {
	if (!btnAlign) return;
	if (selectedCount > 1) {
		btnAlign.classList.remove("btn-disabled");
		btnAlign.disabled = false;
	} else {
		btnAlign.classList.add("btn-disabled");
		btnAlign.disabled = true;
	}
}

function getActiveAxes() {
	return {
		x: cbAxisX ? cbAxisX.checked : false,
		y: cbAxisY ? cbAxisY.checked : false,
		z: cbAxisZ ? cbAxisZ.checked : false
	};
}

// Helper to get world bounds or position for a node
function getNodeBounds(node) {
	if (node instanceof AbstractMesh) {
		// Force world matrix update to ensure bounds are correct
		node.computeWorldMatrix(true);
		const hierarchy = node.getHierarchyBoundingVectors(true); // Include children
		return {
			min: hierarchy.min,
			max: hierarchy.max,
			center: hierarchy.min.add(hierarchy.max).scale(0.5),
			pivot: node.absolutePosition.clone()
		};
	} else {
		// TransformNode (use position as min/max/center)
		node.computeWorldMatrix(true);
		const pos = node.absolutePosition.clone();
		return {
			min: pos,
			max: pos,
			center: pos,
			pivot: pos
		};
	}
}

function performAlignment(type) {
	const nodes = getSelectedNodes();
	if (nodes.length < 2) return;

	const axes = getActiveAxes();
	const boundsList = nodes.map(n => ({ node: n, bounds: getNodeBounds(n) }));

	// Calculate target value based on all selected nodes
	const target = { x: 0, y: 0, z: 0 };

	if (type === "min") {
		target.x = Math.min(...boundsList.map(b => b.bounds.min.x));
		target.y = Math.min(...boundsList.map(b => b.bounds.min.y));
		target.z = Math.min(...boundsList.map(b => b.bounds.min.z));
	} else if (type === "max") {
		target.x = Math.max(...boundsList.map(b => b.bounds.max.x));
		target.y = Math.max(...boundsList.map(b => b.bounds.max.y));
		target.z = Math.max(...boundsList.map(b => b.bounds.max.z));
	} else if (type === "center") {
		// Average center of the selection bounds
		const minX = Math.min(...boundsList.map(b => b.bounds.min.x));
		const maxX = Math.max(...boundsList.map(b => b.bounds.max.x));
		const minY = Math.min(...boundsList.map(b => b.bounds.min.y));
		const maxY = Math.max(...boundsList.map(b => b.bounds.max.y));
		const minZ = Math.min(...boundsList.map(b => b.bounds.min.z));
		const maxZ = Math.max(...boundsList.map(b => b.bounds.max.z));
		target.x = (minX + maxX) / 2;
		target.y = (minY + maxY) / 2;
		target.z = (minZ + maxZ) / 2;
	} else if (type === "pivot") {
		// Average pivot point
		let sum = new Vector3(0, 0, 0);
		boundsList.forEach(b => sum.addInPlace(b.bounds.pivot));
		sum.scaleInPlace(1.0 / boundsList.length);
		target.x = sum.x;
		target.y = sum.y;
		target.z = sum.z;
	}

	// Apply
	nodes.forEach(node => {
		const currentPos = node.absolutePosition;
		const bounds = getNodeBounds(node);
		const newPos = currentPos.clone();

		// Calculate offset required to move the specific feature to the target
		// NewPos = Target - (FeaturePos - CurrentPos)
		//        = CurrentPos + (Target - FeaturePos)

		if (axes.x) {
			// FIXED: Removed incorrect .bounds property access
			let featureX = (type === "min") ? bounds.min.x : (type === "max") ? bounds.max.x : (type === "center") ? bounds.center.x : bounds.pivot.x;
			newPos.x = currentPos.x + (target.x - featureX);
		}
		if (axes.y) {
			let featureY = (type === "min") ? bounds.min.y : (type === "max") ? bounds.max.y : (type === "center") ? bounds.center.y : bounds.pivot.y;
			newPos.y = currentPos.y + (target.y - featureY);
		}
		if (axes.z) {
			let featureZ = (type === "min") ? bounds.min.z : (type === "max") ? bounds.max.z : (type === "center") ? bounds.center.z : bounds.pivot.z;
			newPos.z = currentPos.z + (target.z - featureZ);
		}

		node.setAbsolutePosition(newPos);
	});

	finalizeOperation();
}

function performDistribution(type) {
	const nodes = getSelectedNodes();
	if (nodes.length < 3) return; // Need at least 3 to distribute

	const axes = getActiveAxes();
	const activeAxisKeys = [];
	if (axes.x) activeAxisKeys.push("x");
	if (axes.y) activeAxisKeys.push("y");
	if (axes.z) activeAxisKeys.push("z");

	activeAxisKeys.forEach(axis => {
		// Sort nodes by position on this axis
		const sorted = [...nodes].sort((a, b) => {
			return getNodeBounds(a).center[axis] - getNodeBounds(b).center[axis];
		});

		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		const firstBounds = getNodeBounds(first);
		const lastBounds = getNodeBounds(last);

		if (type === "center") {
			// Distribute centers evenly between first and last
			const startVal = firstBounds.center[axis];
			const endVal = lastBounds.center[axis];
			const span = endVal - startVal;
			const step = span / (sorted.length - 1);

			for (let i = 1; i < sorted.length - 1; i++) {
				const node = sorted[i];
				const currentBounds = getNodeBounds(node);
				const targetVal = startVal + (step * i);
				const offset = targetVal - currentBounds.center[axis];

				const pos = node.absolutePosition.clone();
				pos[axis] += offset;
				node.setAbsolutePosition(pos);
			}
		} else if (type === "gap") {
			// Distribute gaps evenly
			// Total Span = (Last Max - First Min)
			// Total Object Size = Sum of (Max - Min) for all objects
			// Total Gap Space = Total Span - Total Object Size
			// Gap = Total Gap Space / (Count - 1)

			// 1. Find total span from "start of first" to "end of last"
			const startEdge = firstBounds.min[axis];
			const endEdge = lastBounds.max[axis];
			const totalAvailable = endEdge - startEdge;

			// 2. Sum widths of all objects
			let totalWidth = 0;
			const widths = sorted.map(n => {
				const b = getNodeBounds(n);
				const w = b.max[axis] - b.min[axis];
				totalWidth += w;
				return w;
			});

			// 3. Calculate gap
			const totalGap = totalAvailable - totalWidth;
			const gap = totalGap / (sorted.length - 1);

			// 4. Position
			let currentEdge = startEdge;
			sorted.forEach((node, i) => {
				// First node stays put (conceptually), but we align it to ensure exact math
				// We align the Min edge of the node to currentEdge
				const b = getNodeBounds(node);
				const currentMin = b.min[axis];
				const offset = currentEdge - currentMin;

				const pos = node.absolutePosition.clone();
				pos[axis] += offset;
				node.setAbsolutePosition(pos);

				// Advance edge
				currentEdge += (b.max[axis] - b.min[axis]) + gap;
			});
		}
	});

	finalizeOperation();
}

function performSpacing() {
	const nodes = getSelectedNodes();
	if (nodes.length < 2) return;

	const spacing = parseFloat(inputSpacing.value) || 0;
	const axes = getActiveAxes();
	const activeAxisKeys = [];
	if (axes.x) activeAxisKeys.push("x");
	if (axes.y) activeAxisKeys.push("y");
	if (axes.z) activeAxisKeys.push("z");

	activeAxisKeys.forEach(axis => {
		// Sort nodes by position on this axis
		const sorted = [...nodes].sort((a, b) => {
			return getNodeBounds(a).center[axis] - getNodeBounds(b).center[axis];
		});

		// Start from the first object's position + size
		let prevNode = sorted[0];
		let prevBounds = getNodeBounds(prevNode);
		let currentPos = prevBounds.max[axis] + spacing;

		for (let i = 1; i < sorted.length; i++) {
			const node = sorted[i];
			const b = getNodeBounds(node);

			// Move node so its Min equals currentPos
			const offset = currentPos - b.min[axis];
			const pos = node.absolutePosition.clone();
			pos[axis] += offset;
			node.setAbsolutePosition(pos);

			// Update for next
			const width = b.max[axis] - b.min[axis];
			currentPos += width + spacing;
		}
	});

	finalizeOperation();
}

function finalizeOperation() {
	updateCSG();
	markModified();
	recordState();
}