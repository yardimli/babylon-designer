import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Middleware to handle Scene File I/O
const sceneFileMiddleware = () => {
	return {
		name: 'scene-file-middleware',
		configureServer(server) {
			server.middlewares.use('/api/scenes', async (req, res, next) => {
				const scenesDir = path.resolve(__dirname, 'scenes');
				
				// Ensure directory exists
				if (!fs.existsSync(scenesDir)) {
					fs.mkdirSync(scenesDir);
				}
				
				// Helper to send JSON
				const sendJson = (data) => {
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(data));
				};
				
				try {
					// GET: List all scenes or Load specific scene
					if (req.method === 'GET') {
						const url = new URL(req.url, `http://${req.headers.host}`);
						const filename = url.searchParams.get('file');
						
						if (filename) {
							// Load specific file
							const filePath = path.join(scenesDir, filename);
							if (fs.existsSync(filePath)) {
								const content = fs.readFileSync(filePath, 'utf-8');
								sendJson({ success: true, data: JSON.parse(content) });
							} else {
								res.statusCode = 404;
								sendJson({ success: false, error: 'File not found' });
							}
						} else {
							// List files
							const files = fs.readdirSync(scenesDir)
								.filter(file => file.endsWith('.json'));
							sendJson({ success: true, files });
						}
						return;
					}
					
					// POST: Save scene
					if (req.method === 'POST') {
						let body = '';
						req.on('data', chunk => { body += chunk; });
						req.on('end', () => {
							try {
								const { name, data } = JSON.parse(body);
								const safeName = name.replace(/[^a-z0-9_\-]/gi, '_') + '.json';
								const filePath = path.join(scenesDir, safeName);
								
								fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
								sendJson({ success: true, filename: safeName });
							} catch (err) {
								res.statusCode = 500;
								sendJson({ success: false, error: err.message });
							}
						});
						return;
					}
					
					// DELETE: Remove scene
					if (req.method === 'DELETE') {
						const url = new URL(req.url, `http://${req.headers.host}`);
						const filename = url.searchParams.get('file');
						if(filename) {
							const filePath = path.join(scenesDir, filename);
							if(fs.existsSync(filePath)) {
								fs.unlinkSync(filePath);
								sendJson({ success: true });
							} else {
								res.statusCode = 404;
								sendJson({ success: false });
							}
						}
						return;
					}
					
					next();
				} catch (err) {
					console.error("Middleware Error:", err);
					res.statusCode = 500;
					res.end(JSON.stringify({ error: err.message }));
				}
			});
		}
	};
};

export default defineConfig({
	plugins: [
		tailwindcss(),
		sceneFileMiddleware()
	],
});
