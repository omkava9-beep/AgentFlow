import mongoose from 'mongoose';

/**
 * Everything the `database-write` tool inserts. A dedicated collection means the
 * tool has a real, inspectable side effect without introducing any new
 * infrastructure — and keeps simulated writes well clear of the app's own data.
 */
const mockRecordSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', index: true },
  // NOT `collection`: that's a reserved Mongoose schema path (it shadows
  // Document#collection), and Mongoose warns that using it may break internals.
  // The user-facing config field is still called "collection".
  collectionName: { type: String, required: true },
  document: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('MockRecord', mockRecordSchema);
