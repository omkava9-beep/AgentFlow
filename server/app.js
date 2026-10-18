import express from 'express';
import app from './src/app.js';

// Vercel looks for app.js at the project root first and requires this file to
// import `express` and default-export an app instance (not createApp()).
void express;
export default app;
