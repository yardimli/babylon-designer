/* src/historyManager.js */

let undoStack = [];
let redoStack = [];
let currentState = null;
let maxHistory = 20;

// Callbacks provided by sceneManager
let serializeFunction = null;
let loadFunction = null;

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

export function setupHistory (serializeFn, loadFn) {
	serializeFunction = serializeFn;
	loadFunction = loadFn;
	
	// Capture initial state
	currentState = JSON.stringify(serializeFunction());
	updateUI();
	
	if (btnUndo) {
		btnUndo.onclick = () => performUndo();
	}
	if (btnRedo) {
		btnRedo.onclick = () => performRedo();
	}
}

export function recordState () {
	if (!serializeFunction) return;
	
	const newState = JSON.stringify(serializeFunction());
	
	// If state hasn't changed, don't record (prevents duplicate entries on clicks)
	if (newState === currentState) return;
	
	// Push previous state to undo stack
	undoStack.push(currentState);
	if (undoStack.length > maxHistory) {
		undoStack.shift();
	}
	
	// New state becomes current
	currentState = newState;
	
	// Clear redo stack on new branch of history
	redoStack = [];
	
	updateUI();
	console.log('History recorded. Undo stack:', undoStack.length);
}

async function performUndo () {
	if (undoStack.length === 0 || !loadFunction) return;
	
	// Current state goes to redo
	redoStack.push(currentState);
	
	// Pop from undo
	const previousState = undoStack.pop();
	currentState = previousState;
	
	// Restore
	await loadFunction(JSON.parse(previousState));
	updateUI();
}

async function performRedo () {
	if (redoStack.length === 0 || !loadFunction) return;
	
	// Current state goes to undo
	undoStack.push(currentState);
	
	// Pop from redo
	const nextState = redoStack.pop();
	currentState = nextState;
	
	// Restore
	await loadFunction(JSON.parse(nextState));
	updateUI();
}

function updateUI () {
	if (btnUndo) {
		btnUndo.disabled = undoStack.length === 0;
		if (undoStack.length === 0) btnUndo.classList.add('btn-disabled');
		else btnUndo.classList.remove('btn-disabled');
	}
	
	if (btnRedo) {
		btnRedo.disabled = redoStack.length === 0;
		if (redoStack.length === 0) btnRedo.classList.add('btn-disabled');
		else btnRedo.classList.remove('btn-disabled');
	}
}
