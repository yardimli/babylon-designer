import { Vector3, BoundingInfo } from "@babylonjs/core";
import { getSelectedNodes } from "./part_selectionManager.js";
import { markModified } from "./part_manager.js";
import { recordState } from "./part_historyManager.js";
import { updateCSG } from "./part_csgManager.js";

// UI Elements
const modal = document.getElementById("align_modal");
const btnMenuAlign = document.getElementById("btn-menu-align");

const axisX = document.getElementById("align-axis-x");
const axisY = document.getElementById("align-axis-y");
const axisZ = document.getElementById("align-axis-z");

const btnMin = document.getElementById("btn-align-min");
const btnCenter = document.getElementById("btn-align-center");
const btnMax = document.getElementById("btn-align-max");
const btnPivot = document.getElementById("btn-align-pivot");

const btnDistCenter = document.getElementById("btn-dist-center");
const btnDistGap = document.getElementById("btn-dist-gap");

const inputSpacing = document.getElementById("align-spacing-val");
const btnApplySpacing = document.getElementById("btn-apply-spacing");

export function setupAlignmentManager() {
	if (!btnMenuAlign) return;

	btnMenuAlign.onclick = () => {
		if (getSelectedNodes().length > 1) {
			modal.showModal();
		}
	};

	// Bind Alignment Buttons
	if (btnMin) btnMin.onclick = () => applyAlignment("min");
	if (btnCenter) btnCenter.onclick = () => applyAlignment("center");
	if (btnMax) btnMax.onclick = () => applyAlignment("max");
	if (btnPivot) btnPivot.onclick = () => applyAlignment("pivot");

	// Bind Distribution Buttons
	if (btnDistCenter) btnDistCenter.onclick = () => applyDistribution("center");
	if (btnDistGap) btnDistGap.onclick = () => applyDistribution("gap");

	// Bind Spacing
	if (btnApplySpacing) btnApplySpacing.onclick = () => applySpacing();
}

// Called by selectionManager to enable/disable button
export function updateAlignButton(selectionCount) {
	if (!btnMenuAlign) return;
	if (selectionCount > 1) {
		btnMenuAlign.classList.remove("btn-disabled");
		btnMenuAlign.disabled = false;
	} else {
		btnMenuAlign.classList.add("btn-disabled");
		btnMenuAlign.disabled = true;
	}
}

function getActiveAxes() {
	return {
		x: axisX ? axisX.checked : false,
		y: axisY ? axisY.checked : false,
		z: axisZ ? axisZ.checked : false
	};
}

function getBounds(node) {
	// Ensure world matrix is updated
	node.computeWorldMatrix(true);

	// If it's a mesh, use bounding box
	if (node.getBoundingInfo) {
		// Refresh bounding info
		node.refreshBoundingInfo(true);
		const bbox = node.getBoundingInfo().boundingBox;
		return {
			min: bbox.minimumWorld,
			max: bbox.maximumWorld,
			center: bbox.centerWorld,
			pivot: node.absolutePosition
		};
	}
	// If it's a TransformNode or Light, use position as point
	else {
		const pos = node.absolutePosition;
		return {
			min: pos,
			max: pos,
			center: pos,
			pivot: pos
		};
	}
}

function applyAlignment(type) {
	const nodes = getSelectedNodes();
	if (nodes.length < 2) return;

	const axes = getActiveAxes();
	if (!axes.x && !axes.y && !axes.z) return;

	// 1. Calculate Selection Group Bounds
	let groupMin = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
	let groupMax = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
	let groupCenterSum = Vector3.Zero();

	const boundsList = nodes.map(n => getBounds(n));

	boundsList.forEach(b => {
		groupMin = Vector3.Minimize(groupMin, b.min);
		groupMax = Vector3.Maximize(groupMax, b.max);
		groupCenterSum.addInPlace(b.center);
	});

	const groupCenter = groupCenterSum.scale(1.0 / nodes.length);
	// Note: "Align Center" usually means align to the average center,
	// or the center of the bounding box ( (min+max)/2 ).
	// Let's use the bounding box center for consistency with Min/Max.
	const groupBBoxCenter = groupMin.add(groupMax).scale(0.5);

	// 2. Apply Transforms
	nodes.forEach((node, i) => {
		const b = boundsList[i];
		const currentPos = node.absolutePosition.clone();
		const targetPos = currentPos.clone();

		["x", "y", "z"].forEach(axis => {
			if (!axes[axis]) return;

			let targetVal = currentPos[axis];

			if (type === "min") {
				// Align object's min to group's min
				// Offset = GroupMin - ObjectMin
				// NewPos = OldPos + Offset
				const offset = groupMin[axis] - b.min[axis];
				targetVal = currentPos[axis] + offset;
			}
			else if (type === "max") {
				// Align object's max to group's max
				const offset = groupMax[axis] - b.max[axis];
				targetVal = currentPos[axis] + offset;
			}
			else if (type === "center") {
				// Align object's center to group's center
				const offset = groupBBoxCenter[axis] - b.center[axis];
				targetVal = currentPos[axis] + offset;
			}
			else if (type === "pivot") {
				// Align object's pivot to group's average pivot (or center)
				// Let's align to groupBBoxCenter for simplicity
				targetVal = groupBBoxCenter[axis];
			}

			targetPos[axis] = targetVal;
		});

		// Apply absolute position (handles parenting automatically in Babylon)
		node.setAbsolutePosition(targetPos);
	});

	finalizeChange();
}

function applyDistribution(type) {
	const nodes = getSelectedNodes();
	if (nodes.length < 3) return; // Need at least 3 to distribute

	const axes = getActiveAxes();
	// Distribution usually happens along one primary axis.
	// If multiple are selected, we do it independently.

	["x", "y", "z"].forEach(axis => {
		if (!axes[axis]) return;

		// 1. Sort nodes by position along this axis
		// We use the center for sorting
		const sorted = [...nodes].map(n => ({ node: n, bounds: getBounds(n) }));
		sorted.sort((a, b) => a.bounds.center[axis] - b.bounds.center[axis]);

		const first = sorted[0];
		const last = sorted[sorted.length - 1];

		if (type === "center") {
			// Distribute centers evenly between first and last
			const totalDist = last.bounds.center[axis] - first.bounds.center[axis];
			const step = totalDist / (sorted.length - 1);

			for (let i = 1; i < sorted.length - 1; i++) {
				const item = sorted[i];
				const targetCenter = first.bounds.center[axis] + (step * i);
				const offset = targetCenter - item.bounds.center[axis];

				const pos = item.node.absolutePosition;
				pos[axis] += offset;
				item.node.setAbsolutePosition(pos);
			}
		}
		else if (type === "gap") {
			// Distribute gaps evenly
			// Total available space = (Last.Min - First.Max) ??
			// Actually, Total Span = Last.Max - First.Min
			// Sum of Widths = Sum(bounds.size)
			// Total Gap Space = Total Span - Sum of Widths
			// Gap = Total Gap Space / (count - 1)

			// However, a simpler "Distribute Gaps" often keeps First and Last fixed
			// and arranges intermediates.

			// Calculate total span between First Max and Last Min
			const startCoord = first.bounds.max[axis];
			const endCoord = last.bounds.min[axis];
			const availableSpace = endCoord - startCoord;

			// Calculate sum of widths of intermediate items
			let sumInterWidths = 0;
			for (let i = 1; i < sorted.length - 1; i++) {
				sumInterWidths += (sorted[i].bounds.max[axis] - sorted[i].bounds.min[axis]);
			}

			const totalGap = availableSpace - sumInterWidths;
			const gap = totalGap / (sorted.length - 1);

			let currentPos = startCoord + gap;

			for (let i = 1; i < sorted.length - 1; i++) {
				const item = sorted[i];
				const width = item.bounds.max[axis] - item.bounds.min[axis];

				// Move item such that its Min is at currentPos
				const offset = currentPos - item.bounds.min[axis];
				const pos = item.node.absolutePosition;
				pos[axis] += offset;
				item.node.setAbsolutePosition(pos);

				currentPos += width + gap;
			}
		}
	});

	finalizeChange();
}

function applySpacing() {
	const nodes = getSelectedNodes();
	if (nodes.length < 2) return;

	const spacing = parseFloat(inputSpacing.value) || 0;
	const axes = getActiveAxes();

	["x", "y", "z"].forEach(axis => {
		if (!axes[axis]) return;

		// Sort by position
		const sorted = [...nodes].map(n => ({ node: n, bounds: getBounds(n) }));
		sorted.sort((a, b) => a.bounds.center[axis] - b.bounds.center[axis]);

		// Keep first item fixed, move others
		let currentPos = sorted[0].bounds.max[axis] + spacing;

		for (let i = 1; i < sorted.length; i++) {
			const item = sorted[i];
			// Move item such that its Min is at currentPos
			const offset = currentPos - item.bounds.min[axis];
			const pos = item.node.absolutePosition;
			pos[axis] += offset;
			item.node.setAbsolutePosition(pos);

			const width = item.bounds.max[axis] - item.bounds.min[axis];
			currentPos += width + spacing;
		}
	});

	finalizeChange();
}

function finalizeChange() {
	updateCSG();
	markModified();
	recordState();
}