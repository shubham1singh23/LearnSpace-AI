import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Workspace } from './workspace';
import './styles.css';
const router = createBrowserRouter([{ path: '*', element: <Workspace /> }]);
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
