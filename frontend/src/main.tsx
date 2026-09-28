import { installNetworkGuard } from './lab/networkGuard.mjs';
import './index.css';
installNetworkGuard();

// Do not import App.tsx: its production bootstrap remains unported source.
Promise.all([import('react-dom/client'), import('./lab/LabApp')]).then(([{ createRoot }, { default: LabApp }]) => {
  createRoot(document.getElementById('root')!).render(<LabApp />);
});
