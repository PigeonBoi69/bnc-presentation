import './styles/app.css';
import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);
// handy for the scripted UI tests in tools/
(window as any).__app = app;
app.init().catch((e) => {
  console.error(e);
  root.textContent = `BNC Presentation could not start: ${e?.message ?? e}`;
});
