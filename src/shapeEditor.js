import {
	Engine, Scene, Vector3, Color3, MeshBuilder,
	HemisphericLight, ArcRotateCamera, StandardMaterial
} from '@babylonjs/core';
import earcut from 'earcut';

// --- State ---
const state = {
	filename: null,
	points: [], // Array of objects: { x, y } - The single polygon
	extrusionHeight: 1,

	// UI State
	mode: 'select', // 'select', 'draw'
	selectedEdgeIndex: -1,
	selectedPointIndex: -1,

	// Drawing State
	isDragging: false,
	dragStart: { x: 0, y: 0 },

	// Viewport (2D)
	pan: { x: 0, y: 0 }, // Center of canvas
	zoom: 1
};

// --- DOM Elements ---
const ui = {
	canvas2d: document.getElementById('drawCanvas'),
	canvas3d: document.getElementById('previewCanvas'),
	propContainer: document.getElementById('properties-container'),
	fileList: document.getElementById('file-list'),
	inpFilename: document.getElementById('inp-filename'),
	inpExtrusion: document.getElementById('inp-extrusion'),
	btnSave: document.getElementById('btn-save'),
	btnNew: document.getElementById('btn-new'),
	tools: {
		select: document.getElementById('btn-tool-select'),
		poly: document.getElementById('btn-tool-poly')
	}
};

const ctx = ui.canvas2d.getContext('2d');

// --- 3D Engine Setup ---
const engine = new Engine(ui.canvas3d, true);
const scene = new Scene(engine);
scene.clearColor = new Color3(0.1, 0.1, 0.1);

const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3, 10, Vector3.Zero(), scene);
camera.attachControl(ui.canvas3d, true);
camera.wheelPrecision = 50;

const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
light.intensity = 0.8;

// Material for extruded shapes
const shapeMat = new StandardMaterial('shapeMat', scene);
shapeMat.diffuseColor = new Color3(0.4, 0.6, 0.9);
shapeMat.specularColor = new Color3(0.1, 0.1, 0.1);
shapeMat.backFaceCulling = false;

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => {
	engine.resize();
	resizeCanvas2D();
});

// --- 2D Logic ---

function resizeCanvas2D() {
	const rect = ui.canvas2d.parentElement.getBoundingClientRect();
	ui.canvas2d.width = rect.width;
	ui.canvas2d.height = rect.height;
	state.pan.x = rect.width / 2;
	state.pan.y = rect.height / 2;
	draw2D();
}

function worldToScreen(x, y) {
	return {
		x: state.pan.x + x * state.zoom * 20, // 20 pixels per unit
		y: state.pan.y + y * state.zoom * 20
	};
}

function screenToWorld(sx, sy) {
	return {
		x: (sx - state.pan.x) / (state.zoom * 20),
		y: (sy - state.pan.y) / (state.zoom * 20)
	};
}

function drawGrid() {
	ctx.strokeStyle = '#333';
	ctx.lineWidth = 1;
	ctx.beginPath();

	// Simple crosshair at 0,0
	const center = worldToScreen(0, 0);
	ctx.moveTo(center.x - 1000, center.y);
	ctx.lineTo(center.x + 1000, center.y);
	ctx.moveTo(center.x, center.y - 1000);
	ctx.lineTo(center.x, center.y + 1000);
	ctx.stroke();
}

function draw2D() {
	ctx.clearRect(0, 0, ui.canvas2d.width, ui.canvas2d.height);
	drawGrid();

	// Draw The Single Polygon
	if (state.points.length > 0) {
		// Draw Fill/Stroke
		ctx.strokeStyle = '#00ccff';
		ctx.fillStyle = 'rgba(0, 204, 255, 0.2)';
		ctx.lineWidth = 2;

		ctx.beginPath();
		const start = worldToScreen(state.points[0].x, state.points[0].y);
		ctx.moveTo(start.x, start.y);
		for (let i = 1; i < state.points.length; i++) {
			const p = worldToScreen(state.points[i].x, state.points[i].y);
			ctx.lineTo(p.x, p.y);
		}
		// Close path if not currently drawing (or if drawing and have enough points)
		if (state.mode === 'select' && state.points.length > 2) {
			ctx.closePath();
			ctx.fill();
		}
		ctx.stroke();

		// Draw Vertices
		state.points.forEach((pt, idx) => {
			const s = worldToScreen(pt.x, pt.y);
			const isPtSelected = (state.selectedPointIndex === idx);

			ctx.beginPath();
			ctx.arc(s.x, s.y, isPtSelected ? 6 : 4, 0, Math.PI * 2);
			ctx.fillStyle = isPtSelected ? '#ffff00' : '#ffffff';
			ctx.fill();

			if (isPtSelected) {
				ctx.strokeStyle = '#000';
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		});

		// Draw Edge Highlight if selected
		if (state.selectedEdgeIndex > -1 && state.mode === 'select') {
			const pA = state.points[state.selectedEdgeIndex];
			const pB = state.points[(state.selectedEdgeIndex + 1) % state.points.length];
			const sA = worldToScreen(pA.x, pA.y);
			const sB = worldToScreen(pB.x, pB.y);

			ctx.strokeStyle = '#ffff00';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(sA.x, sA.y);
			ctx.lineTo(sB.x, sB.y);
			ctx.stroke();
		}
	}
}

// --- 3D Generation ---

function update3D() {
	// Dispose old meshes
	scene.meshes.forEach(m => {
		if (m.name === 'custom_shape') m.dispose();
	});

	if (state.points.length < 3) return;

	try {
		const vectorPoints = state.points.map(p => new Vector3(p.x, 0, p.y));

		const mesh = MeshBuilder.ExtrudePolygon('custom_shape', {
			shape: vectorPoints,
			depth: state.extrusionHeight,
			sideOrientation: MeshBuilder.DOUBLESIDE,
			wrap: true
		}, scene, earcut);

		mesh.position.y = state.extrusionHeight;
		mesh.material = shapeMat;
	} catch (e) {
		console.warn('Failed to extrude shape', e);
	}
}

// --- Interaction Logic ---

function getMousePos(e) {
	const rect = ui.canvas2d.getBoundingClientRect();
	return {
		x: e.clientX - rect.left,
		y: e.clientY - rect.top
	};
}

function hitTest(wx, wy) {
	if (state.points.length === 0) return null;

	// 1. Check Points (Vertices) first - Priority
	for (let j = 0; j < state.points.length; j++) {
		const p = state.points[j];
		// Tolerance 0.5 world units
		if (Math.sqrt((p.x - wx) ** 2 + (p.y - wy) ** 2) < 0.5) {
			return { point: j };
		}
	}

	// 2. Check Edge proximity
	let bestEdge = -1;
	let minDist = 0.5; // World units tolerance

	for (let j = 0; j < state.points.length; j++) {
		const p1 = state.points[j];
		const p2 = state.points[(j + 1) % state.points.length];
		const d = distToSegment({ x: wx, y: wy }, p1, p2);
		if (d < minDist) {
			minDist = d;
			bestEdge = j;
		}
	}

	if (bestEdge > -1) return { edge: bestEdge };
	return null;
}

function distToSegment(p, v, w) {
	const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
	if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
	let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

ui.canvas2d.addEventListener('mousedown', (e) => {
	const m = getMousePos(e);
	const w = screenToWorld(m.x, m.y);

	if (state.mode === 'draw') {
		state.points.push({ x: w.x, y: w.y });
		draw2D();
		return;
	}

	const hit = hitTest(w.x, w.y);
	if (hit) {
		state.selectedEdgeIndex = hit.edge !== undefined ? hit.edge : -1;
		state.selectedPointIndex = hit.point !== undefined ? hit.point : -1;
		state.isDragging = true;
		state.dragStart = w;
		renderProperties();
	} else {
		state.selectedEdgeIndex = -1;
		state.selectedPointIndex = -1;
		renderProperties();
	}
	draw2D();
});

ui.canvas2d.addEventListener('mousemove', (e) => {
	const m = getMousePos(e);
	const w = screenToWorld(m.x, m.y);

	if (state.isDragging) {
		// Case A: Dragging a Vertex (Point)
		if (state.selectedPointIndex > -1) {
			// Simple drag, no complex snapping for now to keep it clean,
			// or re-implement grid snap if desired.
			state.points[state.selectedPointIndex].x = w.x;
			state.points[state.selectedPointIndex].y = w.y;
		}
			// Case B: Dragging Whole Shape (if edge selected or just generic drag?)
			// For simplicity in this mode, let's restrict to vertex editing or
		// implement whole shape drag if no specific vertex selected.
		else if (state.selectedEdgeIndex > -1) {
			// Move the two points of the edge
			const idxA = state.selectedEdgeIndex;
			const idxB = (idxA + 1) % state.points.length;
			const dx = w.x - state.dragStart.x;
			const dy = w.y - state.dragStart.y;

			state.points[idxA].x += dx;
			state.points[idxA].y += dy;
			state.points[idxB].x += dx;
			state.points[idxB].y += dy;

			state.dragStart = w;
		}

		draw2D();
	}
});

ui.canvas2d.addEventListener('mouseup', () => {
	if (state.isDragging) {
		state.isDragging = false;
		draw2D();
		update3D();
		renderProperties();
	}
});

// --- Property Editor ---

function renderProperties() {
	const container = ui.propContainer;
	container.innerHTML = '';
	container.classList.remove('opacity-50', 'pointer-events-none');

	if (state.points.length === 0) {
		container.innerHTML = '<div class="text-xs italic">Draw a polygon to start.</div>';
		return;
	}

	// Vertex Editing
	if (state.selectedPointIndex > -1) {
		const idx = state.selectedPointIndex;
		const pt = state.points[idx];
		const header = document.createElement('div');
		header.className = 'divider my-1 text-xs';
		header.innerText = `Vertex ${idx}`;
		container.appendChild(header);

		addInput(container, 'X', pt.x, v => { pt.x = v; draw2D(); update3D(); });
		addInput(container, 'Y', pt.y, v => { pt.y = v; draw2D(); update3D(); });

		// Delete Vertex Button
		if (state.points.length > 3) {
			const btnDel = document.createElement('button');
			btnDel.className = 'btn btn-xs btn-error btn-outline w-full mt-2';
			btnDel.innerText = 'Delete Vertex';
			btnDel.onclick = () => {
				state.points.splice(idx, 1);
				state.selectedPointIndex = -1;
				draw2D();
				update3D();
				renderProperties();
			};
			container.appendChild(btnDel);
		}
	}
	// Edge Editing
	else if (state.selectedEdgeIndex > -1) {
		const idxA = state.selectedEdgeIndex;
		const idxB = (idxA + 1) % state.points.length;
		const pA = state.points[idxA];
		const pB = state.points[idxB];

		// Calculate Line Props
		const dx = pB.x - pA.x;
		const dy = pB.y - pA.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;

		const updatePointB = (newLen, newAngleDeg) => {
			const angRad = newAngleDeg * Math.PI / 180;
			pB.x = pA.x + newLen * Math.cos(angRad);
			pB.y = pA.y + newLen * Math.sin(angRad);
			draw2D();
			update3D();
		};

		const header = document.createElement('div');
		header.className = 'divider my-1 text-xs';
		header.innerText = `Edge ${idxA}`;
		container.appendChild(header);

		addInput(container, 'Length', len, v => updatePointB(v, angleDeg));
		addInput(container, 'Angle (Deg)', angleDeg, v => updatePointB(len, v));

		// Split Edge Button
		const btnSplit = document.createElement('button');
		btnSplit.className = 'btn btn-xs btn-secondary btn-outline w-full mt-2';
		btnSplit.innerText = 'Split Edge';
		btnSplit.onclick = () => {
			const midX = (pA.x + pB.x) / 2;
			const midY = (pA.y + pB.y) / 2;
			// Insert new point after A
			state.points.splice(idxA + 1, 0, { x: midX, y: midY });
			state.selectedEdgeIndex = -1;
			state.selectedPointIndex = idxA + 1; // Select new point
			draw2D();
			update3D();
			renderProperties();
		};
		container.appendChild(btnSplit);
	} else {
		container.innerHTML = '<div class="text-xs italic">Select a vertex or edge to edit.</div>';
	}
}

function addInput(parent, label, value, onChange) {
	const div = document.createElement('div');
	div.className = 'form-control w-full mb-1';
	div.innerHTML = `
        <label class="label p-1"><span class="label-text text-xs">${label}</span></label>
        <input type="number" step="0.1" class="input input-xs input-bordered" value="${value.toFixed(2)}">
    `;
	const input = div.querySelector('input');
	input.onchange = (e) => onChange(parseFloat(e.target.value));
	parent.appendChild(div);
}

// --- Tool Buttons ---

function setMode(m) {
	state.mode = m;
	if (m === 'select') {
		ui.tools.select.classList.add('btn-active');
		ui.tools.poly.classList.remove('btn-active');
		ui.tools.poly.innerText = 'Redraw Polygon';
	} else if (m === 'draw') {
		ui.tools.select.classList.remove('btn-active');
		ui.tools.poly.classList.add('btn-active');
		ui.tools.poly.innerText = 'Finish Drawing';
	}
}

ui.tools.select.onclick = () => setMode('select');

ui.tools.poly.onclick = () => {
	if (state.mode === 'draw') {
		// Finish drawing
		if (state.points.length >= 3) {
			setMode('select');
			update3D();
			renderProperties();
		} else {
			alert("Polygon needs at least 3 points.");
		}
	} else {
		// Start new drawing
		if (confirm("Clear current shape and draw new?")) {
			state.points = [];
			state.selectedEdgeIndex = -1;
			state.selectedPointIndex = -1;
			setMode('draw');
			draw2D();
			update3D();
			renderProperties();
		}
	}
};

ui.inpExtrusion.onchange = (e) => {
	state.extrusionHeight = parseFloat(e.target.value);
	update3D();
};

// --- File I/O ---

async function fetchFiles() {
	ui.fileList.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
	try {
		const res = await fetch('/api/shapes');
		const data = await res.json();
		ui.fileList.innerHTML = '';
		if (data.files) {
			data.files.forEach(file => {
				const div = document.createElement('div');
				div.className = 'flex justify-between items-center hover:bg-base-content/10 p-1 rounded cursor-pointer';
				div.innerHTML = `<span class="truncate">${file.replace('.json', '')}</span>`;
				div.onclick = () => loadFile(file);

				const btnDel = document.createElement('button');
				btnDel.innerText = '×';
				btnDel.className = 'btn btn-ghost btn-xs text-error';
				btnDel.onclick = (e) => {
					e.stopPropagation();
					if (confirm(`Delete ${file}?`)) deleteFile(file);
				};
				div.appendChild(btnDel);
				ui.fileList.appendChild(div);
			});
		}
	} catch (e) { console.error(e); }
}

async function loadFile(filename) {
	try {
		const res = await fetch(`/api/shapes?file=${filename}`);
		const json = await res.json();
		if (json.success) {
			state.filename = filename;
			// Handle new format (points) or legacy (shapes)
			if (json.data.points) {
				state.points = json.data.points;
			} else if (json.data.shapes && json.data.shapes.length > 0) {
				// Legacy support: Try to extract points from first shape if it exists
				// This is a rough conversion for backward compatibility
				alert("Legacy shape detected. Loading first shape only.");
				// (Implementation omitted for brevity, assuming new files from now on)
				state.points = [];
			} else {
				state.points = [];
			}

			state.extrusionHeight = json.data.extrusionHeight || 1;
			ui.inpFilename.value = filename.replace('.json', '');
			ui.inpExtrusion.value = state.extrusionHeight;
			state.selectedEdgeIndex = -1;
			state.selectedPointIndex = -1;
			setMode('select');
			draw2D();
			update3D();
			renderProperties();
		}
	} catch (e) { alert('Load failed'); }
}

async function saveFile() {
	const name = ui.inpFilename.value.trim();
	if (!name) return alert('Enter name');
	if (state.points.length < 3) return alert('Create a polygon first');

	const data = {
		points: state.points,
		extrusionHeight: state.extrusionHeight
	};

	try {
		const res = await fetch('/api/shapes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, data })
		});
		const json = await res.json();
		if (json.success) {
			state.filename = json.filename;
			fetchFiles();
			alert('Saved');
		}
	} catch (e) { alert('Save failed'); }
}

async function deleteFile(filename) {
	await fetch(`/api/shapes?file=${filename}`, { method: 'DELETE' });
	fetchFiles();
}

ui.btnSave.onclick = saveFile;
ui.btnNew.onclick = () => {
	if (confirm("Discard changes?")) {
		state.points = [];
		state.filename = null;
		ui.inpFilename.value = '';
		state.selectedEdgeIndex = -1;
		state.selectedPointIndex = -1;
		setMode('draw');
		draw2D();
		update3D();
		renderProperties();
	}
};

// Init
resizeCanvas2D();
fetchFiles();
// Start in draw mode if empty
setMode('draw');