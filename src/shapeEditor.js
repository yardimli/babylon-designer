import {
	Engine, Scene, Vector3, Color3, MeshBuilder,
	HemisphericLight, ArcRotateCamera, StandardMaterial, Vector2
} from '@babylonjs/core';
import earcut from 'earcut';

// --- State ---
const state = {
	filename: null,
	shapes: [], // Array of objects: { type: 'rect'|'circle'|'poly', isHole: boolean, ...props }
	extrusionHeight: 1,

	// UI State
	mode: 'select', // 'select', 'draw_poly'
	selectedShapeIndex: -1,
	selectedEdgeIndex: -1, // Only for polygons

	// Drawing State
	isDragging: false,
	dragStart: { x: 0, y: 0 },
	polyPoints: [], // Temp points for drawing new polygon

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
	btnDelete: document.getElementById('btn-delete-shape'),
	tools: {
		select: document.getElementById('btn-tool-select'),
		rect: document.getElementById('btn-tool-rect'),
		circle: document.getElementById('btn-tool-circle'),
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

	// Draw Shapes
	state.shapes.forEach((shape, index) => {
		const isSelected = state.selectedShapeIndex === index;
		//  Visual distinction for holes
		const isHole = shape.isHole;

		if (isSelected) {
			ctx.strokeStyle = isHole ? '#ff4444' : '#00ccff';
			ctx.fillStyle = isHole ? 'rgba(255, 68, 68, 0.2)' : 'rgba(0, 204, 255, 0.2)';
			ctx.lineWidth = 2;
		} else {
			ctx.strokeStyle = isHole ? '#aa4444' : '#ffffff';
			ctx.fillStyle = isHole ? 'rgba(170, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)';
			ctx.lineWidth = 1;
		}

		if (shape.type === 'rect') {
			const p1 = worldToScreen(shape.x, shape.y);
			const p2 = worldToScreen(shape.x + shape.w, shape.y + shape.h);
			ctx.beginPath();
			ctx.rect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
			ctx.fill();
			ctx.stroke();
		} else if (shape.type === 'circle') {
			const c = worldToScreen(shape.x, shape.y);
			const r = (shape.diameter / 2) * state.zoom * 20;
			ctx.beginPath();
			ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		} else if (shape.type === 'poly') {
			if (shape.points.length < 2) return;
			ctx.beginPath();
			const start = worldToScreen(shape.points[0].x, shape.points[0].y);
			ctx.moveTo(start.x, start.y);
			for (let i = 1; i < shape.points.length; i++) {
				const p = worldToScreen(shape.points[i].x, shape.points[i].y);
				ctx.lineTo(p.x, p.y);
			}
			ctx.closePath();
			ctx.fill();
			ctx.stroke();

			// Draw Edge Highlight if selected
			if (isSelected && state.selectedEdgeIndex > -1) {
				const pA = shape.points[state.selectedEdgeIndex];
				const pB = shape.points[(state.selectedEdgeIndex + 1) % shape.points.length];
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
	});

	// Draw Temp Poly
	if (state.mode === 'draw_poly' && state.polyPoints.length > 0) {
		ctx.strokeStyle = '#ffff00';
		ctx.lineWidth = 1;
		ctx.beginPath();
		const start = worldToScreen(state.polyPoints[0].x, state.polyPoints[0].y);
		ctx.moveTo(start.x, start.y);
		for (let i = 1; i < state.polyPoints.length; i++) {
			const p = worldToScreen(state.polyPoints[i].x, state.polyPoints[i].y);
			ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();

		// Draw points
		ctx.fillStyle = '#ffff00';
		state.polyPoints.forEach(pt => {
			const s = worldToScreen(pt.x, pt.y);
			ctx.beginPath();
			ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
			ctx.fill();
		});
	}
}

// --- 3D Generation ---

// Helper to convert shape object to Vector3 array
function getPointsFromShape(shape) {
	const points = [];
	if (shape.type === 'rect') {
		points.push(
			new Vector3(shape.x, 0, shape.y),
			new Vector3(shape.x + shape.w, 0, shape.y),
			new Vector3(shape.x + shape.w, 0, shape.y + shape.h),
			new Vector3(shape.x, 0, shape.y + shape.h)
		);
	} else if (shape.type === 'circle') {
		const segments = 32;
		const r = shape.diameter / 2;
		for (let j = 0; j < segments; j++) {
			const theta = (j / segments) * Math.PI * 2;
			points.push(new Vector3(
				shape.x + Math.cos(theta) * r,
				0,
				shape.y + Math.sin(theta) * r
			));
		}
	} else if (shape.type === 'poly') {
		shape.points.forEach(p => points.push(new Vector3(p.x, 0, p.y)));
	}
	return points;
}

// Helper: Check if point is inside polygon (Ray casting)
function isPointInPoly(pt, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x; const yi = poly[i].z;
		const xj = poly[j].x; const yj = poly[j].z;
		const intersect = ((yi > pt.z) !== (yj > pt.z)) &&
			(pt.x < (xj - xi) * (pt.z - yi) / (yj - yi) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
}

function update3D() {
	// Dispose old meshes
	scene.meshes.forEach(m => {
		if (m.name.startsWith('shape_')) m.dispose();
	});

	const solids = [];
	const holes = [];

	// 1. Convert all shapes to points and separate
	state.shapes.forEach((shape, i) => {
		const points = getPointsFromShape(shape);
		if (points.length < 3) return;

		if (shape.isHole) {
			holes.push({ points, originalIndex: i });
		} else {
			solids.push({ points, originalIndex: i, myHoles: [] });
		}
	});

	// 2. Assign holes to solids
	// Simple logic: If the first point of the hole is inside the solid, it belongs to it.
	holes.forEach(hole => {
		// Find a solid that contains this hole
		// Reverse iterate to find the "top-most" or most recently added solid that contains it (layering)
		// Or just find the first one.
		for (const solid of solids) {
			if (isPointInPoly(hole.points[0], solid.points)) {
				solid.myHoles.push(hole.points);
				break; // Assign to one solid only
			}
		}
	});

	// 3. Extrude Solids
	solids.forEach((solid, i) => {
		try {
			const mesh = MeshBuilder.ExtrudePolygon(`shape_${solid.originalIndex}`, {
				shape: solid.points,
				holes: solid.myHoles,
				depth: state.extrusionHeight,
				sideOrientation: MeshBuilder.DOUBLESIDE,
				wrap: true
			}, scene, earcut);

			mesh.position.y = state.extrusionHeight;
			mesh.material = shapeMat;
		} catch (e) {
			console.warn('Failed to extrude shape', e);
		}
	});
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
	// Reverse iterate to select top-most
	for (let i = state.shapes.length - 1; i >= 0; i--) {
		const s = state.shapes[i];
		if (s.type === 'rect') {
			if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return { index: i };
		} else if (s.type === 'circle') {
			const dx = wx - s.x;
			const dy = wy - s.y;
			if (Math.sqrt(dx * dx + dy * dy) <= s.diameter / 2) return { index: i };
		} else if (s.type === 'poly') {
			// Point in poly (Ray casting)
			let inside = false;
			for (let j = 0, k = s.points.length - 1; j < s.points.length; k = j++) {
				const xi = s.points[j].x; const yi = s.points[j].y;
				const xj = s.points[k].x; const yj = s.points[k].y;
				const intersect = ((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi);
				if (intersect) inside = !inside;
			}

			// Check edge proximity
			let bestEdge = -1;
			let minDist = 0.5; // World units tolerance

			for (let j = 0; j < s.points.length; j++) {
				const p1 = s.points[j];
				const p2 = s.points[(j + 1) % s.points.length];
				const d = distToSegment({ x: wx, y: wy }, p1, p2);
				if (d < minDist) {
					minDist = d;
					bestEdge = j;
				}
			}

			if (bestEdge > -1) return { index: i, edge: bestEdge };
			if (inside) return { index: i, edge: -1 };
		}
	}
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

	if (state.mode === 'draw_poly') {
		state.polyPoints.push({ x: w.x, y: w.y });
		draw2D();
		return;
	}

	const hit = hitTest(w.x, w.y);
	if (hit) {
		state.selectedShapeIndex = hit.index;
		state.selectedEdgeIndex = hit.edge !== undefined ? hit.edge : -1;
		state.isDragging = true;
		state.dragStart = w;
		renderProperties();
	} else {
		state.selectedShapeIndex = -1;
		state.selectedEdgeIndex = -1;
		renderProperties();
	}
	draw2D();
});

ui.canvas2d.addEventListener('mousemove', (e) => {
	const m = getMousePos(e);
	const w = screenToWorld(m.x, m.y);

	if (state.isDragging && state.selectedShapeIndex > -1) {
		const dx = w.x - state.dragStart.x;
		const dy = w.y - state.dragStart.y;

		const shape = state.shapes[state.selectedShapeIndex];

		if (shape.type === 'poly') {
			shape.points.forEach(p => {
				p.x += dx;
				p.y += dy;
			});
		} else {
			shape.x += dx;
			shape.y += dy;
		}

		state.dragStart = w;
		draw2D();
		// Debounce 3D update? For now update on mouseup
	} else if (state.mode === 'draw_poly') {
		// Preview line?
	}
});

ui.canvas2d.addEventListener('mouseup', () => {
	if (state.isDragging) {
		state.isDragging = false;
		update3D();
		renderProperties(); // Update positions in UI
	}
});

// --- Property Editor ---

function renderProperties() {
	const container = ui.propContainer;
	container.innerHTML = '';

	ui.btnDelete.classList.add('hidden');
	container.classList.remove('opacity-50', 'pointer-events-none');

	if (state.selectedShapeIndex === -1) {
		container.innerHTML = '<div class="text-xs italic">Select a shape to edit</div>';
		container.classList.add('opacity-50', 'pointer-events-none');
		return;
	}

	ui.btnDelete.classList.remove('hidden');
	const shape = state.shapes[state.selectedShapeIndex];

	// Common Header
	const typeLabel = document.createElement('div');
	typeLabel.className = 'font-bold text-sm mb-2 uppercase text-secondary';
	typeLabel.innerText = shape.type;
	container.appendChild(typeLabel);

	//  Hole Toggle
	const holeDiv = document.createElement('div');
	holeDiv.className = 'form-control w-full mb-2';
	holeDiv.innerHTML = `
    <label class="label cursor-pointer justify-start gap-2">
        <span class="label-text text-xs font-bold">Is Hole?</span>
        <input type="checkbox" class="checkbox checkbox-xs checkbox-error" ${shape.isHole ? 'checked' : ''}>
    </label>
  `;
	holeDiv.querySelector('input').onchange = (e) => {
		shape.isHole = e.target.checked;
		draw2D();
		update3D();
	};
	container.appendChild(holeDiv);

	if (shape.type === 'rect') {
		addInput(container, 'X', shape.x, v => { shape.x = v; draw2D(); update3D(); });
		addInput(container, 'Y', shape.y, v => { shape.y = v; draw2D(); update3D(); });
		addInput(container, 'Width', shape.w, v => { shape.w = v; draw2D(); update3D(); });
		addInput(container, 'Height', shape.h, v => { shape.h = v; draw2D(); update3D(); });
	} else if (shape.type === 'circle') {
		addInput(container, 'Center X', shape.x, v => { shape.x = v; draw2D(); update3D(); });
		addInput(container, 'Center Y', shape.y, v => { shape.y = v; draw2D(); update3D(); });
		addInput(container, 'Diameter', shape.diameter, v => { shape.diameter = v; draw2D(); update3D(); });
	} else if (shape.type === 'poly') {
		container.innerHTML += '<div class="text-xs mb-2">Select an edge on the canvas to edit line properties.</div>';

		if (state.selectedEdgeIndex > -1) {
			const idxA = state.selectedEdgeIndex;
			const idxB = (idxA + 1) % shape.points.length;
			const pA = shape.points[idxA];
			const pB = shape.points[idxB];

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

			addInput(container, 'Start X', pA.x, v => {
				const diff = v - pA.x;
				pA.x = v;
				// Move B too to keep line same? No, user wants to move point A.
				// But prompt says "line x,y position". Usually means start point.
				draw2D(); update3D();
			});
			addInput(container, 'Start Y', pA.y, v => { pA.y = v; draw2D(); update3D(); });

			addInput(container, 'Length', len, v => updatePointB(v, angleDeg));
			addInput(container, 'Angle (Deg)', angleDeg, v => updatePointB(len, v));
		}
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
	Object.values(ui.tools).forEach(b => b.classList.remove('btn-active'));

	if (m === 'select') ui.tools.select.classList.add('btn-active');
	else if (m === 'draw_poly') ui.tools.poly.classList.add('btn-active');

	// Reset temp poly
	if (m !== 'draw_poly' && state.polyPoints.length > 0) {
		state.polyPoints = [];
		draw2D();
	}
}

ui.tools.select.onclick = () => setMode('select');

ui.tools.rect.onclick = () => {
	state.shapes.push({ type: 'rect', x: -2, y: -2, w: 4, h: 4, isHole: false });
	state.selectedShapeIndex = state.shapes.length - 1;
	setMode('select');
	draw2D();
	update3D();
	renderProperties();
};

ui.tools.circle.onclick = () => {
	state.shapes.push({ type: 'circle', x: 0, y: 0, diameter: 4, isHole: false });
	state.selectedShapeIndex = state.shapes.length - 1;
	setMode('select');
	draw2D();
	update3D();
	renderProperties();
};

ui.tools.poly.onclick = () => {
	if (state.mode === 'draw_poly') {
		// Finish drawing
		if (state.polyPoints.length >= 3) {
			state.shapes.push({ type: 'poly', points: [...state.polyPoints], isHole: false });
			state.selectedShapeIndex = state.shapes.length - 1;
			update3D();
			renderProperties();
		}
		state.polyPoints = [];
		setMode('select');
		draw2D();
	} else {
		state.polyPoints = [];
		setMode('draw_poly');
		ui.tools.poly.innerText = 'Finish Polygon';
	}
};

// Reset button text when mode changes elsewhere
const originalPolyText = ui.tools.poly.innerText;
const _setMode = setMode;
setMode = (m) => {
	_setMode(m);
	if (m !== 'draw_poly') ui.tools.poly.innerText = originalPolyText;
};

ui.btnDelete.onclick = () => {
	if (state.selectedShapeIndex > -1) {
		state.shapes.splice(state.selectedShapeIndex, 1);
		state.selectedShapeIndex = -1;
		state.selectedEdgeIndex = -1;
		draw2D();
		update3D();
		renderProperties();
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
			state.shapes = json.data.shapes || [];
			state.extrusionHeight = json.data.extrusionHeight || 1;
			ui.inpFilename.value = filename.replace('.json', '');
			ui.inpExtrusion.value = state.extrusionHeight;
			state.selectedShapeIndex = -1;
			draw2D();
			update3D();
			renderProperties();
		}
	} catch (e) { alert('Load failed'); }
}

async function saveFile() {
	const name = ui.inpFilename.value.trim();
	if (!name) return alert('Enter name');

	const data = {
		shapes: state.shapes,
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
	state.shapes = [];
	state.filename = null;
	ui.inpFilename.value = '';
	state.selectedShapeIndex = -1;
	draw2D();
	update3D();
	renderProperties();
};

// Init
resizeCanvas2D();
fetchFiles();