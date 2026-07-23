import type { ArticleComment } from "./article-api";

export interface ArticleCommentReply {
  comment: ArticleComment;
  parent: ArticleComment | null;
}

export interface ArticleCommentThread {
  root: ArticleComment;
  replies: ArticleCommentReply[];
}

export function buildArticleCommentThreads(comments: ArticleComment[]): ArticleCommentThread[] {
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const threadsByRootId = new Map<number, ArticleCommentThread>();

  for (const comment of comments) {
    const root = findThreadRoot(comment, commentsById);
    const thread = threadsByRootId.get(root.id) ?? { root, replies: [] };
    if (comment.id !== root.id) {
      thread.replies.push({
        comment,
        parent: comment.parentId ? commentsById.get(comment.parentId) ?? null : null,
      });
    }
    threadsByRootId.set(root.id, thread);
  }

  return Array.from(threadsByRootId.values()).map((thread) => ({
    ...thread,
    replies: thread.replies.sort((left, right) => (
      new Date(left.comment.createdAt).getTime() - new Date(right.comment.createdAt).getTime()
      || left.comment.id - right.comment.id
    )),
  }));
}

function findThreadRoot(
  comment: ArticleComment,
  commentsById: Map<number, ArticleComment>,
): ArticleComment {
  const visited = new Set<number>();
  let current = comment;
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = commentsById.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}
