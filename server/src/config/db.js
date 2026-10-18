import mongoose from 'mongoose';
import { env } from './env.js';

let connecting;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) {
    mongoose.set('strictQuery', true);
    connecting = mongoose.connect(env.mongodbUri).then(() => {
      console.log('MongoDB connected');
    });
  }
  await connecting;
}
