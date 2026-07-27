import { App } from './ui/App';

const app = new App();
(window as unknown as { __app: App }).__app = app;
app.start();
