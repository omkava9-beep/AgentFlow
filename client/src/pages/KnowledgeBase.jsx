import { useCallback, useEffect, useState } from 'react';
import { listKnowledge, addKnowledgeDoc, deleteKnowledgeDoc, searchKnowledge } from '../api/knowledge';
import { apiErrorMessage } from '../api/client';
import { useCan } from '../hooks/useCan';
import { formatRelativeTime } from '../utils/time';
import { Button, Card, ErrorText, TextArea, TextField } from '../components/ui';
import { confirm } from '../components/ui/confirm';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

/**
 * The workspace's Knowledge Base (spec/27 §7): plain-text documents that the
 * `knowledge.search` action searches with an in-process TF-IDF index. Paste text
 * or pick a .txt / .md file; there's a search box to try queries before wiring
 * them into a workflow.
 */
export default function KnowledgeBase() {
  const canEdit = useCan('workflow:edit');
  const [docs, setDocs] = useState(null);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await listKnowledge();
      setDocs(data.docs || []);
      setLimits(data.limits || null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load documents'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      setError('Only .txt and .md files are supported.');
      return;
    }
    setText(await file.text());
    if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ''));
  }

  async function add(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await addKnowledgeDoc({ title, text });
      setTitle('');
      setText('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not add the document'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(doc) {
    if (!(await confirm({ title: `Delete “${doc.title}”?`, body: "Workflows searching the knowledge base won't find it any more.", confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await deleteKnowledgeDoc(doc.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete the document'));
    }
  }

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const data = await searchKnowledge(query.trim(), 5);
      setResults(data.results || []);
    } catch (err) {
      setError(apiErrorMessage(err, 'Search failed'));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Knowledge Base</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Documents the <span className="font-mono">Knowledge Base → Search</span> action looks through.
          {limits && ` Up to ${limits.maxDocs} documents of ${Math.round(limits.maxBytes / 1024)} KB each.`}
        </p>
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      <div className="grid gap-4 lg:grid-cols-2">
        {canEdit && (
          <Card className="p-4">
            <form onSubmit={add} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add a document</h3>
              <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refund policy" required />
              <TextArea label="Text" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste text, or pick a file below" required />
              <div className="flex items-center justify-between gap-2">
                <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={pickFile} className="text-xs text-slate-500" />
                <Button type="submit" disabled={saving || !title.trim() || !text.trim()}>{saving ? 'Adding…' : 'Add document'}</Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="p-4">
          <form onSubmit={search} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Try a search</h3>
            <div className="flex gap-2">
              <div className="flex-1">
                <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How long do refunds take?" />
              </div>
              <Button type="submit" variant="secondary">Search</Button>
            </div>
          </form>
          {results && (
            <ul className="mt-3 space-y-2">
              {!results.length && <li className="text-sm text-slate-500">No matching chunks.</li>}
              {results.map((r, i) => (
                <li key={`${r.docId}-${i}`} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                  <div className="mb-1 flex justify-between text-slate-500">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{r.title}</span>
                    <span>score {r.score}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{r.chunk}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Documents</h2>
        {!docs && <SkeletonTable rows={3} columns={3} />}
        {docs && !docs.length && (
          <EmptyState compact icon="📚" title="No documents yet" body="Add help-centre articles or notes; agents and the Knowledge search action look things up here." />
        )}
        <div className="space-y-2">
          {(docs || []).map((doc) => (
            <Card key={doc.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{doc.title}</div>
                <div className="text-xs text-slate-400">
                  {doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'} · {(doc.bytes / 1024).toFixed(1)} KB · added {formatRelativeTime(doc.createdAt)}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{doc.preview}</p>
              </div>
              {canEdit && <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => remove(doc)}>Delete</Button>}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
