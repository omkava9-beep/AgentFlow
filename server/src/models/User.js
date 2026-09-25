import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  // Display name for member lists and presence (spec/22). Defaults to the
  // email's local part at registration.
  name: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true },
  // Embedded in every JWT; bumping it signs out every other session (spec/36 §4).
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('User', userSchema);
