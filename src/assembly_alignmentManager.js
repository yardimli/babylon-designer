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

function getNodeBounds(node) {
	if (node instanceof AbstractMesh) {
		node.computeWorldMatrix(true);
		const hierarchy = node.getHierarchyBoundingVectors(true);
		return {
			min: hierarchy.min,
			max: hierarchy.max,
			center: hierarchy.min.add(hierarchy.max).scale(0.5),
			pivot: node.absolutePosition.clone()
		};
	} else {
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

	// 1. Identify Locked Nodes
	const lockedNodes = nodes.filter(n => n.metadata && n.metadata.isLocked);

	// 2. Determine Reference Group (Locked nodes if any, else all)
	const referenceList = lockedNodes.length > 0
		? boundsList.filter(b => b.node.metadata && b.node.metadata.isLocked)
		: boundsList;

	const target = { x: 0, y: 0, z: 0 };

	if (type === "min") {
		target.x = Math.min(...referenceList.map(b => b.bounds.min.x));
		target.y = Math.min(...referenceList.map(b => b.bounds.min.y));
		target.z = Math.min(...referenceList.map(b => b.bounds.min.z));
	} else if (type === "max") {
		target.x = Math.max(...referenceList.map(b => b.bounds.max.x));
		target.y = Math.max(...referenceList.map(b => b.bounds.max.y));
		target.z = Math.max(...referenceList.map(b => b.bounds.max.z));
	} else if (type === "center") {
		const minX = Math.min(...referenceList.map(b => b.bounds.min.x));
		const maxX = Math.max(...referenceList.map(b => b.bounds.max.x));
		const minY = Math.min(...referenceList.map(b => b.bounds.min.y));
		const maxY = Math.max(...referenceList.map(b => b.bounds.max.y));
		const minZ = Math.min(...referenceList.map(b => b.bounds.min.z));
		const maxZ = Math.max(...referenceList.map(b => b.bounds.max.z));
		target.x = (minX + maxX) / 2;
		target.y = (minY + maxY) / 2;
		target.z = (minZ + maxZ) / 2;
	} else if (type === "pivot") {
		let sum = new Vector3(0, 0, 0);
		referenceList.forEach(b => sum.addInPlace(b.bounds.pivot));
		sum.scaleInPlace(1.0 / referenceList.length);
		target.x = sum.x;
		target.y = sum.y;
		target.z = sum.z;
	}

	// Apply
	nodes.forEach(node => {
		// Skip locked nodes
		if (node.metadata && node.metadata.isLocked) return;

		const currentPos = node.absolutePosition;
		const bounds = getNodeBounds(node);
		const newPos = currentPos.clone();

		if (axes.x) {
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
	if (nodes.length < 3) return;

	const axes = getActiveAxes();
	const activeAxisKeys = [];
	if (axes.x) activeAxisKeys.push("x");
	if (axes.y) activeAxisKeys.push("y");
	if (axes.z) activeAxisKeys.push("z");

	activeAxisKeys.forEach(axis => {
		const sorted = [...nodes].sort((a, b) => {
			return getNodeBounds(a).center[axis] - getNodeBounds(b).center[axis];
		});

		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		const firstBounds = getNodeBounds(first);
		const lastBounds = getNodeBounds(last);

		if (type === "center") {
			const startVal = firstBounds.center[axis];
			const endVal = lastBounds.center[axis];
			const span = endVal - startVal;
			const step = span / (sorted.length - 1);

			for (let i = 1; i < sorted.length - 1; i++) {
				const node = sorted[i];
				if (node.metadata && node.metadata.isLocked) continue; // Skip locked

				const currentBounds = getNodeBounds(node);
				const targetVal = startVal + (step * i);
				const offset = targetVal - currentBounds.center[axis];

				const pos = node.absolutePosition.clone();
				pos[axis] += offset;
				node.setAbsolutePosition(pos);
			}
		} else if (type === "gap") {
			const startEdge = firstBounds.min[axis];
			const endEdge = lastBounds.max[axis];
			const totalAvailable = endEdge - startEdge;

			let totalWidth = 0;
			const widths = sorted.map(n => {
				const b = getNodeBounds(n);
				const w = b.max[axis] - b.min[axis];
				totalWidth += w;
				return w;
			});

			const totalGap = totalAvailable - totalWidth;
			const gap = totalGap / (sorted.length - 1);

			let currentEdge = startEdge;
			sorted.forEach((node, i) => {
				if (!node.metadata || !node.metadata.isLocked) {
					const b = getNodeBounds(node);
					const currentMin = b.min[axis];
					const offset = currentEdge - currentMin;

					const pos = node.absolutePosition.clone();
					pos[axis] += offset;
					node.setAbsolutePosition(pos);
				}

				const b = getNodeBounds(node);
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
		const sorted = [...nodes].sort((a, b) => {
			return getNodeBounds(a).center[axis] - getNodeBounds(b).center[axis];
		});

		let prevNode = sorted[0];
		let prevBounds = getNodeBounds(prevNode);
		let currentPos = prevBounds.max[axis] + spacing;

		for (let i = 1; i < sorted.length; i++) {
			const node = sorted[i];
			const b = getNodeBounds(node);

			if (!node.metadata || !node.metadata.isLocked) {
				const offset = currentPos - b.min[axis];
				const pos = node.absolutePosition.clone();
				pos[axis] += offset;
				node.setAbsolutePosition(pos);
			}

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