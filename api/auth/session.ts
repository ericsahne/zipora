import { vercelHandler } from '../../src/server/runtime.js';

export default vercelHandler((app) => app.session);
