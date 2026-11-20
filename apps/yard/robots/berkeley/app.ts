// The yard app for this robot: the shared stand app (apps/yard/stand.ts) on the files in ./robot/.
import { standApp } from '../../stand';

export const app = standApp('berkeley', new URL('./robot/', import.meta.url));
export default app;
