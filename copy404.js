// Not needed anymore: the Node server handles SPA routes. Kept for static exports.
import fs from 'fs'
if (fs.existsSync('dist/index.html')) fs.copyFileSync('dist/index.html', 'dist/404.html')
