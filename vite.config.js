import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Middleware to handle File I/O
const fileSystemMiddleware = () => {
	return {
		name: 'file-system-middleware',
		configureServer(server) {
			// Helper to ensure dir exists
			const ensureDir = (dir) => {
				if (!fs.existsSync(dir)) fs.mkdirSync(dir);
			};
			
			// Helper to handle generic CRUD
			const handleEndpoint = (req, res, dirName) => {
				const baseDir = path.resolve(__dirname, dirName);
				ensureDir(baseDir);
				
				const sendJson = (data) => {
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(data));
				};
				
				try {
					// GET: List files or Load specific file
					if (req.method === 'GET') {
						const url = new URL(req.url, `http://${req.headers.host}`);
						const filename = url.searchParams.get('file');
						
						if (filename) {
							const filePath = path.join(baseDir, filename);
							if (fs.existsSync(filePath)) {
								const content = fs.readFileSync(filePath, 'utf-8');
								sendJson({ success: true, data: JSON.parse(content) });
							} else {
								res.statusCode = 404;
								sendJson({ success: false, error: 'File not found' });
							}
						} else {
							const files = fs.readdirSync(baseDir).filter(file => file.endsWith('.json'));
							sendJson({ success: true, files });
						}
						return true;
					}
					
					// POST: Save file
					if (req.method === 'POST') {
						let body = '';
						req.on('data', chunk => { body += chunk; });
						req.on('end', () => {
							try {
								const { name, data } = JSON.parse(body);
								// Sanitize filename
								const safeName = name.replace(/[^a-z0-9_\-]/gi, '_') + '.json';
								const filePath = path.join(baseDir, safeName);
								
								fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
								sendJson({ success: true, filename: safeName });
							} catch (err) {
								res.statusCode = 500;
								sendJson({ success: false, error: err.message });
							}
						});
						return true;
					}
					
					// DELETE: Remove file
					if (req.method === 'DELETE') {
						const url = new URL(req.url, `http://${req.headers.host}`);
						const filename = url.searchParams.get('file');
						if (filename) {
							const filePath = path.join(baseDir, filename);
							if (fs.existsSync(filePath)) {
								fs.unlinkSync(filePath);
								sendJson({ success: true });
							} else {
								res.statusCode = 404;
								sendJson({ success: false });
							}
						}
						return true;
					}
				} catch (err) {
					console.error("Middleware Error:", err);
					res.statusCode = 500;
					res.end(JSON.stringify({ error: err.message }));
					return true;
				}
				return false;
			};
			
			server.middlewares.use((req, res, next) => {
				if (req.url.startsWith('/api/scenesets')) {
					if (handleEndpoint(req, res, 'scenesets')) return;
				}
				if (req.url.startsWith('/api/scenes')) {
					if (handleEndpoint(req, res, 'scenes')) return;
				}
				if (req.url.startsWith('/api/materials')) {
					if (handleEndpoint(req, res, 'materials')) return;
				}
				next();
			});
		}
	};
};

export default defineConfig({
	plugins: [
		tailwindcss(),
		fileSystemMiddleware()
	]
});
