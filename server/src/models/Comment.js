import mongoose from 'mongoose';

export const MAX_COMMENT_LENGTH = 4000;

/**
 * One comment in a thread (spec/29 §1). Mentions are stored structurally, as
 * member ids plus `{{@userId}}` tokens in the body, so a rename shows up in old
 * comments and plain "@bob" text never notifies anyone.
 *
 * A deleted reply keeps its row (`deletedAt`, empty body) so the conversation
 * still reads in order; deleting the first comment deletes the whole thread.
 */
const commentSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommentThread', required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, default: '', maxlength: MAX_COMMENT_LENGTH },
  mentions: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

commentSchema.index({ threadId: 1, createdAt: 1 });

export default mongoose.model('Comment', commentSchema);
