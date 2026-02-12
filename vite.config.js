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
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
					console.error('Middleware Error:', err);
					res.statusCode = 500;
					res.end(JSON.stringify({ error: err.message }));
					return true;
				}
				return false;
			};

			server.middlewares.use((req, res, next) => {
				// 1. Serve Static Textures from materials/textures
				if (req.method === 'GET' && req.url.startsWith('/materials/textures/')) {
					const relativePath = req.url.replace('/materials/textures/', '');
					// Prevent directory traversal
					const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
					const filePath = path.resolve(__dirname, 'materials/textures', safePath);

					if (fs.existsSync(filePath)) {
						const ext = path.extname(filePath).toLowerCase();
						const mimeTypes = {
							'.png': 'image/png',
							'.jpg': 'image/jpeg',
							'.jpeg': 'image/jpeg',
							'.gif': 'image/gif'
						};
						res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
						const stream = fs.createReadStream(filePath);
						stream.pipe(res);
						return;
					}
				}

				// 2. Handle Image Uploads
				if (req.method === 'POST' && req.url.startsWith('/api/upload-texture')) {
					const url = new URL(req.url, `http://${req.headers.host}`);
					const filename = url.searchParams.get('name');

					if (!filename) {
						res.statusCode = 400;
						res.end(JSON.stringify({ error: 'Filename required' }));
						return;
					}

					const textureDir = path.resolve(__dirname, 'materials/textures');
					ensureDir(textureDir);

					// Create a unique filename to prevent overwrites or caching issues
					const timestamp = Date.now();
					const safeName = `${timestamp}_${filename.replace(/[^a-z0-9_\-\.]/gi, '_')}`;
					const filePath = path.join(textureDir, safeName);
					const writeStream = fs.createWriteStream(filePath);

					req.pipe(writeStream);

					req.on('end', () => {
						res.setHeader('Content-Type', 'application/json');
						// Return the path relative to the server root that our GET handler above recognizes
						res.end(JSON.stringify({ success: true, path: `/materials/textures/${safeName}` }));
					});

					req.on('error', (err) => {
						console.error(err);
						res.statusCode = 500;
						res.end(JSON.stringify({ error: 'Upload failed' }));
					});
					return;
				}

				// 3. Handle JSON Data Endpoints
				if (req.url.startsWith('/api/scenesets')) {
					if (handleEndpoint(req, res, 'scenesets')) return;
				}
				if (req.url.startsWith('/api/parts')) {
					if (handleEndpoint(req, res, 'parts')) return;
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